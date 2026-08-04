import { describe, expect, it } from "vitest";
import { computeDetectionWindow } from "./detection-window";

describe("computeDetectionWindow", () => {
  it("buckets a date into its ISO week", () => {
    // 2026-01-05 is a Monday, ISO week 2 of 2026.
    expect(computeDetectionWindow(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });

  it("buckets every day of the same week identically", () => {
    const monday = computeDetectionWindow(new Date("2026-01-05T00:00:00Z"));
    const wednesday = computeDetectionWindow(new Date("2026-01-07T12:00:00Z"));
    const sunday = computeDetectionWindow(new Date("2026-01-11T23:59:59Z"));

    expect(wednesday).toBe(monday);
    expect(sunday).toBe(monday);
  });

  it("assigns adjacent weeks different windows", () => {
    const week2 = computeDetectionWindow(new Date("2026-01-08T00:00:00Z"));
    const week3 = computeDetectionWindow(new Date("2026-01-15T00:00:00Z"));

    expect(week2).not.toBe(week3);
  });

  it("assigns the last days of December to next year's week 1 when appropriate", () => {
    // 2025-12-29 (Monday) starts the ISO week containing Jan 1, 2026 (a
    // Thursday) — so it belongs to ISO year 2026, week 1.
    expect(computeDetectionWindow(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });

  it("assigns the first days of January to the previous year's last week when appropriate", () => {
    // 2027-01-01 is a Friday; the ISO week it belongs to (Mon Dec 28 -
    // Sun Jan 3) has its Thursday in 2026, so it's ISO year 2026's last
    // week.
    expect(computeDetectionWindow(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("is deterministic: the same instant always produces the same window", () => {
    const date = new Date("2026-03-17T08:30:00Z");
    expect(computeDetectionWindow(date)).toBe(computeDetectionWindow(new Date(date.getTime())));
  });
});
