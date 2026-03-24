import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainMonitor, SurvivalManager } from "../../src/survival/index.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

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

const mockSigner = {
  getAddress: vi.fn().mockResolvedValue("0xMockWallet"),
  address: "0xMockWallet",
} as never;

describe("ChainMonitor + SurvivalManager integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.agentWallet.mockResolvedValue("0xAgent");
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("1500000000000000000"));
    mockToken.starvingThreshold.mockResolvedValue(BigInt("1000000000000000000"));
    mockToken.dyingThreshold.mockResolvedValue(BigInt("20000000000000000"));
    mockToken.owner.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mockToken.paused.mockResolvedValue(false);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(0));
    mockToken.starvingEnteredAt.mockResolvedValue(0n);
    mockToken.dyingEnteredAt.mockResolvedValue(0n);
    mockToken.totalSupply.mockResolvedValue(BigInt("10000000000000000000000"));
    mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
    mockProvider.getBalance.mockResolvedValue(BigInt("50000000000000000000"));
    mockToken.emitPulse.mockResolvedValue({ hash: "0xpulse", wait: () => Promise.resolve({}) });
    mockToken.MAX_SELL_BPS_VALUE.mockResolvedValue(5000);
    mockToken.survivalSell.mockResolvedValue({ wait: () => Promise.resolve({ hash: "0xsell" }) });
  });

  it("Monitor readState + Survival evaluate produce consistent flow for ACTIVE", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.ACTIVE);

    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(Array.isArray(actions)).toBe(true);
  });

  it("Monitor readState + Survival evaluate for DEAD returns DEAD message", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DEAD);
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.DEAD);

    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions).toContain("Agent is DEAD. No actions possible.");
  });

  it("Monitor readState + Survival evaluate for STARVING returns actions (gas/pulse/sell path)", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.STARVING);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("500000000000000000"));
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.STARVING);

    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(Array.isArray(actions)).toBe(true);
  });

  it("Low native balance triggers gas warning in survival actions", async () => {
    mockProvider.getBalance.mockResolvedValue(BigInt("1000000000000000"));
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("WARNING") && a.includes("Native balance"))).toBe(true);
  });

  it("DYING state: Survival attempts Pulse and SurvivalSell when tokenHoldings > 0", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DYING);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("100000000000000000"));
    mockToken.lastPulseAt.mockResolvedValue(BigInt(0)); // old pulse → should emit
    mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
    mockToken.emitPulse.mockResolvedValue({ hash: "0xp", wait: () => Promise.resolve({}) });
    mockToken.survivalSell.mockResolvedValue({ wait: () => Promise.resolve({ hash: "0xs" }) });

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.DYING);

    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.length).toBeGreaterThan(0);
    const hasPulse = actions.some((a) => a.includes("Pulse sent") || a.includes("Pulse failed"));
    const hasSell = actions.some(
      (a) => a.includes("SurvivalSell") || a.includes("No token holdings") || a.includes("cooldown")
    );
    expect(hasPulse || hasSell).toBe(true);
    if (state.tokenHoldings > 0n) {
      expect(mockToken.emitPulse).toHaveBeenCalled();
      expect(mockToken.survivalSell).toHaveBeenCalled();
    }
  });

  it("SurvivalSell cooldown: contract reverts with cooldown → action contains cooldown message", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DYING);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(Math.floor(Date.now() / 1000) - 100000));
    mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
    mockToken.emitPulse.mockResolvedValue({ hash: "0xp", wait: () => Promise.resolve({}) });
    mockToken.survivalSell.mockRejectedValue(new Error("SURVIVAL_SELL_COOLDOWN not elapsed"));

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.toLowerCase().includes("cooldown"))).toBe(true);
  });

  it("Pulse emit failure: emitPulse rejects → action contains Pulse failed", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(0));
    mockToken.emitPulse.mockRejectedValue(new Error("out of gas"));

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("Pulse failed"))).toBe(true);
  });

  it("DYING with zero token holdings: SurvivalSell path returns no token holdings message", async () => {
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.DYING);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(0));
    mockToken.balanceOf.mockResolvedValue(0n);
    mockToken.emitPulse.mockResolvedValue({ hash: "0xp", wait: () => Promise.resolve({}) });

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.tokenHoldings).toBe(0n);
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("No token holdings to sell"))).toBe(true);
  });

  it("Zero native balance triggers gas warning (Gas Bootstrap edge)", async () => {
    mockProvider.getBalance.mockResolvedValue(0n);
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("WARNING") && a.includes("Native balance"))).toBe(true);
  });
});
