import { describe, expect, it } from "vitest";
import { FOLLOW_UP_INTERVAL_DAYS } from "./constants";
import { evaluateFollowUpSchedule } from "./follow-up";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASOF = new Date("2026-03-01T00:00:00Z");

describe("evaluateFollowUpSchedule", () => {
  it("does not recommend a follow-up for a non-active Recommendation", () => {
    const decision = evaluateFollowUpSchedule({ status: "dismissed", createdAt: ASOF }, ASOF);
    expect(decision.recommended).toBe(false);
    expect(decision.reasonCode).toBe("recommendation-not-active");
  });

  it("does not recommend a follow-up before the interval has elapsed", () => {
    const createdAt = new Date(ASOF.getTime() - (FOLLOW_UP_INTERVAL_DAYS - 1) * DAY_MS);
    const decision = evaluateFollowUpSchedule({ status: "active", createdAt }, ASOF);
    expect(decision.recommended).toBe(false);
    expect(decision.reasonCode).toBe("not-yet-due");
  });

  it("recommends a follow-up once the interval has elapsed, with a deterministic suggested date", () => {
    const createdAt = new Date(ASOF.getTime() - FOLLOW_UP_INTERVAL_DAYS * DAY_MS);
    const decision = evaluateFollowUpSchedule({ status: "active", createdAt }, ASOF);
    expect(decision.recommended).toBe(true);
    expect(decision.reasonCode).toBe("follow-up-interval-elapsed");
    expect(decision.suggestedAt).toEqual(
      new Date(ASOF.getTime() + FOLLOW_UP_INTERVAL_DAYS * DAY_MS),
    );
  });

  it("is deterministic: the same inputs always produce the same decision", () => {
    const createdAt = new Date(ASOF.getTime() - FOLLOW_UP_INTERVAL_DAYS * DAY_MS);
    const first = evaluateFollowUpSchedule({ status: "active", createdAt }, ASOF);
    const second = evaluateFollowUpSchedule({ status: "active", createdAt }, ASOF);
    expect(second).toEqual(first);
  });
});
