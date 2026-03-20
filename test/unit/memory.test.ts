import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ObservationLog } from "../../src/autonomy/memory.js";
import { MEMORY_MAX_OBSERVATIONS } from "../../src/const.js";
import { AgentStatus, type Observation } from "../../src/types.js";

function makeObs(heartbeat: number): Observation {
  return {
    heartbeat,
    timestamp: new Date().toISOString(),
    status: AgentStatus.ACTIVE,
    balanceUsd: 10,
    runwayHours: 24,
    summary: "",
    toolsCalled: [],
    shellCommands: [],
  };
}

describe("ObservationLog", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-memory-test-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("load() starts with empty observations when file does not exist", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    expect(log.heartbeatCount).toBe(0);
    expect(log.getRecentRaw(5)).toEqual([]);
  });

  it("load() parses existing JSONL file", async () => {
    const log = new ObservationLog(dataDir);
    await log.record(makeObs(1));
    await log.record(makeObs(2));

    const log2 = new ObservationLog(dataDir);
    await log2.load();
    expect(log2.heartbeatCount).toBe(2);
    expect(log2.getRecentRaw(2)).toHaveLength(2);
    expect(log2.getRecentRaw(2)[0].heartbeat).toBe(1);
    expect(log2.getRecentRaw(2)[1].heartbeat).toBe(2);
  });

  it("record() appends and heartbeatCount increments", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    expect(log.heartbeatCount).toBe(0);
    await log.record(makeObs(1));
    expect(log.heartbeatCount).toBe(1);
    await log.record(makeObs(2));
    expect(log.heartbeatCount).toBe(2);
  });

  it("getRecent(count) returns formatted strings", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    await log.record(makeObs(1));
    await log.record(makeObs(2));
    const recent = log.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatch(/Balance=\$10\.00/);
    expect(recent[0]).toMatch(/Runway=24h/);
  });

  it("getRecent includes shell commands when present", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    const obs: Observation = {
      ...makeObs(1),
      shellCommands: ["df -h", "free -m"],
    };
    await log.record(obs);
    const recent = log.getRecent(1);
    expect(recent[0]).toContain("commands:");
    expect(recent[0]).toContain("df -h");
  });

  it("load() truncates file when existing JSONL exceeds MEMORY_MAX_OBSERVATIONS", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= MEMORY_MAX_OBSERVATIONS + 5; i++) {
      lines.push(JSON.stringify(makeObs(i)));
    }
    writeFileSync(join(dataDir, "observations.jsonl"), lines.join("\n") + "\n", "utf-8");

    const log = new ObservationLog(dataDir);
    await log.load();
    expect(log.getRecentRaw(MEMORY_MAX_OBSERVATIONS + 1)).toHaveLength(MEMORY_MAX_OBSERVATIONS);
    expect(log.getRecentRaw(1)[0].heartbeat).toBe(MEMORY_MAX_OBSERVATIONS + 5);

    const content = readFileSync(join(dataDir, "observations.jsonl"), "utf-8");
    const kept = content.trim().split("\n").filter(Boolean);
    expect(kept.length).toBe(MEMORY_MAX_OBSERVATIONS);
  });

  it("getRecentRaw(count) returns last N observations", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    await log.record(makeObs(1));
    await log.record(makeObs(2));
    await log.record(makeObs(3));
    expect(log.getRecentRaw(2)).toHaveLength(2);
    expect(log.getRecentRaw(2)[0].heartbeat).toBe(2);
    expect(log.getRecentRaw(2)[1].heartbeat).toBe(3);
  });

  it("record() truncates when over MAX_OBSERVATIONS and rewrites file", async () => {
    const log = new ObservationLog(dataDir);
    await log.load();
    const max = 200;
    for (let i = 1; i <= max + 10; i++) {
      await log.record(makeObs(i));
    }
    expect(log.heartbeatCount).toBe(max + 10);
    const raw = log.getRecentRaw(250);
    expect(raw.length).toBeLessThanOrEqual(200);
    expect(raw[0].heartbeat).toBeGreaterThan(10);
    const content = readFileSync(join(dataDir, "observations.jsonl"), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(200);
  });
});
