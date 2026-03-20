import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentWallet } from "../../src/finance/wallet.js";
import { mockRuntimeConfig } from "../helpers/fixtures.js";

const mockBalanceOf = vi.fn();

const mockContract = {
  balanceOf: mockBalanceOf,
};
const mockWallet = {
  address: "0xWalletAddress",
  getAddress: vi.fn().mockResolvedValue("0xWalletAddress"),
};

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      Contract: vi.fn(() => mockContract),
      Wallet: vi.fn(() => mockWallet),
      formatEther: (x: bigint) => String(Number(x) / 1e18),
    },
  };
});

describe("AgentWallet", () => {
  const provider = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("init() initializes token contract", async () => {
    const wallet = new AgentWallet(
      mockWallet as never,
      mockRuntimeConfig.tokenAddress,
      provider,
    );
    await wallet.init();
    // init should complete without errors
    expect(wallet.tokenAddr).toBe(mockRuntimeConfig.tokenAddress);
  });

  it("exposes tokenAddr and address accessors", async () => {
    const wallet = new AgentWallet(
      mockWallet as never,
      mockRuntimeConfig.tokenAddress,
      provider,
    );
    await wallet.init();
    expect(wallet.tokenAddr).toBe(mockRuntimeConfig.tokenAddress);
    expect(wallet.address).toBe("0xWalletAddress");
  });
});
