import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureWalletGas } from "../../src/finance/action/gas-refill.js";
import type { SpendManager } from "../../src/finance/spend.js";

const mockGetBalance = vi.fn();
const mockWithdrawToWallet = vi.fn();
const mockWithdrawStaticCall = vi.fn();

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      Contract: vi.fn((_addr: string) => {
        return {
          withdrawToWallet: Object.assign(mockWithdrawToWallet, {
            staticCall: mockWithdrawStaticCall,
          }),
          treasuryBalance: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
          starvingThreshold: vi.fn().mockResolvedValue(BigInt("500000000000000000")),
        };
      }),
      Wallet: vi.fn(() => ({ address: "0xWallet" })),
      formatEther: (x: bigint) => String(Number(x) / 1e18),
    },
  };
});

function makeWallet() {
  return {
    signer: { address: "0xWallet", getAddress: vi.fn().mockResolvedValue("0xWallet") } as never,
    rpcProvider: { getBalance: mockGetBalance } as never,
    tokenAddr: "0xToken",
  } as never;
}

function makeSpendManager(): SpendManager {
  return { record: vi.fn() } as unknown as SpendManager;
}

describe("gas-refill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: treasury NOT available (staticCall rejects without "Goo:")
    mockWithdrawStaticCall.mockRejectedValue(new Error("missing function"));
  });

  it("does nothing when native balance is sufficient", async () => {
    mockGetBalance.mockResolvedValue(2000n);

    const result = await ensureWalletGas(makeWallet(), {
      minGasBalance: 1000n,
      gasRefillAmount: 500n,
    });

    expect(result.refilled).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("withdraws from treasury when gas is low and treasury supports withdraw", async () => {
    mockGetBalance.mockResolvedValue(100n);
    // Treasury IS available (staticCall rejects with "Goo:")
    mockWithdrawStaticCall.mockRejectedValue(new Error("Goo: insufficient balance"));
    mockWithdrawToWallet.mockResolvedValue({ wait: vi.fn().mockResolvedValue({ hash: "0xWithdraw" }) });

    const result = await ensureWalletGas(makeWallet(), {
      minGasBalance: 1000n,
      gasRefillAmount: 500n,
    });

    expect(result.refilled).toBe(true);
    expect(result.txHash).toBe("0xWithdraw");
    expect(result.amount).toBe(500n);
  });

  it("returns error when treasury withdraw not supported", async () => {
    mockGetBalance.mockResolvedValue(100n);
    // Treasury NOT available (default — staticCall rejects without "Goo:")

    const result = await ensureWalletGas(makeWallet(), {
      minGasBalance: 1000n,
      gasRefillAmount: 500n,
    });

    expect(result.refilled).toBe(false);
    expect(result.error).toBe("Treasury withdraw not supported");
  });

  it("returns error when treasury withdraw call fails", async () => {
    mockGetBalance.mockResolvedValue(100n);
    // Treasury IS available
    mockWithdrawStaticCall.mockRejectedValue(new Error("Goo: zero amount"));
    mockWithdrawToWallet.mockRejectedValue(new Error("execution reverted"));

    const result = await ensureWalletGas(makeWallet(), {
      minGasBalance: 1000n,
      gasRefillAmount: 500n,
    });

    expect(result.refilled).toBe(false);
    expect(result.error).toContain("Gas refill failed");
    expect(result.error).toContain("execution reverted");
  });

  it("records spend via spendManager after successful withdraw", async () => {
    mockGetBalance.mockResolvedValue(100n);
    mockWithdrawStaticCall.mockRejectedValue(new Error("Goo: zero"));
    mockWithdrawToWallet.mockResolvedValue({ wait: vi.fn().mockResolvedValue({ hash: "0xWithdrawTx" }) });

    const sm = makeSpendManager();
    await ensureWalletGas(makeWallet(), {
      minGasBalance: 1000n,
      gasRefillAmount: 500n,
    }, sm);

    expect((sm.record as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("gas", 500n, "0xWithdrawTx");
  });
});
