/**
 * SurvivalManager ↔ SandboxLifecycle wiring (setSandboxLifecycle + evaluate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainMonitor, SurvivalManager } from "../../src/survival/index.js";
import type { SandboxLifecycle, SandboxHealth } from "../../src/survival/sandbox-lifecycle.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

const mockToken = {
  agentWallet: vi.fn().mockResolvedValue("0xAgent"),
  getAgentStatus: vi.fn(),
  treasuryBalance: vi.fn(),
  starvingThreshold: vi.fn(),
  fixedBurnRate: vi.fn(),
  minRunwayHours: vi.fn(),
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

function setupActiveChain() {
  mockToken.agentWallet.mockResolvedValue("0xAgent");
  mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
  mockToken.treasuryBalance.mockResolvedValue(BigInt("1500000000000000000"));
  mockToken.starvingThreshold.mockResolvedValue(BigInt("1000000000000000000"));
  mockToken.fixedBurnRate.mockResolvedValue(BigInt("100000000000000000"));
  mockToken.minRunwayHours.mockResolvedValue(24n);
  mockToken.lastPulseAt.mockResolvedValue(BigInt(Math.floor(Date.now() / 1000) - 3600));
  mockToken.starvingEnteredAt.mockResolvedValue(0n);
  mockToken.dyingEnteredAt.mockResolvedValue(0n);
  mockToken.totalSupply.mockResolvedValue(BigInt("10000000000000000000000"));
  mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
  mockProvider.getBalance.mockResolvedValue(BigInt("50000000000000000000"));
  mockToken.emitPulse.mockResolvedValue({ hash: "0xpulse", wait: () => Promise.resolve({}) });
  mockToken.MAX_SELL_BPS_VALUE.mockResolvedValue(5000);
  mockToken.survivalSell.mockResolvedValue({ wait: () => Promise.resolve({}) });
}

describe("SurvivalManager + sandbox lifecycle integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupActiveChain();
  });

  it("pushes Sandbox renewed when lifecycle reports renewed", async () => {
    const renewing: SandboxLifecycle = {
      provider: "e2b",
      async check(): Promise<SandboxHealth> {
        return {
          provider: "e2b",
          healthy: true,
          status: "renewed successfully",
          renewed: true,
        };
      },
    };

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    survival.setSandboxLifecycle(renewing);

    const actions = await survival.evaluate(makeChainState({ status: AgentStatus.ACTIVE }));
    expect(actions.some((a) => a.startsWith("Sandbox renewed:"))).toBe(true);
  });

  it("pushes WARNING when sandbox unhealthy", async () => {
    const bad: SandboxLifecycle = {
      provider: "e2b",
      async check(): Promise<SandboxHealth> {
        return {
          provider: "e2b",
          healthy: false,
          status: "expired",
          renewed: false,
        };
      },
    };

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    survival.setSandboxLifecycle(bad);

    const actions = await survival.evaluate(makeChainState({ status: AgentStatus.ACTIVE }));
    expect(actions.some((a) => a.includes("WARNING: Sandbox unhealthy"))).toBe(true);
  });

  it("surfaces status when healthy but remainingSecs under 15 minutes", async () => {
    const lowTime: SandboxLifecycle = {
      provider: "e2b",
      async check(): Promise<SandboxHealth> {
        return {
          provider: "e2b",
          healthy: true,
          status: "12min remaining",
          renewed: false,
          remainingSecs: 720,
        };
      },
    };

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    survival.setSandboxLifecycle(lowTime);

    const actions = await survival.evaluate(makeChainState({ status: AgentStatus.ACTIVE }));
    expect(actions.some((a) => a.startsWith("Sandbox:"))).toBe(true);
  });

  it("does not add sandbox line when healthy and no short remainingSecs", async () => {
    const quiet: SandboxLifecycle = {
      provider: "byod",
      async check(): Promise<SandboxHealth> {
        return {
          provider: "byod",
          healthy: true,
          status: "BYOD (self-hosted)",
          renewed: false,
        };
      },
    };

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    survival.setSandboxLifecycle(quiet);

    const actions = await survival.evaluate(makeChainState({ status: AgentStatus.ACTIVE }));
    expect(actions.some((a) => a.includes("Sandbox"))).toBe(false);
  });

  it("handles lifecycle.check() throw", async () => {
    const throwing: SandboxLifecycle = {
      provider: "none",
      async check(): Promise<SandboxHealth> {
        throw new Error("check exploded");
      },
    };

    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, mockSigner);
    survival.setSandboxLifecycle(throwing);

    const actions = await survival.evaluate(makeChainState({ status: AgentStatus.ACTIVE }));
    expect(actions.some((a) => a.includes("Sandbox check error: check exploded"))).toBe(true);
  });
});
