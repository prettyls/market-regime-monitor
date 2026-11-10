export type TokenStatus = Readonly<{
  /** False when the active data provider does not use an OAuth access token. */
  supported: boolean;
  /** ISO timestamp of access token expiry, or null until a token response reports it. */
  expiresAt: string | null;
  /** Whole seconds until expiry (never negative), or null when expiry is unknown. */
  secondsRemaining: number | null;
  /** Lifetime of the most recent token in seconds, or null when unknown. Used to size the UI bar. */
  lifetimeSeconds: number | null;
}>;

/** Remembers when the current access token expires, as reported by the token endpoint response. */
export class TokenExpiryTracker {
  private expiresAtMs: number | undefined;
  private issuedAtMs: number | undefined;

  constructor(private readonly supported: boolean, private readonly now: () => number = Date.now) {}

  record(expiresAt: number | undefined): void {
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
      this.expiresAtMs = expiresAt;
      this.issuedAtMs = this.now();
    } else {
      this.expiresAtMs = undefined;
      this.issuedAtMs = undefined;
    }
  }

  status(): TokenStatus {
    if (!this.supported) return { supported: false, expiresAt: null, secondsRemaining: null, lifetimeSeconds: null };
    if (this.expiresAtMs === undefined || this.issuedAtMs === undefined) {
      return { supported: true, expiresAt: null, secondsRemaining: null, lifetimeSeconds: null };
    }
    return {
      supported: true,
      expiresAt: new Date(this.expiresAtMs).toISOString(),
      secondsRemaining: Math.max(0, Math.floor((this.expiresAtMs - this.now()) / 1000)),
      lifetimeSeconds: Math.max(1, Math.round((this.expiresAtMs - this.issuedAtMs) / 1000)),
    };
  }
}
