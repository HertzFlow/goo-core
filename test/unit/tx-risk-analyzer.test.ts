import { describe, expect, it, vi, beforeEach } from "vitest";
import { ethers } from "ethers";
import { analyzeTransactionRisk } from "../../src/finance/tx-risk-analyzer.js";

describe("analyzeTransactionRisk", () => {
  const wallet = {
    address: "0x1111111111111111111111111111111111111111",
    minWalletBnb: 0.01,
    rpcProvider: {
      getCode: vi.fn().mockResolvedValue("0x"),
    },
    getNativeBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000n),
    getTokenSymbol: vi.fn().mockResolvedValue("TOK"),
    getTokenBalanceFor: vi.fn().mockResolvedValue(1_000_000n),
  };

  beforeEach(() => {
    wallet.rpcProvider.getCode = vi.fn().mockResolvedValue("0x");
    wallet.getNativeBalance.mockResolvedValue(10_000_000_000_000_000n);
  });

  it("blocks native transfers that drain the gas reserve", async () => {
    const risk = await analyzeTransactionRisk(wallet as never, {
      to: "0x2222222222222222222222222222222222222222",
      value: 9_500_000_000_000_000n,
    });
    expect(risk.riskLevel).toBe("blocked");
    expect(risk.reasons.join(" ")).toMatch(/minimum gas reserve/i);
  });

  it("blocks unlimited approvals", async () => {
    const risk = await analyzeTransactionRisk(wallet as never, {
      to: "0x3333333333333333333333333333333333333333",
      data: "0x095ea7b30000000000000000000000004444444444444444444444444444444444444444ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(risk.riskLevel).toBe("blocked");
    expect(risk.decodedAction).toBe("approve");
  });

  it("warns on unknown contract selectors", async () => {
    wallet.rpcProvider.getCode = vi.fn().mockResolvedValue("0x1234");
    const risk = await analyzeTransactionRisk(wallet as never, {
      to: "0x5555555555555555555555555555555555555555",
      data: "0xabcdef120000000000000000000000000000000000000000000000000000000000000001",
    });
    expect(risk.riskLevel).toBe("warning");
    expect(risk.reasons.join(" ")).toMatch(/unknown contract selector/i);
  });

  it("blocks contract call with value when remaining native would be below reserve", async () => {
    wallet.rpcProvider.getCode = vi.fn().mockResolvedValue("0x6000");
    wallet.getNativeBalance.mockResolvedValue(ethers.parseEther("0.02"));
    const risk = await analyzeTransactionRisk(wallet as never, {
      to: "0x6666666666666666666666666666666666666666",
      data: "0xdeadbeef",
      value: ethers.parseEther("0.019"),
    });
    expect(risk.riskLevel).toBe("blocked");
    expect(risk.reasons.join(" ")).toMatch(/gas reserve/i);
  });

  it("returns safe with default reason for zero-value transfer without calldata", async () => {
    const risk = await analyzeTransactionRisk(wallet as never, {
      to: "0x2222222222222222222222222222222222222222",
      value: 0n,
    });
    expect(risk.riskLevel).toBe("safe");
    expect(risk.reasons).toContain("No explicit drain pattern detected.");
  });
});
