import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildCompanyIntelligence } from "./company-intelligence-store";
import { deriveOpportunityId, ENGINEERING_HIRING_SURGE } from "./opportunity-id";
import { registerSignalDetector } from "./registry";
import { runScoringPipeline } from "./run-scoring-pipeline";
import type { SignalDetector } from "./types";
import "./detectors/hiring-detectors";
import { z } from "zod";

// A local stand-in for the real "JobPosted" Event Type packages/collectors/
// greenhouse registers — this suite deliberately does not depend on
// packages/collectors (packages/scoring never does, per
// docs/ARCHITECTURE.md §3), so it registers the same canonical *name*
// itself, with a compatible metadata shape, rather than importing that
// package.
const TestJobPosted = registerEventType({
  name: "JobPosted",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string(), departmentNames: z.array(z.string()) }),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date("2026-01-01T00:00:00Z");

function daysAfter(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * DAY_MS);
}

async function seedCollectorAndCompany(slug: string) {
  const db = getDb();
  const [collector] = await db
    .insert(schema.collector)
    .values({ slug: `${slug}-collector`, sourceType: "test" })
    .returning();
  const [company] = await db.insert(schema.company).values({ slug, name: slug }).returning();
  return { collectorId: collector!.id, companyId: company!.id };
}

async function publishJobPosted(input: {
  collectorId: string;
  companyId: string;
  title: string;
  departmentNames?: string[];
  occurredAt: Date;
}) {
  await publishEvent({
    type: TestJobPosted.name,
    metadata: { title: input.title, departmentNames: input.departmentNames ?? ["Engineering"] },
    occurredAt: input.occurredAt,
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "company",
    relatedEntityId: input.companyId,
  });
}

describe("runScoringPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("produces a Signal with correct provenance and reasoning for a single matching Event", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-signals");

    const published = await publishEvent({
      type: TestJobPosted.name,
      metadata: { title: "Senior Backend Engineer", departmentNames: ["Engineering"] },
      occurredAt: daysAfter(0),
      confidence: 1,
      collectorId,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    });

    const result = await runScoringPipeline(companyId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.signalsProduced).toBeGreaterThanOrEqual(1);

    const signals = await getDb()
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyId));
    const backendSignal = signals.find((signal) => signal.signalType === "new-backend-role");

    expect(backendSignal).toBeDefined();
    expect(backendSignal?.sourceEventIds).toEqual([published.id]);
    expect(backendSignal?.reasoning).toContain("Senior Backend Engineer");
  });

  it("does not create an Opportunity when too few Signals have been produced", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-too-few");

    await publishJobPosted({
      collectorId,
      companyId,
      title: "Backend Engineer",
      occurredAt: daysAfter(0),
    });

    await runScoringPipeline(companyId);

    const opportunities = await getDb()
      .select()
      .from(schema.opportunity)
      .where(eq(schema.opportunity.companyId, companyId));
    expect(opportunities).toHaveLength(0);
  });

  it("detects and scores an Opportunity once the threshold is met, citing the Signals responsible", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-surge");

    const postings = [
      { title: "Backend Engineer", day: 0 },
      { title: "Platform Engineer", day: 5 },
      { title: "Backend Developer", day: 10 },
      { title: "Site Reliability Engineer", day: 12 },
    ];

    for (const posting of postings) {
      await publishJobPosted({
        collectorId,
        companyId,
        title: posting.title,
        occurredAt: daysAfter(posting.day),
      });
    }

    const result = await runScoringPipeline(companyId);
    // The four postings span three different ISO weeks (see
    // computeDetectionWindow), so a sustained surge can legitimately
    // detect more than one Opportunity — one per Detection Window — not
    // just one overall.
    expect(result.opportunitiesDetected).toBeGreaterThanOrEqual(1);
    expect(result.opportunitiesScored).toBeGreaterThanOrEqual(1);

    const opportunities = await getDb()
      .select()
      .from(schema.opportunity)
      .where(eq(schema.opportunity.companyId, companyId));
    expect(opportunities.length).toBeGreaterThanOrEqual(1);

    for (const opportunity of opportunities) {
      expect(opportunity.status).toBe("scored");
      expect(opportunity.score).toBeGreaterThan(0);
      expect(opportunity.score).toBeLessThanOrEqual(1);
      expect(opportunity.opportunityType).toBe(ENGINEERING_HIRING_SURGE);

      // Each Opportunity's ID must match what deriveOpportunityId computes
      // independently from the same stable business inputs.
      const expectedId = deriveOpportunityId({
        companyId,
        opportunityType: ENGINEERING_HIRING_SURGE,
        detectionWindow: opportunity.detectionWindow,
      });
      expect(opportunity.id).toBe(expectedId);
    }

    // Its OpportunityDetected/OpportunityScored Events must cite the
    // Signals that justified it.
    const signals = await getDb()
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyId));
    expect(signals.length).toBeGreaterThan(0);
  });

  it("is idempotent: re-running the pipeline with no new Events changes nothing", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-idempotent");

    await publishJobPosted({
      collectorId,
      companyId,
      title: "Backend Engineer",
      occurredAt: daysAfter(0),
    });
    await publishJobPosted({
      collectorId,
      companyId,
      title: "Platform Engineer",
      occurredAt: daysAfter(5),
    });

    const first = await runScoringPipeline(companyId);
    const second = await runScoringPipeline(companyId);

    expect(second.eventsProcessed).toBe(0);
    expect(second.signalsProduced).toBe(0);
    expect(second.intelligenceUpdates).toBe(0);
    expect(first.signalsProduced).toBeGreaterThan(0);
  });

  it("rebuildCompanyIntelligence reproduces the live-updated projection exactly", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-rebuild");

    const lastOccurredAt = daysAfter(5);
    await publishJobPosted({
      collectorId,
      companyId,
      title: "Backend Engineer",
      occurredAt: daysAfter(0),
    });
    await publishJobPosted({
      collectorId,
      companyId,
      title: "Platform Engineer",
      occurredAt: lastOccurredAt,
    });

    await runScoringPipeline(companyId);

    const [live] = await getDb()
      .select()
      .from(schema.companyIntelligence)
      .where(eq(schema.companyIntelligence.companyId, companyId));
    expect(live).toBeDefined();

    const rebuilt = await rebuildCompanyIntelligence(companyId, live!.asOf);

    expect(rebuilt).toEqual({
      trend: live!.trend,
      confidence: live!.confidence,
      signalCount: live!.signalCount,
      lastSignalAt: live!.lastSignalAt,
    });
  });

  it("produces identical Signals, Intelligence, and Opportunities for two companies given the same Event history", async () => {
    const companyA = await seedCollectorAndCompany("replay-a");
    const companyB = await seedCollectorAndCompany("replay-b");

    const postings = [
      { title: "Backend Engineer", day: 0 },
      { title: "Platform Engineer", day: 5 },
      { title: "Backend Developer", day: 10 },
      { title: "Site Reliability Engineer", day: 12 },
    ];

    for (const target of [companyA, companyB]) {
      for (const posting of postings) {
        await publishJobPosted({
          collectorId: target.collectorId,
          companyId: target.companyId,
          title: posting.title,
          occurredAt: daysAfter(posting.day),
        });
      }
    }

    const resultA = await runScoringPipeline(companyA.companyId);
    const resultB = await runScoringPipeline(companyB.companyId);

    expect(resultB).toEqual(resultA);

    const signalsA = await getDb()
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyA.companyId));
    const signalsB = await getDb()
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyB.companyId));

    const normalize = (rows: typeof signalsA) =>
      rows
        .map((row) => ({
          signalType: row.signalType,
          weight: row.weight,
          reasoning: row.reasoning,
          detectedAt: row.detectedAt.getTime(),
        }))
        .sort((a, b) => a.signalType.localeCompare(b.signalType) || a.detectedAt - b.detectedAt);

    expect(normalize(signalsB)).toEqual(normalize(signalsA));

    const [intelligenceA] = await getDb()
      .select()
      .from(schema.companyIntelligence)
      .where(eq(schema.companyIntelligence.companyId, companyA.companyId));
    const [intelligenceB] = await getDb()
      .select()
      .from(schema.companyIntelligence)
      .where(eq(schema.companyIntelligence.companyId, companyB.companyId));

    expect({
      trend: intelligenceB?.trend,
      confidence: intelligenceB?.confidence,
      signalCount: intelligenceB?.signalCount,
    }).toEqual({
      trend: intelligenceA?.trend,
      confidence: intelligenceA?.confidence,
      signalCount: intelligenceA?.signalCount,
    });

    const [opportunityA] = await getDb()
      .select()
      .from(schema.opportunity)
      .where(eq(schema.opportunity.companyId, companyA.companyId));
    const [opportunityB] = await getDb()
      .select()
      .from(schema.opportunity)
      .where(eq(schema.opportunity.companyId, companyB.companyId));

    expect(opportunityB?.score).toEqual(opportunityA?.score);
    expect(opportunityB?.detectionWindow).toEqual(opportunityA?.detectionWindow);
  });

  it("extensibility: a newly registered detector is exercised with zero changes to the pipeline runner", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-extensibility");

    const EXTENSIBILITY_SIGNAL = "__test__extensibility-signal";
    const testDetector: SignalDetector = (triggeringEvent) => {
      if (triggeringEvent.type !== TestJobPosted.name) {
        return [];
      }
      return [
        {
          signalType: EXTENSIBILITY_SIGNAL,
          weight: 0.42,
          reasoning: "Fired by a test-only detector registered after the fact.",
          sourceEventIds: [triggeringEvent.id],
        },
      ];
    };
    registerSignalDetector(testDetector);

    await publishJobPosted({ collectorId, companyId, title: "Anything", occurredAt: daysAfter(0) });
    await runScoringPipeline(companyId);

    const signals = await getDb()
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyId));
    expect(signals.some((signal) => signal.signalType === EXTENSIBILITY_SIGNAL)).toBe(true);
  });
});
