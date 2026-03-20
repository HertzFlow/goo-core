import { describe, it, expect, vi, beforeEach } from "vitest";
import { SurvivalManager } from "../../src/survival/survival-manager.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

const mockMonitor = {
  formatNative: (x: bigint) => String(Number(x) / 1e18),
  rpcProvider: {},
};

const mockTokenContract = {
  emitPulse: vi.fn(),
  MAX_SELL_BPS_VALUE: vi.fn(),
  survivalSell: vi.fn(),
  PULSE_TIMEOUT_SECS: vi.fn(),
};

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      Wallet: vi.fn(function (this: { connect: () => unknown }) {
        this.connect = () => this;
        return this;
      }),
      Contract: vi.fn(() => mockTokenContract),
    },
  };
});

describe("SurvivalManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenContract.PULSE_TIMEOUT_SECS.mockResolvedValue(172800);
    mockTokenContract.emitPulse.mockResolvedValue({ hash: "0xabc", wait: () => Promise.resolve({}) });
    mockTokenContract.MAX_SELL_BPS_VALUE.mockResolvedValue(5000); // 50%
    mockTokenContract.survivalSell.mockResolvedValue({
      wait: () => Promise.resolve({ hash: "0xdef" }),
    });
  });

  it("evaluate() when DEAD returns only DEAD message", async () => {
    const state = makeChainState({ status: AgentStatus.DEAD });
    const survival = new SurvivalManager(mockMonitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMock") } as never);
    const actions = await survival.evaluate(state);
    expect(actions).toContain("Agent is DEAD. No actions possible.");
    expect(mockTokenContract.emitPulse).not.toHaveBeenCalled();
    expect(mockTokenContract.survivalSell).not.toHaveBeenCalled();
  });

  it("evaluate() when native balance below min pushes WARNING", async () => {
    const state = makeChainState({
      status: AgentStatus.ACTIVE,
      nativeBalance: BigInt("1000000000000000"),
    });
    const survival = new SurvivalManager(mockMonitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMock") } as never);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("WARNING") && a.includes("Native balance"))).toBe(true);
  });

  it("evaluate() when STARVING may call survivalSell", async () => {
    const state = makeChainState({
      status: AgentStatus.STARVING,
      tokenHoldings: BigInt("1000000000000000000000"),
      lastPulseAt: BigInt(0),
    });
    mockTokenContract.PULSE_TIMEOUT_SECS.mockResolvedValue(172800);
    const survival = new SurvivalManager(mockMonitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMock") } as never);
    const actions = await survival.evaluate(state);
    expect(actions.length).toBeGreaterThanOrEqual(0);
    if (state.tokenHoldings > 0n) {
      const sellMsg = actions.find((a) => a.includes("SurvivalSell") || a.includes("No token"));
      expect(sellMsg).toBeDefined();
    }
  });

  it("evaluate() when tokenHoldings 0 survivalSell returns no tokens message", async () => {
    const state = makeChainState({
      status: AgentStatus.DYING,
      tokenHoldings: 0n,
    });
    const survival = new SurvivalManager(mockMonitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMock") } as never);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("No token holdings"))).toBe(true);
  });

  it("evaluate() survivalSell cooldown returns skipped message", async () => {
    const state = makeChainState({
      status: AgentStatus.DYING,
      tokenHoldings: BigInt("1000000000000000000000"),
    });
    mockTokenContract.survivalSell.mockRejectedValue(new Error("cooldown active"));
    const survival = new SurvivalManager(mockMonitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMock") } as never);
    const actions = await survival.evaluate(state);
    expect(actions.some((a) => a.includes("cooldown"))).toBe(true);
  });
});
