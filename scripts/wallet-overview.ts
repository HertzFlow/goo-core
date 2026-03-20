#!/usr/bin/env npx tsx
import { ethers } from "ethers";
import { loadConfigFromEnv } from "../src/runtime-config.js";
import { AgentWallet } from "../src/finance/wallet.js";

async function main(): Promise<void> {
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
  const nonce = await wallet.getNonce();
  const nativeBalance = await wallet.getNativeBalance();

  console.log(
    JSON.stringify(
      {
        address: wallet.address,
        chainId: config.chainId,
        nonce,
        nativeBalance: ethers.formatEther(nativeBalance),
        minReserveBnb: wallet.minWalletBnb,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
