import { z } from "zod";
import { registerSignalDetector, registerSignalType } from "../registry";
import type {
  RecentCompanyEvent,
  SignalCandidate,
  SignalDetectionContext,
  SignalDetector,
} from "../types";

// These are the canonical Event Type names Hiring Events are registered
// under — currently by packages/collectors/greenhouse (see
// docs/EVENT_MODEL.md §Event Categories, "Hiring Events"). Deliberately
// referenced as plain strings, not imported from packages/collectors:
// packages/scoring never depends on packages/collectors (see
// docs/ARCHITECTURE.md §3) — the canonical vocabulary lives in
// @web3-hunter/events' registry, not in any one producer's code. The
// trade-off is an implicit coupling to the metadata shape below, which is
// why it's validated defensively rather than assumed.
const JOB_POSTED = "JobPosted";

/**
 * The subset of a Hiring Event's metadata these detectors need. Validated
 * defensively (`safeParse`, not `parse`) so a detector simply declines to
 * fire — rather than throwing — if a future source's Hiring Event doesn't
 * happen to carry these fields.
 */
const jobEventMetadataSchema = z.object({
  title: z.string(),
  departmentNames: z.array(z.string()).optional().default([]),
});

function describeRole(
  triggeringEvent: RecentCompanyEvent,
): { title: string; searchText: string } | null {
  const parsed = jobEventMetadataSchema.safeParse(triggeringEvent.metadata);
  if (!parsed.success) {
    return null;
  }
  const { title, departmentNames } = parsed.data;
  return { title, searchText: `${title} ${departmentNames.join(" ")}`.toLowerCase() };
}

function matchesAnyKeyword(searchText: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => searchText.includes(keyword));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function jobPostedEventsInWindow(
  events: readonly RecentCompanyEvent[],
  start: Date,
  end: Date,
): RecentCompanyEvent[] {
  return events.filter(
    (event) => event.type === JOB_POSTED && event.occurredAt >= start && event.occurredAt <= end,
  );
}

// --- 1. New backend engineering role detected -----------------------------

export const NEW_BACKEND_ROLE = registerSignalType("new-backend-role");

const BACKEND_KEYWORDS = ["backend", "back-end", "back end", "server-side"];
const NEW_BACKEND_ROLE_WEIGHT = 0.5;

export const newBackendRoleDetector: SignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== JOB_POSTED) {
    return [];
  }

  const role = describeRole(triggeringEvent);
  if (!role || !matchesAnyKeyword(role.searchText, BACKEND_KEYWORDS)) {
    return [];
  }

  const candidate: SignalCandidate = {
    signalType: NEW_BACKEND_ROLE,
    weight: NEW_BACKEND_ROLE_WEIGHT,
    reasoning: `A new backend-related role ("${role.title}") was posted.`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 2. Infrastructure hiring activity detected ----------------------------

export const INFRASTRUCTURE_ACTIVITY = registerSignalType("infrastructure-activity");

const INFRASTRUCTURE_KEYWORDS = [
  "infrastructure",
  "platform",
  "devops",
  "site reliability",
  "sre",
  "cloud",
];
const INFRASTRUCTURE_ACTIVITY_WEIGHT = 0.5;

export const infrastructureActivityDetector: SignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== JOB_POSTED) {
    return [];
  }

  const role = describeRole(triggeringEvent);
  if (!role || !matchesAnyKeyword(role.searchText, INFRASTRUCTURE_KEYWORDS)) {
    return [];
  }

  const candidate: SignalCandidate = {
    signalType: INFRASTRUCTURE_ACTIVITY,
    weight: INFRASTRUCTURE_ACTIVITY_WEIGHT,
    reasoning: `An infrastructure-related role ("${role.title}") was posted.`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 3. Multiple related openings detected ---------------------------------

export const MULTIPLE_RELATED_OPENINGS = registerSignalType("multiple-related-openings");

const RELATED_OPENINGS_WINDOW_DAYS = 30;
const RELATED_OPENINGS_THRESHOLD = 3;
const MULTIPLE_RELATED_OPENINGS_WEIGHT = 0.7;

export const multipleRelatedOpeningsDetector: SignalDetector = (triggeringEvent, context) => {
  if (triggeringEvent.type !== JOB_POSTED) {
    return [];
  }

  const windowStart = new Date(context.asOf.getTime() - RELATED_OPENINGS_WINDOW_DAYS * DAY_MS);
  const inWindow = jobPostedEventsInWindow(context.recentEvents, windowStart, context.asOf);

  if (inWindow.length < RELATED_OPENINGS_THRESHOLD) {
    return [];
  }

  const candidate: SignalCandidate = {
    signalType: MULTIPLE_RELATED_OPENINGS,
    weight: MULTIPLE_RELATED_OPENINGS_WEIGHT,
    reasoning: `${inWindow.length} roles were posted within the last ${RELATED_OPENINGS_WINDOW_DAYS} days.`,
    sourceEventIds: inWindow.map((event) => event.id),
  };
  return [candidate];
};

// --- 4. Hiring velocity increased ------------------------------------------

export const HIRING_VELOCITY_INCREASED = registerSignalType("hiring-velocity-increased");

const VELOCITY_WINDOW_DAYS = 30;
const VELOCITY_MIN_RECENT_POSTINGS = 2;
const VELOCITY_INCREASE_FACTOR = 2;
const HIRING_VELOCITY_INCREASED_WEIGHT = 0.6;

export const hiringVelocityDetector: SignalDetector = (triggeringEvent, context) => {
  if (triggeringEvent.type !== JOB_POSTED) {
    return [];
  }

  const recentWindowStart = new Date(context.asOf.getTime() - VELOCITY_WINDOW_DAYS * DAY_MS);
  const priorWindowStart = new Date(recentWindowStart.getTime() - VELOCITY_WINDOW_DAYS * DAY_MS);

  const recent = jobPostedEventsInWindow(context.recentEvents, recentWindowStart, context.asOf);
  const prior = jobPostedEventsInWindow(
    context.recentEvents,
    priorWindowStart,
    new Date(recentWindowStart.getTime() - 1),
  );

  if (recent.length < VELOCITY_MIN_RECENT_POSTINGS) {
    return [];
  }

  const increased =
    prior.length === 0 ? true : recent.length >= prior.length * VELOCITY_INCREASE_FACTOR;
  if (!increased) {
    return [];
  }

  const candidate: SignalCandidate = {
    signalType: HIRING_VELOCITY_INCREASED,
    weight: HIRING_VELOCITY_INCREASED_WEIGHT,
    reasoning: `Job postings increased from ${prior.length} to ${recent.length} over the last ${VELOCITY_WINDOW_DAYS} days.`,
    sourceEventIds: recent.map((event) => event.id),
  };
  return [candidate];
};

// Registered at module load, the same convention
// packages/collectors/greenhouse uses for Event Types: importing this
// module (which src/index.ts always does) is what makes these detectors
// active. ES module evaluation is cached per process, so this is safe even
// if something imports this module more than once.
registerSignalDetector(newBackendRoleDetector);
registerSignalDetector(infrastructureActivityDetector);
registerSignalDetector(multipleRelatedOpeningsDetector);
registerSignalDetector(hiringVelocityDetector);

// Explicit type-only import retained for the exported `SignalDetectionContext`
// reference in this module's public surface (used by consumers writing their
// own detectors against the same contract).
export type { SignalDetectionContext };
