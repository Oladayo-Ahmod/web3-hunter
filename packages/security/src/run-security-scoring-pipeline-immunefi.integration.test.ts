import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import "./detectors/immunefi-detectors";
import { runSecurityScoringPipeline } from "./run-security-scoring-pipeline";
import { resolveSecurityTarget } from "./security-target-store";

// A local stand-in for the real "BountyProgramRecorded"/"BountyProgramUpdated"
// Event Types `packages/collectors/src/bounty-program-events.ts` registers —
// this suite deliberately does not depend on packages/collectors, mirroring
// the DefiLlama integration suite's own stand-in.
const bountyAssetSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
});
const bountyFieldsSchema = z.object({
  slug: z.string(),
  project: z.string(),
  ecosystem: z.array(z.string()),
  launchDate: z.string(),
  endDate: z.string().nullable().optional(),
  isPaused: z.boolean(),
  pausedAt: z.string().nullable(),
  maxBounty: z.number(),
  rewardsPool: z.number(),
  githubUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  kyc: z.boolean(),
  inviteOnly: z.boolean(),
  assets: z.array(bountyAssetSchema),
  smartContractAssetIds: z.array(z.string()),
});
const TestBountyProgramRecorded = registerEventType({
  name: "BountyProgramRecorded",
  category: "source",
  version: 1,
  metadataSchema: bountyFieldsSchema,
});
const TestBountyProgramUpdated = registerEventType({
  name: "BountyProgramUpdated",
  category: "source",
  version: 1,
  metadataSchema: bountyFieldsSchema.extend({ changedFrom: bountyFieldsSchema.partial() }),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date("2026-01-01T00:00:00Z");

function daysAfter(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * DAY_MS);
}

function baseFields(overrides: Record<string, unknown> = {}) {
  return {
    slug: "test-bounty",
    project: "Test Bounty",
    ecosystem: ["ETH"],
    launchDate: "2020-01-01T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    maxBounty: 100_000,
    rewardsPool: 0,
    githubUrl: "https://github.com/test/test",
    websiteUrl: null,
    kyc: false,
    inviteOnly: false,
    assets: [{ id: "asset-1", type: "smart_contract", description: "A", url: null }],
    smartContractAssetIds: ["asset-1"],
    ...overrides,
  };
}

async function seedCollectorAndTarget(slug: string) {
  const [collector] = await getDb()
    .insert(schema.collector)
    .values({ slug: `${slug}-collector`, sourceType: "test" })
    .returning();
  const securityTargetId = await resolveSecurityTarget(collector!.id, slug, { slug, name: slug });
  return { collectorId: collector!.id, securityTargetId };
}

async function publishRecorded(input: {
  collectorId: string;
  securityTargetId: string;
  occurredAt: Date;
  fields?: Record<string, unknown>;
}) {
  return publishEvent({
    type: TestBountyProgramRecorded.name,
    metadata: baseFields(input.fields),
    occurredAt: input.occurredAt,
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "security_target",
    relatedEntityId: input.securityTargetId,
  });
}

async function publishUpdated(input: {
  collectorId: string;
  securityTargetId: string;
  occurredAt: Date;
  fields: Record<string, unknown>;
  changedFrom: Record<string, unknown>;
}) {
  return publishEvent({
    type: TestBountyProgramUpdated.name,
    metadata: { ...baseFields(input.fields), changedFrom: input.changedFrom },
    occurredAt: input.occurredAt,
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "security_target",
    relatedEntityId: input.securityTargetId,
  });
}

describe("runSecurityScoringPipeline — Immunefi signals (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("first observation does not qualify a Security Opportunity on its own", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("bounty-observed-only");

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(0) });
    const result = await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.map((s) => s.signalType)).toEqual(["bounty-program-observed"]);
    expect(result.opportunitiesDetected).toBe(0);
  });

  it("pause -> resume -> pause sequence: resume qualifies (with scope), the second pause does not retroactively qualify", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-pause-resume-pause",
    );

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { isPaused: false, pausedAt: null },
      changedFrom: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    const resumeResult = await runSecurityScoringPipeline(securityTargetId);
    expect(resumeResult.opportunitiesDetected).toBe(1);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(2),
      fields: { isPaused: true, pausedAt: daysAfter(2).toISOString() },
      changedFrom: { isPaused: false, pausedAt: null },
    });
    await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.map((s) => s.signalType).sort()).toEqual([
      "bounty-program-observed",
      "bounty-program-paused",
      "bounty-program-resumed",
    ]);
  });

  it("scope change while paused produces no Signal and does not create an Opportunity", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-scope-while-paused",
    );

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: {
        isPaused: true,
        pausedAt: daysAfter(0).toISOString(),
        smartContractAssetIds: ["asset-1", "asset-2"],
        assets: [
          { id: "asset-1", type: "smart_contract", description: "A", url: null },
          { id: "asset-2", type: "smart_contract", description: "B", url: null },
        ],
      },
      changedFrom: { smartContractAssetIds: ["asset-1"] },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.signalsProduced).toBe(0);
    expect(result.opportunitiesDetected).toBe(0);
  });

  it("scope expansion while active qualifies an Opportunity", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-scope-while-active",
    );

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(0) });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: {
        smartContractAssetIds: ["asset-1", "asset-2"],
        assets: [
          { id: "asset-1", type: "smart_contract", description: "A", url: null },
          { id: "asset-2", type: "smart_contract", description: "B", url: null },
        ],
      },
      changedFrom: { smartContractAssetIds: ["asset-1"] },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.opportunitiesDetected).toBe(1);
  });

  it("irrelevant metadata changes (reward figures, kyc) update stored evidence but qualify nothing", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-irrelevant-changes",
    );

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(0) });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { maxBounty: 500_000, kyc: true },
      changedFrom: { maxBounty: 100_000, kyc: false },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.signalsProduced).toBe(0);
    expect(result.opportunitiesDetected).toBe(0);

    const events = await getDb()
      .select({ metadata: schema.event.metadata })
      .from(schema.event)
      .where(eq(schema.event.relatedEntityId, securityTargetId));
    const updated = events.find(
      (e) => (e.metadata as { maxBounty?: number }).maxBounty === 500_000,
    );
    expect(updated).toBeDefined();
  });

  it("out-of-order updatedDate (occurredAt earlier than a previously recorded Event) does not emit false transition signals or crash", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("bounty-out-of-order");

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(5) });
    await runSecurityScoringPipeline(securityTargetId);

    // A later poll whose source-reported timestamp is *earlier* than the
    // first — e.g. Immunefi corrected its own updatedDate. The pause
    // transition is still genuine (a real field changed), so it must
    // still fire; what must NOT happen is a crash or a bogus "resumed"
    // signal invented from nothing.
    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1), // earlier than the Recorded event's occurredAt (day 5)
      fields: { isPaused: true, pausedAt: daysAfter(1).toISOString() },
      changedFrom: { isPaused: false, pausedAt: null },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.signalsProduced).toBe(1);
    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.map((s) => s.signalType).sort()).toEqual([
      "bounty-program-observed",
      "bounty-program-paused",
    ]);
  });

  it("duplicate snapshots and replay are idempotent: re-running with no new Events changes nothing", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-replay-idempotent",
    );

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(0) });
    const first = await runSecurityScoringPipeline(securityTargetId);
    const second = await runSecurityScoringPipeline(securityTargetId);

    expect(second.eventsProcessed).toBe(0);
    expect(second.signalsProduced).toBe(0);
    expect(first.signalsProduced).toBeGreaterThan(0);
  });

  it("mixed qualification is deterministic: a non-qualifying PAUSED signal alongside a qualifying prior RESUMED signal still qualifies", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-mixed-qualification",
    );

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { isPaused: false, pausedAt: null },
      changedFrom: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(2),
      fields: { isPaused: true, pausedAt: daysAfter(2).toISOString() },
      changedFrom: { isPaused: false, pausedAt: null },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    // A program that remains paused must not generate an actionable
    // opportunity merely because its scope changed earlier — but the
    // Opportunity already detected from the earlier RESUMED signal is a
    // historical fact, never retroactively revoked. Exactly one
    // Opportunity row exists, from the resume, not a new one from this
    // pause.
    expect(result.opportunitiesDetected).toBe(0);
    const opportunities = await getDb()
      .select()
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.securityTargetId, securityTargetId));
    expect(opportunities).toHaveLength(1);
  });

  it("an expired (concluded) competition cannot qualify an Opportunity by resuming", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("bounty-expired-resume");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: {
        isPaused: true,
        pausedAt: daysAfter(0).toISOString(),
        endDate: daysAfter(-5).toISOString(), // already concluded before this program was even first observed
      },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { isPaused: false, pausedAt: null, endDate: daysAfter(-5).toISOString() },
      changedFrom: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.opportunitiesDetected).toBe(0);
    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.some((s) => s.signalType === "bounty-program-resumed")).toBe(false);
  });

  it("an expired (concluded) competition cannot qualify an Opportunity through newly-observed scope", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("bounty-expired-scope");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { endDate: daysAfter(-5).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: {
        endDate: daysAfter(-5).toISOString(),
        smartContractAssetIds: ["asset-1", "asset-2"],
        assets: [
          { id: "asset-1", type: "smart_contract", description: "A", url: null },
          { id: "asset-2", type: "smart_contract", description: "B", url: null },
        ],
      },
      changedFrom: { smartContractAssetIds: ["asset-1"] },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.opportunitiesDetected).toBe(0);
    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.some((s) => s.signalType === "bounty-scope-expanded")).toBe(false);
  });

  it("legacy metadata with no endDate key at all is processed identically to endDate: null, and replaying it is idempotent", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget(
      "bounty-legacy-no-enddate",
    );

    // publishEvent's own metadataSchema.parse() requires the exact shape
    // it's given; simulate "legacy" by simply never setting endDate
    // (the schema's `.optional()` means omitting it is itself the
    // legacy-compatible case — see `bounty-program-events.ts`).
    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { isPaused: false, pausedAt: null },
      changedFrom: { isPaused: true, pausedAt: daysAfter(0).toISOString() },
    });
    const first = await runSecurityScoringPipeline(securityTargetId);
    expect(first.opportunitiesDetected).toBe(1);

    const second = await runSecurityScoringPipeline(securityTargetId);
    expect(second.eventsProcessed).toBe(0);
    expect(second.signalsProduced).toBe(0);
  });
});
