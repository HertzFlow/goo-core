#!/usr/bin/env npx tsx
import { ethers } from "ethers";
import { loadConfigFromEnv } from "../src/runtime-config.js";
import { AgentWallet } from "../src/finance/wallet.js";
import { parseTxInput } from "../src/finance/tx-utils.js";

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: npx tsx scripts/analyze-tx.ts '<tx-json>'");
    process.exit(1);
  }
  const tx = parseTxInput(JSON.parse(raw) as Record<string, unknown>);
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
  const risk = await wallet.analyzeTransaction(tx);
  console.log(JSON.stringify(risk, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
