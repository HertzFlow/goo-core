#!/usr/bin/env npx tsx
import { ethers } from "ethers";
import { loadConfigFromEnv } from "../src/runtime-config.js";
import { AgentWallet } from "../src/finance/wallet.js";

async function main(): Promise<void> {
  const signedTransaction = process.argv[2];
  if (!signedTransaction) {
    console.error("Usage: npx tsx scripts/send-tx.ts <signed-tx-hex>");
    process.exit(1);
  }
  const config = loadConfigFromEnv(process.env);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = AgentWallet.fromPrivateKey(
    config.walletPrivateKey!,
    config.tokenAddress,
    provider,
    config.x402PaymentToken,
    config.minWalletBnb,
  );
  await wallet.init();
  const tx = ethers.Transaction.from(signedTransaction);
  const risk = await wallet.analyzeTransaction({
    to: tx.to ?? ethers.ZeroAddress,
    value: tx.value,
    data: tx.data,
    gasLimit: tx.gasLimit,
    gasPrice: tx.gasPrice,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    nonce: tx.nonce,
    chainId: tx.chainId ? Number(tx.chainId) : config.chainId,
    type: tx.type,
  });
  if (risk.riskLevel === "blocked") {
    console.error(JSON.stringify({ riskLevel: risk.riskLevel, reasons: risk.reasons }, null, 2));
    process.exit(1);
  }
  const txHash = await wallet.broadcastSignedTransaction(signedTransaction);
  console.log(JSON.stringify({ txHash, riskLevel: risk.riskLevel, reasons: risk.reasons }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
