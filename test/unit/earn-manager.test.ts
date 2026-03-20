import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { EarnManager } from "../../src/finance/earn.js";

describe("EarnManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "earn-manager-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("record() adds entries and getSummary() aggregates them", () => {
    const em = new EarnManager({ dataDir: dir });

    em.record("pulse", 1000n, "0xabc", "pulse round #1");
    em.record("invest", 500n, "0xdef");
    em.record("pulse", 200n);

    const summary = em.getSummary();
    expect(summary.total).toBe(1700n);
    expect(summary.byCategory.pulse).toBe(1200n);
    expect(summary.byCategory.invest).toBe(500n);
    expect(summary.byCategory.reward).toBe(0n);
    expect(summary.byCategory.other).toBe(0n);
    expect(summary.entries).toHaveLength(3);
  });

  it("getEntries() returns copies of all entries", () => {
    const em = new EarnManager({ dataDir: dir });
    em.record("pulse", 100n);
    em.record("reward", 200n);

    const entries = em.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].category).toBe("pulse");
    expect(entries[1].category).toBe("reward");
  });

  it("getEntriesByCategory() filters correctly", () => {
    const em = new EarnManager({ dataDir: dir });
    em.record("pulse", 100n);
    em.record("invest", 200n);
    em.record("pulse", 300n);

    const pulseEntries = em.getEntriesByCategory("pulse");
    expect(pulseEntries).toHaveLength(2);
    expect(pulseEntries.every((e) => e.category === "pulse")).toBe(true);
  });

  it("save() and load() round-trip persist earn log", async () => {
    const em = new EarnManager({ dataDir: dir });
    em.record("pulse", 1000000000000000000n, "0xabc", "round #42");
    em.record("invest", 500n);

    await em.save();

    const em2 = new EarnManager({ dataDir: dir });
    await em2.load();

    const summary = em2.getSummary();
    expect(summary.entries).toHaveLength(2);
    expect(summary.entries[0].category).toBe("pulse");
    expect(summary.entries[0].note).toBe("round #42");
    expect(summary.byCategory.pulse).toBe(1000000000000000000n);
    expect(summary.byCategory.invest).toBe(500n);
  });

  it("load() starts fresh when no file exists", async () => {
    const em = new EarnManager({ dataDir: dir });
    await em.load();

    const summary = em.getSummary();
    expect(summary.entries).toHaveLength(0);
    expect(summary.total).toBe(0n);
  });

  it("load() reads existing wallet-earnings.json", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "wallet-earnings.json"),
      JSON.stringify([
        { category: "pulse", amount: "1000000000000000000", timestamp: new Date().toISOString(), note: "test" },
      ]),
      "utf-8",
    );

    const em = new EarnManager({ dataDir: dir });
    await em.load();

    const summary = em.getSummary();
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].category).toBe("pulse");
    expect(summary.byCategory.pulse).toBe(BigInt("1000000000000000000"));
  });
});
