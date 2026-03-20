import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";
import type { ToolContext } from "../../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../../helpers/fixtures.js";
import { bscPrepareTxTool } from "../../../src/tools/bsc-prepare-tx.js";
import { bscAnalyzeTxTool } from "../../../src/tools/bsc-analyze-tx.js";
import { bscWalletOverviewTool } from "../../../src/tools/bsc-wallet-overview.js";
import { bscSendTxTool } from "../../../src/tools/bsc-send-tx.js";
import { bscSignTxTool } from "../../../src/tools/bsc-sign-tx.js";
import { bscSignAndSendTxTool } from "../../../src/tools/bsc-sign-and-send-tx.js";

const VALID_TO = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

function baseCtx(agentWallet: ToolContext["agentWallet"]): ToolContext {
  return {
    chainState: makeChainState(),
    config: mockRuntimeConfig,
    dataDir: "/tmp/goo-bsc-tools",
    workspaceDir: "/tmp/goo-bsc-tools",
    agentWallet,
  };
}

describe("BSC wallet tools (no wallet)", () => {
  it("bsc_prepare_tx returns message when agentWallet missing", async () => {
    const out = await bscPrepareTxTool.execute({ to: VALID_TO }, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });

  it("bsc_analyze_tx returns message when agentWallet missing", async () => {
    const out = await bscAnalyzeTxTool.execute({ to: VALID_TO }, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });

  it("bsc_wallet_overview returns message when agentWallet missing", async () => {
    const out = await bscWalletOverviewTool.execute({}, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });

  it("bsc_send_tx returns message when agentWallet missing", async () => {
    const out = await bscSendTxTool.execute({ signedTransaction: "0x00" }, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });

  it("bsc_sign_tx returns message when agentWallet missing", async () => {
    const out = await bscSignTxTool.execute({ to: VALID_TO }, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });

  it("bsc_sign_and_send_tx returns message when agentWallet missing", async () => {
    const out = await bscSignAndSendTxTool.execute({ to: VALID_TO }, baseCtx(undefined));
    expect(out).toBe("Agent wallet not configured.");
  });
});

describe("BSC wallet tools (mock wallet)", () => {
  const preparedTx = {
    from: "0x1234567890123456789012345678901234567890",
    to: ethers.getAddress(VALID_TO),
    chainId: 97,
    nonce: 2,
    gasLimit: 21_000n,
    value: 0n,
    data: "0x",
  };

  const mockWallet = {
    address: "0x1234567890123456789012345678901234567890",
    minWalletBnb: 0.01,
    prepareTransaction: vi.fn().mockResolvedValue(preparedTx),
    analyzeTransaction: vi.fn(),
    signTransaction: vi.fn(),
    signAndSendTransaction: vi.fn(),
    broadcastSignedTransaction: vi.fn(),
    getNonce: vi.fn().mockResolvedValue(7),
    getNativeBalance: vi.fn().mockResolvedValue(ethers.parseEther("2")),
    getTokenSymbol: vi.fn().mockResolvedValue("USDT"),
    getTokenDecimals: vi.fn().mockResolvedValue(18),
    getTokenBalanceFor: vi.fn().mockResolvedValue(ethers.parseUnits("100", 18)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWallet.prepareTransaction.mockResolvedValue(preparedTx);
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "safe",
      reasons: ["ok"],
      decodedAction: "native_transfer",
    });
    mockWallet.signTransaction.mockResolvedValue({
      preparedTx,
      signedTransaction: "0xsigned",
    });
    mockWallet.signAndSendTransaction.mockResolvedValue({
      preparedTx,
      signedTransaction: "0xsigned2",
      txHash: "0xabc",
    });
    mockWallet.broadcastSignedTransaction.mockResolvedValue("0xbroadcast");
  });

  it("bsc_prepare_tx calls prepareTransaction and returns summary", async () => {
    const out = await bscPrepareTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    expect(mockWallet.prepareTransaction).toHaveBeenCalled();
    expect(out).toContain("Prepared transaction");
    expect(out).toContain("JSON:");
    expect(out).toContain("97");
  });

  it("bsc_analyze_tx returns risk and formatted tx", async () => {
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "warning",
      reasons: ["be careful"],
      decodedAction: "approve",
      selector: "0x095ea7b3",
      assetSymbol: "TOK",
    });
    const out = await bscAnalyzeTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    expect(out).toContain("Risk level: warning");
    expect(out).toContain("Decoded action: approve");
    expect(out).toContain("Selector: 0x095ea7b3");
    expect(out).toContain("Asset: TOK");
    expect(out).toContain("- be careful");
  });

  it("bsc_analyze_tx omits selector/asset when undefined", async () => {
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "safe",
      reasons: ["fine"],
      decodedAction: "native_transfer",
    });
    const out = await bscAnalyzeTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    expect(out).toContain("Selector: none");
    expect(out).toContain("Asset: unknown");
  });

  it("bsc_wallet_overview lists address, nonce, BNB", async () => {
    const out = await bscWalletOverviewTool.execute({}, baseCtx(mockWallet as never));
    expect(out).toContain("Address:");
    expect(out).toContain("Pending nonce: 7");
    expect(out).toContain("BNB balance:");
    expect(out).toContain(`Chain ID: ${mockRuntimeConfig.chainId}`);
  });

  it("bsc_wallet_overview skips invalid token addresses", async () => {
    const out = await bscWalletOverviewTool.execute(
      { tokens: ["not-an-address", VALID_TO] },
      baseCtx(mockWallet as never),
    );
    expect(out).toContain("invalid address");
    expect(out).toContain("USDT");
    expect(mockWallet.getTokenBalanceFor).toHaveBeenCalled();
  });

  it("bsc_sign_tx refuses blocked risk", async () => {
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "blocked",
      reasons: ["drain"],
      decodedAction: "transfer",
    });
    const out = await bscSignTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    expect(out).toContain("Signing refused");
    expect(mockWallet.signTransaction).not.toHaveBeenCalled();
  });

  it("bsc_sign_tx signs when safe", async () => {
    const out = await bscSignTxTool.execute({ to: VALID_TO, value: "0" }, baseCtx(mockWallet as never));
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.signedTransaction).toBe("0xsigned");
    expect(parsed.riskLevel).toBe("safe");
    expect(mockWallet.signTransaction).toHaveBeenCalled();
  });

  it("bsc_sign_and_send_tx refuses blocked", async () => {
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "blocked",
      reasons: ["no"],
      decodedAction: "x",
    });
    const out = await bscSignAndSendTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    expect(out).toContain("Signing refused");
    expect(mockWallet.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("bsc_sign_and_send_tx returns txHash when safe", async () => {
    const out = await bscSignAndSendTxTool.execute({ to: VALID_TO }, baseCtx(mockWallet as never));
    const parsed = JSON.parse(out) as { txHash: string };
    expect(parsed.txHash).toBe("0xabc");
  });

  it("bsc_send_tx rejects non-hex signedTransaction", async () => {
    const out = await bscSendTxTool.execute({ signedTransaction: "garbage" }, baseCtx(mockWallet as never));
    expect(out).toContain("raw hex");
    expect(mockWallet.broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("bsc_send_tx refuses broadcast when blocked", async () => {
    const w = ethers.Wallet.createRandom();
    const signed = await w.signTransaction({
      to: VALID_TO,
      value: 0,
      nonce: 0,
      gasLimit: 21_000,
      gasPrice: 1_000_000_000,
      chainId: 97,
      type: 0,
    });
    mockWallet.analyzeTransaction.mockResolvedValue({
      riskLevel: "blocked",
      reasons: ["bad"],
      decodedAction: "native_transfer",
    });
    const out = await bscSendTxTool.execute({ signedTransaction: signed }, baseCtx(mockWallet as never));
    expect(out).toContain("Broadcast refused");
    expect(mockWallet.broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("bsc_send_tx broadcasts when not blocked", async () => {
    const w = ethers.Wallet.createRandom();
    const signed = await w.signTransaction({
      to: VALID_TO,
      value: 0,
      nonce: 0,
      gasLimit: 21_000,
      gasPrice: 1_000_000_000,
      chainId: 97,
      type: 0,
    });
    const out = await bscSendTxTool.execute({ signedTransaction: signed }, baseCtx(mockWallet as never));
    const parsed = JSON.parse(out) as { txHash: string; riskLevel: string };
    expect(parsed.txHash).toBe("0xbroadcast");
    expect(parsed.riskLevel).toBe("safe");
    expect(mockWallet.broadcastSignedTransaction).toHaveBeenCalledWith(signed);
  });
});
