/**
 * spend.ts — Agent spending management
 *
 * Self-contained data and persistence, responsible for recording and summarizing
 * various agent spending (gas, llm, invest, other).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────

export type SpendCategory = "gas" | "llm" | "invest" | "other";

export interface SpendEntry {
  category: SpendCategory;
  amount: string; // bigint as string for JSON serialization
  txHash?: string;
  timestamp: string;
}

export interface SpendingSummary {
  total: bigint;
  byCategory: Record<SpendCategory, bigint>;
  entries: SpendEntry[];
}

export interface SpendManagerConfig {
  dataDir: string;
}

const SPEND_LOG_FILE = "wallet-spending.json";

// ─── SpendManager ───────────────────────────────────────────────────────

/**
 * Manages the current agent's spending: recording, categorizing, summarizing, and persisting.
 * Self-contained spendLog data, independent of AgentWallet.
 */
export class SpendManager {
  private spendLog: SpendEntry[] = [];

  constructor(private config: SpendManagerConfig) {}

  /**
   * Record a spending entry.
   */
  record(
    category: SpendCategory,
    amount: bigint,
    txHash?: string,
  ): void {
    this.spendLog.push({
      category,
      amount: amount.toString(),
      txHash,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get the current spending summary (by category and total).
   */
  getSummary(): SpendingSummary {
    const byCategory: Record<SpendCategory, bigint> = {
      gas: 0n,
      llm: 0n,
      invest: 0n,
      other: 0n,
    };
    let total = 0n;

    for (const entry of this.spendLog) {
      const amt = BigInt(entry.amount);
      byCategory[entry.category] += amt;
      total += amt;
    }

    return { total, byCategory, entries: [...this.spendLog] };
  }

  /**
   * Get the raw list of spending entries.
   */
  getEntries(): SpendEntry[] {
    return [...this.spendLog];
  }

  /**
   * Filter spending entries by category.
   */
  getEntriesByCategory(category: SpendCategory): SpendEntry[] {
    return this.spendLog.filter((e) => e.category === category);
  }

  /**
   * Load the persisted spending log from dataDir.
   */
  async load(): Promise<void> {
    try {
      const path = join(this.config.dataDir, SPEND_LOG_FILE);
      const data = await readFile(path, "utf-8");
      this.spendLog = JSON.parse(data);
    } catch {
      // No log yet, start fresh
      this.spendLog = [];
    }
  }

  /**
   * Persist the spending log to dataDir.
   */
  async save(): Promise<void> {
    try {
      await mkdir(this.config.dataDir, { recursive: true });
      const path = join(this.config.dataDir, SPEND_LOG_FILE);
      await writeFile(path, JSON.stringify(this.spendLog, null, 2), "utf-8");
    } catch (err: unknown) {
      console.error("[spend] Failed to save spending log:", err);
    }
  }
}
