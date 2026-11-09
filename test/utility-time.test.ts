import { describe, expect, it } from "vitest";
import { fromUnixTime, formatDateTime, previousWeekday, toUnixTime } from "../src/utility/time.js";

describe("time utilities", () => {
  it("converts a Date to Unix time in milliseconds", () => {
    const value = new Date("2024-01-01T00:00:00.000Z");
    expect(toUnixTime(value)).toBe(1704067200000);
  });

  it("converts Unix time back to a Date", () => {
    const date = fromUnixTime(1704067200000);
    expect(date.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("formats a readable UTC date and time", () => {
    expect(formatDateTime(1704067200000)).toBe("2024-01-01 00:00:00 UTC");
  });

  it.each([
    ["2026-03-03T12:30:00.000Z", "2026-03-02"],
    ["2026-03-02T12:30:00.000Z", "2026-02-27"],
    ["2026-03-07T12:30:00.000Z", "2026-03-06"],
    ["2026-03-08T12:30:00.000Z", "2026-03-06"],
    ["2026-07-07T11:30:00.000Z", "2026-07-06"],
    ["2026-01-02T12:30:00.000Z", "2026-01-01"]
  ])("resolves the previous America/New_York weekday for %s", (now, expected) => {
    expect(previousWeekday(new Date(now)).toISOString()).toBe(`${expected}T00:00:00.000Z`);
  });
});
