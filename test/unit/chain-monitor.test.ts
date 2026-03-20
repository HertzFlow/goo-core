import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainMonitor } from "../../src/survival/chain-monitor.js";
import { AgentStatus } from "../../src/types.js";
import { mockRuntimeConfig } from "../helpers/fixtures.js";

const mockToken = {
  agentWallet: vi.fn(),
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
};

const mockProvider = {
  getBalance: vi.fn(),
};

vi.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: vi.fn(() => mockProvider),
    Contract: vi.fn(() => mockToken),
    formatUnits: (amount: bigint, decimals: number) => String(Number(amount) / 10 ** decimals),
    formatEther: (amount: bigint) => String(Number(amount) / 1e18),
  },
}));

describe("ChainMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.agentWallet.mockResolvedValue("0xAgentWalletAddress");
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("1500000000000000000"));
    mockToken.starvingThreshold.mockResolvedValue(BigInt("1000000000000000000"));
    mockToken.fixedBurnRate.mockResolvedValue(BigInt("100000000000000000")); // per day
    mockToken.minRunwayHours.mockResolvedValue(24n);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(Math.floor(Date.now() / 1000) - 3600));
    mockToken.starvingEnteredAt.mockResolvedValue(0n);
    mockToken.dyingEnteredAt.mockResolvedValue(0n);
    mockToken.totalSupply.mockResolvedValue(BigInt("10000000000000000000000"));
    mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
    mockProvider.getBalance.mockResolvedValue(BigInt("50000000000000000000"));
  });

  it("constructor accepts config", () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    expect(monitor).toBeDefined();
  });

  it("init() caches agentWallet", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    expect(mockToken.agentWallet).toHaveBeenCalled();
    expect(monitor.walletAddress).toBe("0xAgentWalletAddress");
  });

  it("readState() returns ChainState with correct runway calculation", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.ACTIVE);
    expect(state.treasuryBalance).toBe(BigInt("1500000000000000000"));
    expect(state.runwayHours).toBe(360); // treasuryBalance / (fixedBurnRate/24) = 1.5e18 / (1e17/24) = 360
    expect(state.nativeBalance).toBe(BigInt("50000000000000000000"));
  });

  it("readState() returns runway 0 when fixedBurnRate is 0", async () => {
    mockToken.fixedBurnRate.mockResolvedValue(0n);
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.runwayHours).toBe(0);
  });

  it("formatBalance formats with ethers.formatEther", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const out = monitor.formatBalance(BigInt("1500000000000000000"));
    expect(out).toBeDefined();
    expect(typeof out).toBe("string");
  });

  it("formatNative returns string", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const out = monitor.formatNative(BigInt("1000000000000000000"));
    expect(out).toBeDefined();
    expect(typeof out).toBe("string");
  });

  it("tokenContract and rpcProvider getters return mock instances", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    expect(monitor.tokenContract).toBe(mockToken);
    expect(monitor.rpcProvider).toBe(mockProvider);
  });
});
