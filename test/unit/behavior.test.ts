import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutonomousBehavior } from "../../src/autonomy/behavior.js";
import { AgentStatus, type ChainState } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

const mockMonitor = {
  readState: vi.fn(),
  walletAddress: "0xWallet",
  formatBalance: (x: bigint) => String(Number(x) / 1e18),
  formatNative: (x: bigint) => String(Number(x) / 1e18),
  rpcProvider: {},
  tokenContract: {},
};

const mockSurvival = {
  evaluate: vi.fn().mockResolvedValue([]),
};

describe("AutonomousBehavior", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-behavior-test-"));
    vi.clearAllMocks();
    mockSurvival.evaluate.mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function makeBehavior() {
    const config = { ...mockRuntimeConfig, dataDir };
    return new AutonomousBehavior(
      mockMonitor as never,
      mockSurvival as never,
      config
    );
  }

  it("init() creates SOUL and loads memory", async () => {
    const behavior = makeBehavior();
    await behavior.init();
    const soul = (behavior as unknown as { soul: { read: () => Promise<string> } }).soul;
    const content = await soul.read();
    expect(content).toContain("SOUL");
  });

  it("onHeartbeat() throws when not initialized", async () => {
    const behavior = makeBehavior();
    const state = makeChainState();
    await expect(behavior.onHeartbeat(state)).rejects.toThrow("not initialized");
  });

  it("onHeartbeat() when DEAD records observation and does not call survival", async () => {
    const behavior = makeBehavior();
    await behavior.init();

    const state = makeChainState({ status: AgentStatus.DEAD });
    const obs = await behavior.onHeartbeat(state);

    expect(obs.status).toBe(AgentStatus.DEAD);
    expect(obs.summary).toContain("Dead");
    expect(obs.toolsCalled).toEqual([]);
    expect(mockSurvival.evaluate).not.toHaveBeenCalled();
  });

  it("onHeartbeat() when ACTIVE calls survival.evaluate and records observation", async () => {
    const behavior = makeBehavior();
    await behavior.init();

    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const obs = await behavior.onHeartbeat(state);

    expect(mockSurvival.evaluate).toHaveBeenCalledWith(state);
    expect(obs.summary).toBe("Survival OK");
    expect(obs.status).toBe(AgentStatus.ACTIVE);
  });

  it("onHeartbeat() when survival.evaluate throws still records observation", async () => {
    mockSurvival.evaluate.mockRejectedValue(new Error("survival error"));
    const behavior = makeBehavior();
    await behavior.init();
    const state = makeChainState();
    const obs = await behavior.onHeartbeat(state);
    expect(obs).toBeDefined();
    expect(obs.summary).toContain("Survival evaluation error");
    expect(mockSurvival.evaluate).toHaveBeenCalledWith(state);
  });
});
