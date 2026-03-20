/**
 * earn.ts — Agent income management
 *
 * Self-contained data and persistence, responsible for recording and summarizing
 * various agent income (pulse rewards, investment returns, etc.) for runway and P&L analysis.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────

export type EarnCategory = "pulse" | "invest" | "reward" | "other";

export interface EarnEntry {
  category: EarnCategory;
  amount: string; // bigint as string for JSON
  txHash?: string;
  timestamp: string;
  /** Optional note, e.g. "pulse round #42" */
  note?: string;
}

export interface EarningSummary {
  total: bigint;
  byCategory: Record<EarnCategory, bigint>;
  entries: EarnEntry[];
}

export interface EarnManagerConfig {
  dataDir: string;
}

// ─── EarnManager ───────────────────────────────────────────────────────

const EARN_LOG_FILE = "wallet-earnings.json";

/**
 * Manages the current agent's income: records earnings, summarizes by category, and persists the earnings log.
 */
export class EarnManager {
  private earnLog: EarnEntry[] = [];

  constructor(private config: EarnManagerConfig) {}

  /**
   * Record an income entry.
   */
  record(
    category: EarnCategory,
    amount: bigint,
    txHash?: string,
    note?: string,
  ): void {
    this.earnLog.push({
      category,
      amount: amount.toString(),
      txHash,
      timestamp: new Date().toISOString(),
      note,
    });
  }

  /**
   * Get earnings summary (total and by category).
   */
  getSummary(): EarningSummary {
    const byCategory: Record<EarnCategory, bigint> = {
      pulse: 0n,
      invest: 0n,
      reward: 0n,
      other: 0n,
    };
    let total = 0n;
    for (const entry of this.earnLog) {
      const amt = BigInt(entry.amount);
      byCategory[entry.category] += amt;
      total += amt;
    }
    return { total, byCategory, entries: [...this.earnLog] };
  }

  getEntries(): EarnEntry[] {
    return [...this.earnLog];
  }

  getEntriesByCategory(category: EarnCategory): EarnEntry[] {
    return this.earnLog.filter((e) => e.category === category);
  }

  /**
   * Load the persisted earnings log.
   */
  async load(): Promise<void> {
    try {
      const raw = await readFile(
        join(this.config.dataDir, EARN_LOG_FILE),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      this.earnLog = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.earnLog = [];
    }
  }

  /**
   * Persist the earnings log to dataDir.
   */
  async save(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true });
    await writeFile(
      join(this.config.dataDir, EARN_LOG_FILE),
      JSON.stringify(this.earnLog, null, 2),
    );
  }
}
