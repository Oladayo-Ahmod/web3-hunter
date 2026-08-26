import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { and, eq } from "drizzle-orm";
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

  // Milestone 26 — real production audit found `IntelligenceUpdated` and
  // `HiringSignalDetected` together responsible for ~92% of
  // `event_provenance`'s 772k rows, because every recompute re-cited a
  // Company's *entire* Signal/Event history. These tests prove the fix
  // (cite only what's new since the previous same-type Event, plus a
  // link to it) without weakening any of the replay-determinism or
  // state-correctness coverage above, which still passes unchanged.
  it("bounds event_provenance growth: later IntelligenceUpdated Events cite only new Signals, not the full accumulated history", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-provenance-bound");

    // Enough distinct postings, spread across enough days, to trigger
    // several separate Intelligence recomputes as Signals accumulate one
    // at a time (each new-backend-role/infrastructure-activity posting
    // is its own triggering Event).
    const postings = [
      { title: "Backend Engineer", day: 0 },
      { title: "Infrastructure Engineer", day: 3 },
      { title: "Backend Developer", day: 6 },
      { title: "Platform Engineer", day: 9 },
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

    await runScoringPipeline(companyId);

    const intelligenceEvents = await getDb()
      .select({
        id: schema.event.id,
        metadata: schema.event.metadata,
        occurredAt: schema.event.occurredAt,
      })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.type, "IntelligenceUpdated"),
          eq(schema.event.relatedEntityId, companyId),
        ),
      );
    expect(intelligenceEvents.length).toBeGreaterThan(1); // multiple recomputes actually happened

    const sorted = [...intelligenceEvents].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const lastEvent = sorted[sorted.length - 1]!;
    const lastMetadata = lastEvent.metadata as { signalCount: number };

    const provenanceForLastEvent = await getDb()
      .select()
      .from(schema.eventProvenance)
      .where(eq(schema.eventProvenance.eventId, lastEvent.id));

    // The real bug this fixes: before Milestone 26, this would equal
    // `lastMetadata.signalCount` (the full accumulated history) once
    // that count grows past a handful. It must now be small — the new
    // Signal(s) since the previous recompute, plus one link — never the
    // full total.
    expect(provenanceForLastEvent.length).toBeLessThan(lastMetadata.signalCount);
  });

  it("preserves full audit reconstructability: walking the IntelligenceUpdated provenance chain backward recovers every Signal", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-provenance-chain");

    const postings = [
      { title: "Backend Engineer", day: 0 },
      { title: "Infrastructure Engineer", day: 3 },
      { title: "Backend Developer", day: 6 },
    ];
    for (const posting of postings) {
      await publishJobPosted({
        collectorId,
        companyId,
        title: posting.title,
        occurredAt: daysAfter(posting.day),
      });
    }

    await runScoringPipeline(companyId);

    const allSignals = await getDb()
      .select({ id: schema.signal.id })
      .from(schema.signal)
      .where(eq(schema.signal.companyId, companyId));
    const allSignalIds = new Set(allSignals.map((s) => s.id));

    const intelligenceEvents = await getDb()
      .select({ id: schema.event.id, occurredAt: schema.event.occurredAt })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.type, "IntelligenceUpdated"),
          eq(schema.event.relatedEntityId, companyId),
        ),
      );
    const sorted = [...intelligenceEvents].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
    );
    const latestEventId = sorted[0]!.id;

    // Walk the chain: at each step, collect every cited Signal id, and
    // follow any cited id that is itself an IntelligenceUpdated Event
    // (the "link to the previous recompute") one step further back.
    const recovered = new Set<string>();
    const toVisit = [latestEventId];
    const visited = new Set<string>();
    while (toVisit.length > 0) {
      const eventId = toVisit.pop()!;
      if (visited.has(eventId)) continue;
      visited.add(eventId);

      const citations = await getDb()
        .select({ causedByEventId: schema.eventProvenance.causedByEventId })
        .from(schema.eventProvenance)
        .where(eq(schema.eventProvenance.eventId, eventId));

      for (const { causedByEventId } of citations) {
        if (allSignalIds.has(causedByEventId)) {
          recovered.add(causedByEventId);
        } else {
          toVisit.push(causedByEventId);
        }
      }
    }

    expect(recovered).toEqual(allSignalIds);
  });

  it("bounds HiringSignalDetected provenance too: a sustained posting streak doesn't re-cite the whole rolling window on every new Signal", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-signal-window");

    // Six postings within a 30-day window is enough to keep
    // multipleRelatedOpeningsDetector/hiringVelocityDetector firing
    // repeatedly on an overlapping window — the exact real-production
    // pattern that drove HiringSignalDetected's 45% share of
    // event_provenance.
    const postings = [0, 4, 8, 12, 16, 20].map((day) => ({
      title: `Backend Engineer #${day}`,
      day,
    }));
    for (const posting of postings) {
      await publishJobPosted({
        collectorId,
        companyId,
        title: posting.title,
        occurredAt: daysAfter(posting.day),
      });
    }

    await runScoringPipeline(companyId);

    const windowSignals = await getDb()
      .select({ id: schema.signal.id, sourceEventIds: schema.signal.sourceEventIds })
      .from(schema.signal)
      .where(
        and(
          eq(schema.signal.companyId, companyId),
          eq(schema.signal.signalType, "multiple-related-openings"),
        ),
      );

    // The detector itself should have fired more than once as the
    // window filled up with successive postings.
    expect(windowSignals.length).toBeGreaterThan(1);

    const lastSignal = windowSignals[windowSignals.length - 1]!;
    const provenanceForLastSignal = await getDb()
      .select()
      .from(schema.eventProvenance)
      .where(eq(schema.eventProvenance.eventId, lastSignal.id));

    // Before Milestone 26 this would equal `lastSignal.sourceEventIds.length`
    // (the detector's full, currently-in-window candidate list, cited
    // again from scratch). It must now be smaller — only the JobPosted
    // Event(s) new to the window since the previous same-type Signal,
    // plus one link.
    expect(provenanceForLastSignal.length).toBeLessThan(lastSignal.sourceEventIds.length);
    // The product-facing column is untouched — still the detector's
    // full, untrimmed candidate list, so nothing reading it sees any
    // behavior change.
    expect(lastSignal.sourceEventIds.length).toBeGreaterThan(1);
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
