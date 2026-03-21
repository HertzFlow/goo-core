/**
 * Maiat Reputation Layer for Goo Agents
 *
 * Integrates Maiat Protocol's trust scoring into the Goo survival loop.
 * Each Goo agent gets a behavioral trust score (0-100) based on:
 *   - On-chain transaction history (50%)
 *   - Off-chain behavioral signals (30%)
 *   - Community reviews (20%)
 *
 * High-reputation agents get survival advantages:
 *   - Lower effective burn rate (longer runway)
 *   - Priority in buyback allocation
 *   - Visible trust badge on Maiat leaderboard
 *
 * Low-reputation agents face consequences:
 *   - Flagged for community review
 *   - No buyback benefits
 *
 * API: https://app.maiat.io/api/v1/trust
 * Docs: https://app.maiat.io/docs
 */

import { emitEvent } from "../events.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaiatTrustResult {
  address: string;
  type: "agent" | "token" | "unknown";
  trustScore: number | null;
  verdict: "trusted" | "proceed" | "caution" | "avoid" | "unknown";
  summary: string;
  learnMore?: string;
}

export interface ReputationConfig {
  /** Enable/disable Maiat reputation checks (default: true) */
  enabled: boolean;
  /** Maiat API base URL (default: https://app.maiat.io) */
  apiUrl: string;
  /** How often to refresh trust score in seconds (default: 3600 = 1 hour) */
  refreshIntervalSecs: number;
  /** Minimum trust score to qualify for reputation benefits (default: 60) */
  benefitThreshold: number;
  /** Trust score below which agent is flagged (default: 30) */
  warningThreshold: number;
}

const DEFAULT_CONFIG: ReputationConfig = {
  enabled: true,
  apiUrl: "https://app.maiat.io",
  refreshIntervalSecs: 3600,
  benefitThreshold: 60,
  warningThreshold: 30,
};

// ---------------------------------------------------------------------------
// Maiat Reputation Manager
// ---------------------------------------------------------------------------

export class MaiatReputation {
  private config: ReputationConfig;
  private lastFetchTime: number = 0;
  private cachedScore: MaiatTrustResult | null = null;
  private agentAddress: string;

  constructor(agentAddress: string, config?: Partial<ReputationConfig>) {
    this.agentAddress = agentAddress;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch trust score from Maiat API.
   * Caches result for `refreshIntervalSecs` to avoid excessive API calls.
   */
  async getTrustScore(): Promise<MaiatTrustResult | null> {
    if (!this.config.enabled) return null;

    const now = Date.now();
    if (
      this.cachedScore &&
      now - this.lastFetchTime < this.config.refreshIntervalSecs * 1000
    ) {
      return this.cachedScore;
    }

    try {
      const url = `${this.config.apiUrl}/api/v1/trust?address=${this.agentAddress}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "goo-core/maiat-reputation" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        emitEvent("maiat_reputation_error", "warn", `Maiat API returned ${res.status}`);
        return this.cachedScore; // Return stale cache on error
      }

      const data = (await res.json()) as MaiatTrustResult;
      this.cachedScore = data;
      this.lastFetchTime = now;

      emitEvent("maiat_reputation_updated", "info", `Trust score: ${data.trustScore} (${data.verdict})`, {
        trustScore: data.trustScore,
        verdict: data.verdict,
      });

      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("maiat_reputation_error", "warn", `Failed to fetch trust score: ${msg}`);
      return this.cachedScore; // Return stale cache on network error
    }
  }

  /**
   * Evaluate reputation in the context of survival.
   * Called from SurvivalManager.evaluate() to add reputation-aware actions.
   */
  async evaluate(): Promise<string[]> {
    const actions: string[] = [];
    const trust = await this.getTrustScore();

    if (!trust || trust.trustScore === null) {
      actions.push("Maiat: No trust data available (agent may not be indexed yet)");
      return actions;
    }

    const score = trust.trustScore;

    if (score >= this.config.benefitThreshold) {
      actions.push(
        `Maiat: Trust score ${score}/100 (${trust.verdict}) — reputation benefits active`
      );
    } else if (score >= this.config.warningThreshold) {
      actions.push(
        `Maiat: Trust score ${score}/100 (${trust.verdict}) — below benefit threshold`
      );
    } else {
      actions.push(
        `Maiat: Trust score ${score}/100 (${trust.verdict}) — LOW REPUTATION WARNING`
      );
      emitEvent("maiat_low_reputation", "warn", `Agent trust score critically low: ${score}`, {
        trustScore: score,
        verdict: trust.verdict,
      });
    }

    return actions;
  }

  /**
   * Report an outcome back to Maiat after a completed job/transaction.
   * This helps build the agent's reputation over time.
   */
  async reportOutcome(outcome: {
    jobId?: string;
    success: boolean;
    txHash?: string;
    counterparty?: string;
  }): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const url = `${this.config.apiUrl}/api/v1/outcome`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "goo-core/maiat-reputation",
        },
        body: JSON.stringify({
          agentAddress: this.agentAddress,
          ...outcome,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        emitEvent("maiat_outcome_reported", "info", `Outcome reported: ${outcome.success ? "success" : "failure"}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Get the cached trust score without making an API call */
  getCachedScore(): MaiatTrustResult | null {
    return this.cachedScore;
  }

  /** Check if agent qualifies for reputation benefits */
  hasBenefits(): boolean {
    return (this.cachedScore?.trustScore ?? 0) >= this.config.benefitThreshold;
  }
}
