import { ethers } from "ethers";
import type { AgentWallet } from "./wallet.js";
import type { TxInput, TxRiskResult } from "./tx-types.js";

const ERC20_INTERFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
]);

const KNOWN_PERMIT_SELECTORS = new Set([
  "0xd505accf", // permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
  "0x2a2d80d1", // permit(address,address,uint160,uint48,uint48,bytes)
  "0x8fcbaf0c", // permitTransferFrom(...)
]);

function selectorOf(data?: string): string | undefined {
  if (!data || data === "0x" || data.length < 10) return undefined;
  return data.slice(0, 10).toLowerCase();
}

export async function analyzeTransactionRisk(
  wallet: AgentWallet,
  tx: TxInput,
): Promise<TxRiskResult> {
  const selector = selectorOf(tx.data);
  const reasons: string[] = [];
  let riskLevel: TxRiskResult["riskLevel"] = "safe";
  let decodedAction = tx.data && tx.data !== "0x" ? "contract_call" : "native_transfer";
  let assetSymbol: string | undefined;
  let estimatedValue: string | undefined;

  const address = wallet.address;
  const nativeBalance = await wallet.getNativeBalance();
  const minReserve = ethers.parseEther(wallet.minWalletBnb.toFixed(6));
  const value = tx.value ?? 0n;

  if ((!tx.data || tx.data === "0x") && value > 0n) {
    decodedAction = "native_transfer";
    estimatedValue = ethers.formatEther(value);
    if (nativeBalance <= value || nativeBalance - value < minReserve) {
      riskLevel = "blocked";
      reasons.push("Native transfer would leave the wallet below the minimum gas reserve.");
    }
  }

  if (selector) {
    if (KNOWN_PERMIT_SELECTORS.has(selector)) {
      riskLevel = "blocked";
      decodedAction = "permit_like_signature";
      reasons.push("Permit-style authorization can hand asset control to an external spender.");
    } else {
      let parsedAction = false;
      try {
        const parsed = ERC20_INTERFACE.parseTransaction({ data: tx.data! });
        if (parsed) {
          parsedAction = true;
          decodedAction = parsed.name;
          assetSymbol = await wallet.getTokenSymbol(tx.to);
          const tokenBalance = await wallet.getTokenBalanceFor(tx.to);

          if (parsed.name === "approve") {
            const amount = parsed.args.amount as bigint;
            estimatedValue = amount.toString();
            if (amount === ethers.MaxUint256) {
              riskLevel = "blocked";
              reasons.push("Unlimited ERC-20 approval detected.");
            } else if (tokenBalance > 0n && amount >= (tokenBalance * 95n) / 100n) {
              riskLevel = riskLevel === "blocked" ? "blocked" : "warning";
              reasons.push("Approval amount covers most or all of the current token balance.");
            }
          }

          if (parsed.name === "transfer") {
            const recipient = parsed.args.to as string;
            const amount = parsed.args.amount as bigint;
            estimatedValue = amount.toString();
            if (ethers.getAddress(recipient) !== ethers.getAddress(address) && tokenBalance > 0n) {
              if (amount >= (tokenBalance * 95n) / 100n) {
                riskLevel = "blocked";
                reasons.push("ERC-20 transfer would move almost the entire token balance out of the wallet.");
              } else if (amount >= (tokenBalance * 80n) / 100n) {
                riskLevel = riskLevel === "blocked" ? "blocked" : "warning";
                reasons.push("ERC-20 transfer would move most of the current token balance.");
              }
            }
          }

          if (parsed.name === "transferFrom") {
            const from = parsed.args.from as string;
            const amount = parsed.args.amount as bigint;
            estimatedValue = amount.toString();
            if (ethers.getAddress(from) === ethers.getAddress(address) && tokenBalance > 0n) {
              riskLevel = amount >= (tokenBalance * 95n) / 100n ? "blocked" : "warning";
              reasons.push("transferFrom would move assets out of the agent wallet.");
            }
          }
        }
      } catch {
        parsedAction = false;
      }
      if (!parsedAction) {
        const code = await wallet.rpcProvider.getCode(tx.to);
        if (code !== "0x" && value > 0n && nativeBalance - value < minReserve) {
          riskLevel = "blocked";
          reasons.push("Contract call would leave the wallet below the minimum gas reserve.");
        } else if (code !== "0x") {
          riskLevel = "warning";
          reasons.push("Unknown contract selector; manual review recommended before signing.");
        }
      }
    }
  }

  if (reasons.length === 0) {
    reasons.push("No explicit drain pattern detected.");
  }

  return {
    riskLevel,
    reasons,
    selector,
    decodedAction,
    assetSymbol,
    estimatedValue,
  };
}
