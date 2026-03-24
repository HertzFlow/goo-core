import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChainMonitor, SurvivalManager } from "../../src/survival/index.js";
import { AutonomousBehavior } from "../../src/autonomy/behavior.js";
import { makeChainState, mockRuntimeConfig, AgentStatus } from "../helpers/fixtures.js";

const mockToken = {
  agentWallet: vi.fn().mockResolvedValue("0xAgent"),
  getAgentStatus: vi.fn(),
  treasuryBalance: vi.fn(),
  starvingThreshold: vi.fn(),
  dyingThreshold: vi.fn(),
  owner: vi.fn(),
  paused: vi.fn(),
  lastPulseAt: vi.fn(),
  starvingEnteredAt: vi.fn(),
  dyingEnteredAt: vi.fn(),
  totalSupply: vi.fn(),
  balanceOf: vi.fn(),
  emitPulse: vi.fn(),
  MAX_SELL_BPS_VALUE: vi.fn(),
  survivalSell: vi.fn(),
  PULSE_TIMEOUT_SECS: vi.fn().mockResolvedValue(172800),
};
const mockProvider = { getBalance: vi.fn() };

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn(() => mockProvider),
      Contract: vi.fn(() => mockToken),
      Wallet: vi.fn(function (this: { connect: () => unknown; getAddress: () => Promise<string>; address: string }) {
        this.connect = () => this;
        this.getAddress = () => Promise.resolve("0xMockWallet");
        this.address = "0xMockWallet";
        return this;
      }),
    },
  };
});

function setupChainMocks() {
  mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
  mockToken.treasuryBalance.mockResolvedValue(BigInt("1500000000000000000"));
  mockToken.starvingThreshold.mockResolvedValue(BigInt("1000000000000000000"));
  mockToken.dyingThreshold.mockResolvedValue(BigInt("20000000000000000"));
  mockToken.owner.mockResolvedValue("0x0000000000000000000000000000000000000001");
  mockToken.paused.mockResolvedValue(false);
  mockToken.lastPulseAt.mockResolvedValue(BigInt(Math.floor(Date.now() / 1000) - 3600));
  mockToken.starvingEnteredAt.mockResolvedValue(0n);
  mockToken.dyingEnteredAt.mockResolvedValue(0n);
  mockToken.totalSupply.mockResolvedValue(BigInt("10000000000000000000000"));
  mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
  mockProvider.getBalance.mockResolvedValue(BigInt("50000000000000000000"));
  mockToken.emitPulse.mockResolvedValue({ hash: "0xp", wait: () => Promise.resolve({}) });
  mockToken.MAX_SELL_BPS_VALUE.mockResolvedValue(5000);
  mockToken.survivalSell.mockResolvedValue({ wait: () => Promise.resolve({}) });
}

describe("Autonomy integration", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-autonomy-int-"));
    vi.clearAllMocks();
    mockToken.agentWallet.mockResolvedValue("0xAgent");
    setupChainMocks();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("one full heartbeat: init, onHeartbeat, observation recorded (no LLM — delegated to OpenClaw)", async () => {
    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    const obs = await behavior.onHeartbeat(state);

    expect(obs.heartbeat).toBe(1);
    expect(obs.status).toBe(state.status);
    expect(obs.runwayHours).toBeDefined();
    expect(obs.summary).toBeDefined();
    expect(obs.toolsCalled).toEqual([]);
  });

  it("DEAD state: one heartbeat records observation, survival not called", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DEAD);

    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.DEAD);

    const obs = await behavior.onHeartbeat(state);
    expect(obs.status).toBe(AgentStatus.DEAD);
    expect(obs.summary).toContain("Dead");
    expect(obs.toolsCalled).toEqual([]);

    const actions = await survival.evaluate(state);
    expect(actions).toContain("Agent is DEAD. No actions possible.");
  });

  it("two consecutive heartbeats: memory has two observations", async () => {
    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    const obs1 = await behavior.onHeartbeat(state);
    expect(obs1.heartbeat).toBe(1);

    const obs2 = await behavior.onHeartbeat(state);
    expect(obs2.heartbeat).toBe(2);

    const observationsPath = join(dataDir, "observations.jsonl");
    const content = readFileSync(observationsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    const [rec1, rec2] = lines.map((l) => JSON.parse(l));
    expect(rec1.heartbeat).toBe(1);
    expect(rec2.heartbeat).toBe(2);
  });

  it("survival action (Pulse) is executed during heartbeat", async () => {
    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    const obs = await behavior.onHeartbeat(state);
    expect(obs.heartbeat).toBe(1);
    expect(obs.summary).toBeDefined();
    expect(mockToken.emitPulse).toHaveBeenCalled();
  });

  it("STARVING state: observation records correct status", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.STARVING);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("500000000000000000"));

    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.STARVING);
    const obs = await behavior.onHeartbeat(state);
    expect(obs.status).toBe(AgentStatus.STARVING);
    expect(obs.heartbeat).toBe(1);
  });

  it("DYING state: observation records correct status", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DYING);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("100000000000000000"));
    mockToken.lastPulseAt.mockResolvedValue(BigInt(0));

    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.DYING);
    const obs = await behavior.onHeartbeat(state);
    expect(obs.status).toBe(AgentStatus.DYING);
    expect(obs.summary).toBeDefined();
  });

  it("ACTIVE with low treasury: observation records correct status", async () => {
    mockToken.treasuryBalance.mockResolvedValue(BigInt("500000000000000000"));

    const config = { ...mockRuntimeConfig, dataDir };
    const monitor = new ChainMonitor(config);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, config, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const behavior = new AutonomousBehavior(monitor as never, survival as never, config);
    await behavior.init();

    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.ACTIVE);
    expect(state.treasuryBalance).toBe(BigInt("500000000000000000"));
    const obs = await behavior.onHeartbeat(state);
    expect(obs.status).toBe(AgentStatus.ACTIVE);
  });
});
