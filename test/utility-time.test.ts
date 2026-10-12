import { describe, expect, it } from "vitest";
import { fromUnixTime, formatDateTime, toUnixTime } from "../src/utility/time.js";

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
});
