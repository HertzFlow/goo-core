import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SpendManager } from "../../src/finance/spend.js";

describe("SpendManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spend-manager-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("record() adds entries and getSummary() aggregates them", () => {
    const sm = new SpendManager({ dataDir: dir });

    sm.record("gas", 1000n, "0xabc");
    sm.record("llm", 500n, "0xdef");
    sm.record("gas", 200n);

    const summary = sm.getSummary();
    expect(summary.total).toBe(1700n);
    expect(summary.byCategory.gas).toBe(1200n);
    expect(summary.byCategory.llm).toBe(500n);
    expect(summary.byCategory.invest).toBe(0n);
    expect(summary.byCategory.other).toBe(0n);
    expect(summary.entries).toHaveLength(3);
  });

  it("getEntries() returns copies of all entries", () => {
    const sm = new SpendManager({ dataDir: dir });
    sm.record("gas", 100n);
    sm.record("llm", 200n);

    const entries = sm.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].category).toBe("gas");
    expect(entries[1].category).toBe("llm");
  });

  it("getEntriesByCategory() filters correctly", () => {
    const sm = new SpendManager({ dataDir: dir });
    sm.record("gas", 100n);
    sm.record("llm", 200n);
    sm.record("gas", 300n);

    const gasEntries = sm.getEntriesByCategory("gas");
    expect(gasEntries).toHaveLength(2);
    expect(gasEntries.every((e) => e.category === "gas")).toBe(true);
  });

  it("save() and load() round-trip persist spend log", async () => {
    const sm = new SpendManager({ dataDir: dir });
    sm.record("gas", 1000000000000000000n, "0xabc");
    sm.record("llm", 500n);

    await sm.save();

    // Load into a fresh instance
    const sm2 = new SpendManager({ dataDir: dir });
    await sm2.load();

    const summary = sm2.getSummary();
    expect(summary.entries).toHaveLength(2);
    expect(summary.entries[0].category).toBe("gas");
    expect(summary.byCategory.gas).toBe(1000000000000000000n);
    expect(summary.byCategory.llm).toBe(500n);
  });

  it("load() starts fresh when no file exists", async () => {
    const sm = new SpendManager({ dataDir: dir });
    await sm.load();

    const summary = sm.getSummary();
    expect(summary.entries).toHaveLength(0);
    expect(summary.total).toBe(0n);
  });

  it("load() reads existing wallet-spending.json (backwards compatible)", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "wallet-spending.json"),
      JSON.stringify([
        { category: "gas", amount: "1000000000000000000", timestamp: new Date().toISOString() },
      ]),
      "utf-8",
    );

    const sm = new SpendManager({ dataDir: dir });
    await sm.load();

    const summary = sm.getSummary();
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].category).toBe("gas");
    expect(summary.byCategory.gas).toBe(BigInt("1000000000000000000"));
  });
});
