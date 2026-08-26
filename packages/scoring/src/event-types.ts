import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * Intelligence Events (docs/EVENT_MODEL.md §Event Categories) — the
 * Scoring Engine's own reasoning, recorded as immutable facts. Registered
 * here because packages/scoring is their only producer.
 */

export const HiringSignalDetected = registerEventType({
  name: "HiringSignalDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    signalType: z.string(),
    weight: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});

export const IntelligenceUpdated = registerEventType({
  name: "IntelligenceUpdated",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    trend: z.enum(["insufficient-data", "increasing", "stable", "decreasing"]),
    confidence: z.number().min(0).max(1),
    signalCount: z.number().int().min(0),
  }),
});

export const OpportunityDetected = registerEventType({
  name: "OpportunityDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    opportunityId: z.string().uuid(),
    opportunityType: z.string(),
    detectionWindow: z.string(),
    reasoning: z.string(),
  }),
});

export const OpportunityScored = registerEventType({
  name: "OpportunityScored",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    opportunityId: z.string().uuid(),
    score: z.number().min(0).max(1),
    reasoning: z.string(),
    // Milestone 26: how many of the Company's Signals this score was
    // computed over — lets a future OpportunityScored for the same
    // Opportunity cite only the Signals new since this one, instead of
    // the full list again. Same pattern as IntelligenceUpdated.signalCount.
    // Optional, not required: existing pre-Milestone-26 events in
    // production don't have this field, and metadataSchema.parse() runs
    // against historical events too (replay) — a required field here
    // would fail parsing every OpportunityScored Event published before
    // this change.
    signalCount: z.number().int().min(0).optional(),
  }),
});
