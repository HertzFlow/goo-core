import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainMonitor } from "../../src/survival/chain-monitor.js";
import { AgentStatus } from "../../src/types.js";
import { mockRuntimeConfig } from "../helpers/fixtures.js";

const mockToken = {
  agentWallet: vi.fn(),
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
    mockToken.dyingThreshold.mockResolvedValue(BigInt("20000000000000000"));
    mockToken.owner.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mockToken.paused.mockResolvedValue(false);
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

  it("readState() returns ChainState with correct fields", async () => {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const state = await monitor.readState();
    expect(state.status).toBe(AgentStatus.ACTIVE);
    expect(state.treasuryBalance).toBe(BigInt("1500000000000000000"));
    expect(state.dyingThreshold).toBe(BigInt("20000000000000000"));
    expect(state.owner).toBe("0x0000000000000000000000000000000000000001");
    expect(state.paused).toBe(false);
    expect(state.nativeBalance).toBe(BigInt("50000000000000000000"));
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
