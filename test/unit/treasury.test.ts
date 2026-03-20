import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectTreasuryCapabilities, withdrawFromTreasury } from "../../src/finance/action/treasury.js";

const mockStaticCall = vi.fn();
const mockWithdrawToWallet = vi.fn();
const mockWait = vi.fn();

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      Contract: vi.fn(() => ({
        withdrawToWallet: Object.assign(mockWithdrawToWallet, {
          staticCall: mockStaticCall,
        }),
      })),
      formatUnits: (amount: bigint, decimals: number) =>
        (Number(amount) / 10 ** decimals).toString(),
    },
  };
});

describe("treasury", () => {
  const provider = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectTreasuryCapabilities", () => {
    it("returns hasWithdrawToWallet=false when staticCall rejects without Goo:", async () => {
      mockStaticCall.mockRejectedValue(new Error("missing function"));
      const caps = await detectTreasuryCapabilities("0xToken", provider);
      expect(caps.hasWithdrawToWallet).toBe(false);
    });

    it("returns hasWithdrawToWallet=true when staticCall rejects with Goo:", async () => {
      mockStaticCall.mockRejectedValue(new Error("Goo: insufficient balance"));
      const caps = await detectTreasuryCapabilities("0xToken", provider);
      expect(caps.hasWithdrawToWallet).toBe(true);
    });

    it("returns hasWithdrawToWallet=false when staticCall throws unexpectedly", async () => {
      // Simulate outer try/catch (e.g., contract doesn't exist)
      mockStaticCall.mockImplementation(() => {
        throw new Error("network error");
      });
      const caps = await detectTreasuryCapabilities("0xToken", provider);
      expect(caps.hasWithdrawToWallet).toBe(false);
    });
  });

  describe("withdrawFromTreasury", () => {
    it("calls withdrawToWallet and returns txHash", async () => {
      mockWithdrawToWallet.mockResolvedValue({ wait: mockWait });
      mockWait.mockResolvedValue({ hash: "0xWithdrawTx" });

      const signer = { address: "0xSigner" } as never;
      const result = await withdrawFromTreasury(signer, "0xToken", 1000n, 18);

      expect(result.txHash).toBe("0xWithdrawTx");
      expect(result.amount).toBe(1000n);
      expect(mockWithdrawToWallet).toHaveBeenCalledWith(1000n);
    });
  });
});
