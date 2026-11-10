import { describe, expect, it } from "vitest";
import { TokenExpiryTracker } from "../src/providers/token-status.js";

describe("TokenExpiryTracker", () => {
  it("reports unsupported providers", () => {
    expect(new TokenExpiryTracker(false).status()).toMatchObject({ supported: false, expiresAt: null });
  });

  it("reports unknown expiry until a token response supplies one", () => {
    expect(new TokenExpiryTracker(true).status()).toMatchObject({ supported: true, expiresAt: null, secondsRemaining: null });
  });

  it("derives remaining time and lifetime from the token expiresAt", () => {
    let now = 1_000_000;
    const tracker = new TokenExpiryTracker(true, () => now);
    tracker.record(now + 1800_000);
    now += 600_000;
    expect(tracker.status()).toEqual({
      supported: true,
      expiresAt: new Date(1_000_000 + 1800_000).toISOString(),
      secondsRemaining: 1200,
      lifetimeSeconds: 1800,
    });
    now += 5_000_000;
    expect(tracker.status().secondsRemaining).toBe(0);
  });
});
