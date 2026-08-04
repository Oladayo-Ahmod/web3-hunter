import { describe, expect, it } from "vitest";
import type { RecentCompanyEvent, SignalDetectionContext } from "../types";
import {
  HIRING_VELOCITY_INCREASED,
  INFRASTRUCTURE_ACTIVITY,
  MULTIPLE_RELATED_OPENINGS,
  NEW_BACKEND_ROLE,
  hiringVelocityDetector,
  infrastructureActivityDetector,
  multipleRelatedOpeningsDetector,
  newBackendRoleDetector,
} from "./hiring-detectors";

const ASOF = new Date("2026-03-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(days: number): Date {
  return new Date(ASOF.getTime() - days * DAY_MS);
}

function jobPostedEvent(
  overrides: Partial<RecentCompanyEvent> & { title: string },
): RecentCompanyEvent {
  const { title, ...rest } = overrides;
  return {
    id: "event-id",
    type: "JobPosted",
    occurredAt: ASOF,
    metadata: { title, departmentNames: ["Engineering"] },
    ...rest,
  };
}

function context(
  recentEvents: readonly RecentCompanyEvent[],
  asOf: Date = ASOF,
): SignalDetectionContext {
  return { companyId: "company-a", asOf, recentEvents };
}

describe("newBackendRoleDetector", () => {
  it("fires on a JobPosted event with a backend-related title", () => {
    const event = jobPostedEvent({ id: "e1", title: "Senior Backend Engineer" });
    const result = newBackendRoleDetector(event, context([event]));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ signalType: NEW_BACKEND_ROLE, sourceEventIds: ["e1"] });
  });

  it("does not fire on an unrelated role", () => {
    const event = jobPostedEvent({ id: "e1", title: "Product Designer" });
    expect(newBackendRoleDetector(event, context([event]))).toEqual([]);
  });

  it("does not fire on non-JobPosted events", () => {
    const event: RecentCompanyEvent = {
      id: "e1",
      type: "JobClosed",
      occurredAt: ASOF,
      metadata: {},
    };
    expect(newBackendRoleDetector(event, context([event]))).toEqual([]);
  });

  it("does not fire when metadata doesn't match the expected shape", () => {
    const event: RecentCompanyEvent = {
      id: "e1",
      type: "JobPosted",
      occurredAt: ASOF,
      metadata: { unexpected: true },
    };
    expect(newBackendRoleDetector(event, context([event]))).toEqual([]);
  });
});

describe("infrastructureActivityDetector", () => {
  it("fires on a JobPosted event with an infrastructure-related title", () => {
    const event = jobPostedEvent({ id: "e1", title: "Platform / DevOps Engineer" });
    const result = infrastructureActivityDetector(event, context([event]));

    expect(result).toHaveLength(1);
    expect(result[0]?.signalType).toBe(INFRASTRUCTURE_ACTIVITY);
  });

  it("does not fire on an unrelated role", () => {
    const event = jobPostedEvent({ id: "e1", title: "Account Executive" });
    expect(infrastructureActivityDetector(event, context([event]))).toEqual([]);
  });
});

describe("multipleRelatedOpeningsDetector", () => {
  it("fires when three or more roles were posted within the window", () => {
    const events = [
      jobPostedEvent({ id: "e1", title: "Engineer A", occurredAt: daysBefore(20) }),
      jobPostedEvent({ id: "e2", title: "Engineer B", occurredAt: daysBefore(10) }),
      jobPostedEvent({ id: "e3", title: "Engineer C", occurredAt: daysBefore(1) }),
    ];
    const result = multipleRelatedOpeningsDetector(events[2]!, context(events));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ signalType: MULTIPLE_RELATED_OPENINGS });
    expect(result[0]?.sourceEventIds).toEqual(["e1", "e2", "e3"]);
  });

  it("does not fire with fewer than three postings in the window", () => {
    const events = [
      jobPostedEvent({ id: "e1", title: "Engineer A", occurredAt: daysBefore(10) }),
      jobPostedEvent({ id: "e2", title: "Engineer B", occurredAt: daysBefore(1) }),
    ];
    expect(multipleRelatedOpeningsDetector(events[1]!, context(events))).toEqual([]);
  });

  it("does not count postings outside the window", () => {
    const events = [
      jobPostedEvent({ id: "e1", title: "Engineer A", occurredAt: daysBefore(90) }),
      jobPostedEvent({ id: "e2", title: "Engineer B", occurredAt: daysBefore(80) }),
      jobPostedEvent({ id: "e3", title: "Engineer C", occurredAt: daysBefore(1) }),
    ];
    expect(multipleRelatedOpeningsDetector(events[2]!, context(events))).toEqual([]);
  });
});

describe("hiringVelocityDetector", () => {
  it("fires when recent postings at least double the prior window's count", () => {
    const events = [
      jobPostedEvent({ id: "p1", title: "A", occurredAt: daysBefore(50) }),
      jobPostedEvent({ id: "r1", title: "B", occurredAt: daysBefore(15) }),
      jobPostedEvent({ id: "r2", title: "C", occurredAt: daysBefore(5) }),
    ];
    const result = hiringVelocityDetector(events[2]!, context(events));

    expect(result).toHaveLength(1);
    expect(result[0]?.signalType).toBe(HIRING_VELOCITY_INCREASED);
  });

  it("fires when there were no prior postings but at least two recent ones", () => {
    const events = [
      jobPostedEvent({ id: "r1", title: "A", occurredAt: daysBefore(15) }),
      jobPostedEvent({ id: "r2", title: "B", occurredAt: daysBefore(5) }),
    ];
    expect(hiringVelocityDetector(events[1]!, context(events))).toHaveLength(1);
  });

  it("does not fire with fewer than two recent postings", () => {
    const events = [jobPostedEvent({ id: "r1", title: "A", occurredAt: daysBefore(5) })];
    expect(hiringVelocityDetector(events[0]!, context(events))).toEqual([]);
  });

  it("does not fire when recent postings do not represent an increase", () => {
    const events = [
      jobPostedEvent({ id: "p1", title: "A", occurredAt: daysBefore(50) }),
      jobPostedEvent({ id: "p2", title: "B", occurredAt: daysBefore(45) }),
      jobPostedEvent({ id: "r1", title: "C", occurredAt: daysBefore(15) }),
      jobPostedEvent({ id: "r2", title: "D", occurredAt: daysBefore(5) }),
    ];
    expect(hiringVelocityDetector(events[3]!, context(events))).toEqual([]);
  });
});
