import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTIVE_PROTOCOL, deriveSecurityOpportunityId } from "./opportunity-id";
import { runSecurityScoringPipeline } from "./run-security-scoring-pipeline";
import { resolveSecurityTarget } from "./security-target-store";
import "./detectors/defillama-detectors";

// A local stand-in for the real "ProtocolSnapshotRecorded"/"ProtocolSnapshotUpdated"
// Event Types `packages/collectors/src/protocol-events.ts` registers — this
// suite deliberately does not depend on packages/collectors (packages/security
// never does, per docs/ARCHITECTURE.md §3), so it registers the same
// canonical *names* itself, with a compatible metadata shape, rather than
// importing that package.
const protocolFieldsSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  tvl: z.number().nullable(),
  change1d: z.number().nullable(),
  change7d: z.number().nullable(),
  listedAt: z.number().nullable(),
  audits: z.string().nullable(),
  auditLinks: z.array(z.string()),
  chains: z.array(z.string()),
});
const TestProtocolSnapshotRecorded = registerEventType({
  name: "ProtocolSnapshotRecorded",
  category: "source",
  version: 1,
  metadataSchema: protocolFieldsSchema,
});
const TestProtocolSnapshotUpdated = registerEventType({
  name: "ProtocolSnapshotUpdated",
  category: "source",
  version: 1,
  metadataSchema: protocolFieldsSchema.extend({ changedFrom: protocolFieldsSchema.partial() }),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date("2026-01-01T00:00:00Z");

function daysAfter(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * DAY_MS);
}

function baseFields(overrides: Record<string, unknown> = {}) {
  return {
    slug: "test-protocol",
    name: "Test Protocol",
    category: "Lending",
    tvl: 10_000_000,
    change1d: 0,
    change7d: 0,
    listedAt: null,
    audits: "2",
    auditLinks: [],
    chains: ["Ethereum"],
    ...overrides,
  };
}

async function seedCollectorAndTarget(slug: string) {
  const db = getDb();
  const [collector] = await db
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
    type: TestProtocolSnapshotRecorded.name,
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
    type: TestProtocolSnapshotUpdated.name,
    metadata: { ...baseFields(input.fields), changedFrom: input.changedFrom },
    occurredAt: input.occurredAt,
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "security_target",
    relatedEntityId: input.securityTargetId,
  });
}

describe("runSecurityScoringPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("produces a NEW_PROTOCOL Signal for a first-seen protocol, but does NOT qualify a Security Opportunity on its own", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-protocol");

    const published = await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
    });

    const result = await runSecurityScoringPipeline(securityTargetId);
    expect(result.eventsProcessed).toBe(1);
    // Only new-protocol fires: audits is "2" (non-zero), so
    // audit-coverage-gap correctly declines, and tvl-growth never fires
    // on a Recorded event (no previous TVL to compare against).
    expect(result.signalsProduced).toBe(1);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    const newProtocolSignal = signals.find((signal) => signal.signalType === "new-protocol");
    expect(newProtocolSignal).toBeDefined();
    expect(newProtocolSignal?.sourceEventIds).toEqual([published.id]);

    // Phase 2B Step 1 correction: NEW_PROTOCOL alone no longer qualifies
    // a Security Opportunity — see security-opportunity-detection.ts.
    expect(result.opportunitiesDetected).toBe(0);
    const opportunities = await getDb()
      .select()
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.securityTargetId, securityTargetId));
    expect(opportunities).toHaveLength(0);
  });

  it("qualifies a Security Opportunity from AUDIT_COVERAGE_GAP alone, even with no NEW_PROTOCOL co-occurring", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-gap-qualifies");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { audits: "0", tvl: 5_000_000 },
    });

    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.opportunitiesDetected).toBe(1);
    const detectionWindow = "2026-W01";
    const expectedOpportunityId = deriveSecurityOpportunityId({
      securityTargetId,
      opportunityType: ACTIVE_PROTOCOL,
      detectionWindow,
    });
    const [opportunity] = await getDb()
      .select()
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.id, expectedOpportunityId));
    expect(opportunity).toBeDefined();
    expect(opportunity?.status).toBe("detected");
    expect(opportunity?.score).toBeNull();
    expect(opportunity?.reasoning).toMatch(/audit-coverage-gap/);
  });

  it("qualifies a Security Opportunity from TVL_GROWTH alone", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-growth-qualifies");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { audits: "2", tvl: 7_000_000 },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { audits: "2", tvl: 10_000_000 },
      changedFrom: { tvl: 7_000_000 },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.opportunitiesDetected).toBe(1);
  });

  it("qualifies deterministically from a mix of a non-qualifying and a qualifying signal (NEW_PROTOCOL + AUDIT_COVERAGE_GAP)", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-mixed");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { audits: "0", tvl: 5_000_000 },
    });

    const result = await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.map((s) => s.signalType).sort()).toEqual(["audit-coverage-gap", "new-protocol"]);
    expect(result.opportunitiesDetected).toBe(1);
  });

  it("does not emit AUDIT_COVERAGE_GAP for a CEX, and therefore does not qualify an Opportunity from CEX status alone", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-cex");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { category: "CEX", audits: "0", tvl: 50_000_000_000 },
    });

    const result = await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    expect(signals.map((s) => s.signalType)).toEqual(["new-protocol"]);
    expect(result.opportunitiesDetected).toBe(0);
  });

  it("reconciliation: a Security Opportunity already created under the old (NEW_PROTOCOL-qualifies) policy is left untouched by a re-run under the new policy", async () => {
    const { collectorId, securityTargetId } =
      await seedCollectorAndTarget("acme-legacy-opportunity");

    // Simulate a row created before this correction: a SecurityOpportunity
    // that exists with no qualifying Signal behind it at all (exactly what
    // the old "any signal" gate would have produced from NEW_PROTOCOL
    // alone). This is a direct store write, not a pipeline run — it stands
    // in for state already persisted by an earlier version of this code.
    const detectionWindow = "2026-W01";
    const legacyOpportunityId = deriveSecurityOpportunityId({
      securityTargetId,
      opportunityType: ACTIVE_PROTOCOL,
      detectionWindow,
    });
    await getDb()
      .insert(schema.securityOpportunity)
      .values({
        id: legacyOpportunityId,
        securityTargetId,
        opportunityType: ACTIVE_PROTOCOL,
        detectionWindow,
        reasoning: "Detected under the pre-correction any-signal policy.",
        detectedAt: daysAfter(0),
      });

    // A later, genuinely new source Event for the same target, in the
    // same detection window (same ISO week) — under the new policy this
    // still doesn't qualify on its own (non-zero audits, no TVL change
    // recorded), so the pipeline must neither delete nor rewrite the
    // pre-existing row.
    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { audits: "2", tvl: 10_000_000 },
    });
    await runSecurityScoringPipeline(securityTargetId);

    const [stillThere] = await getDb()
      .select()
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.id, legacyOpportunityId));
    expect(stillThere).toBeDefined();
    expect(stillThere?.reasoning).toBe("Detected under the pre-correction any-signal policy.");
    expect(stillThere?.status).toBe("detected");
  });

  it("produces an AUDIT_COVERAGE_GAP Signal using the exact required phrasing, as a weak negative signal only", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-gap");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { audits: "0", tvl: 5_000_000 },
    });

    await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    const gapSignal = signals.find((signal) => signal.signalType === "audit-coverage-gap");

    expect(gapSignal).toBeDefined();
    expect(gapSignal?.reasoning).toMatch(
      /^Limited audit coverage indicated by available DefiLlama metadata\./,
    );
  });

  it("produces a TVL_GROWTH Signal when TVL grows meaningfully between polls", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-growth");

    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { tvl: 7_000_000 },
    });
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { tvl: 10_000_000 },
      changedFrom: { tvl: 7_000_000 },
    });
    await runSecurityScoringPipeline(securityTargetId);

    const signals = await getDb()
      .select()
      .from(schema.securitySignal)
      .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
    const growthSignal = signals.find((signal) => signal.signalType === "tvl-growth");
    expect(growthSignal).toBeDefined();
  });

  it("does not create a Security Opportunity when no Signal fires", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-no-signal");

    // A small TVL change below every detector's floor, on a protocol
    // already carrying audits, fires nothing.
    await publishRecorded({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(0),
      fields: { listedAt: Math.floor(daysAfter(-90).getTime() / 1000) },
    });

    // The new-protocol detector still fires on first sight regardless —
    // use an Updated event with no meaningful signal instead, after an
    // initial Recorded that itself produces nothing when audits is
    // non-zero and listedAt is old. Since new-protocol always fires on
    // Recorded, assert on the Updated-only path instead.
    await runSecurityScoringPipeline(securityTargetId);

    await publishUpdated({
      collectorId,
      securityTargetId,
      occurredAt: daysAfter(1),
      fields: { tvl: 10_050_000 },
      changedFrom: { tvl: 10_000_000 },
    });
    const result = await runSecurityScoringPipeline(securityTargetId);

    expect(result.signalsProduced).toBe(0);
  });

  it("is idempotent: re-running the pipeline with no new Events changes nothing", async () => {
    const { collectorId, securityTargetId } = await seedCollectorAndTarget("acme-idempotent");

    await publishRecorded({ collectorId, securityTargetId, occurredAt: daysAfter(0) });

    const first = await runSecurityScoringPipeline(securityTargetId);
    const second = await runSecurityScoringPipeline(securityTargetId);

    expect(second.eventsProcessed).toBe(0);
    expect(second.signalsProduced).toBe(0);
    expect(second.intelligenceUpdates).toBe(0);
    expect(first.signalsProduced).toBeGreaterThan(0);
  });

  it("resolveSecurityTarget is idempotent across repeated polls under the same Collector + sourceIdentifier", async () => {
    const db = getDb();
    const [collector] = await db
      .insert(schema.collector)
      .values({ slug: "idempotent-resolve-collector", sourceType: "test" })
      .returning();

    const first = await resolveSecurityTarget(collector!.id, "stable-protocol", {
      slug: "stable-protocol",
      name: "Stable Protocol",
    });
    const second = await resolveSecurityTarget(collector!.id, "stable-protocol", {
      slug: "stable-protocol",
      name: "A Different Name — should be ignored",
    });

    expect(second).toBe(first);

    const identities = await db
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.sourceIdentifier, "stable-protocol"));
    expect(identities).toHaveLength(1);
  });
});
