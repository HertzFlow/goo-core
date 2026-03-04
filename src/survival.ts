import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "./types.js";
import type { ChainMonitor } from "./chain-monitor.js";

// ABI for write operations
const TOKEN_WRITE_ABI = [
  "function survivalSell(uint256 tokenAmount, uint256 minStableOut)",
  "function emitPulse()",
  "function MAX_SELL_BPS_VALUE() view returns (uint256)",
  "function SURVIVAL_SELL_COOLDOWN_SECS() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

/**
 * Survival module — Goo Core economic actions (survivalSell, Pulse).
 *
 * 1. SurvivalSell: sell agent tokens for stablecoin when in Starving or Dying; can fund treasury → Recovery to Active.
 * 2. Gas refill: ensure agent wallet has enough native token for transactions.
 * 3. Pulse (emitPulse): proof-of-life; required in Dying to avoid Dead.
 */
export class SurvivalManager {
  private wallet: ethers.Wallet;
  private token: ethers.Contract;
  private lastPulseTime: number = 0;

  constructor(
    private monitor: ChainMonitor,
    private config: RuntimeConfig
  ) {
    this.wallet = new ethers.Wallet(
      config.walletPrivateKey,
      monitor.rpcProvider
    );
    this.token = new ethers.Contract(
      config.tokenAddress,
      TOKEN_WRITE_ABI,
      this.wallet
    );
  }

  /**
   * Evaluate chain state and execute survival actions if needed.
   * Called on every heartbeat. Returns a list of actions taken.
   */
  async evaluate(state: ChainState): Promise<string[]> {
    const actions: string[] = [];

    if (state.status === AgentStatus.DEAD) {
      return ["Agent is DEAD. No actions possible."];
    }

    // 1. Gas refill check
    if (state.nativeBalance < this.config.minGasBalance) {
      actions.push(
        `WARNING: Native balance (${this.monitor.formatNative(state.nativeBalance)}) ` +
          `below minimum (${this.monitor.formatNative(this.config.minGasBalance)}). ` +
          `Agent wallet needs gas to transact.`
      );
    }

    // 2. Pulse — emit periodically to prevent forced death
    //    Recommended: every PULSE_TIMEOUT / 3
    const pulseAction = await this.maybeEmitPulse(state);
    if (pulseAction) actions.push(pulseAction);

    // 3. SurvivalSell — when in Starving or Dying, sell tokens to fund treasury
    if (
      state.status === AgentStatus.STARVING ||
      state.status === AgentStatus.DYING
    ) {
      const sellAction = await this.maybeSurvivalSell(state);
      if (sellAction) actions.push(sellAction);
    }

    return actions;
  }

  /** Emit Pulse (proof-of-life) if enough time has passed */
  private async maybeEmitPulse(state: ChainState): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    const lastPulse = Number(state.lastPulseAt);

    // Get pulse timeout from contract (cached on first call)
    let timeout: number;
    try {
      const contract = new ethers.Contract(
        this.config.tokenAddress,
        ["function PULSE_TIMEOUT_SECS() view returns (uint256)"],
        this.monitor.rpcProvider
      );
      timeout = Number(await contract.PULSE_TIMEOUT_SECS());
    } catch {
      timeout = 172_800; // 48h fallback
    }

    // Emit Pulse every timeout/3 to have safety margin
    const pulseInterval = Math.floor(timeout / 3);
    if (now - lastPulse < pulseInterval && now - this.lastPulseTime < pulseInterval) {
      return null;
    }

    try {
      const tx = await this.token.emitPulse();
      await tx.wait();
      this.lastPulseTime = now;
      return `Pulse sent (tx: ${tx.hash})`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Pulse failed: ${msg}`;
    }
  }

  /** Execute survival sell: sell agent tokens for stablecoin */
  private async maybeSurvivalSell(
    state: ChainState
  ): Promise<string | null> {
    if (state.tokenHoldings === 0n) {
      return "No token holdings to sell.";
    }

    // Calculate max allowed sell amount
    const maxSellBps = await this.token.MAX_SELL_BPS_VALUE();
    const maxAllowed =
      (state.tokenHoldings * BigInt(maxSellBps)) / 10_000n;

    if (maxAllowed === 0n) {
      return "Max allowed sell amount is 0.";
    }

    // Sell the max allowed amount with 0 minStableOut (accept any output)
    // In production, should use DEX price quote for slippage protection
    try {
      const tx = await this.token.survivalSell(maxAllowed, 0n);
      const receipt = await tx.wait();
      return (
        `SurvivalSell executed: ${ethers.formatEther(maxAllowed)} tokens ` +
        `(tx: ${receipt.hash})`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Likely cooldown active
      if (msg.includes("cooldown")) {
        return "SurvivalSell skipped: cooldown active.";
      }
      return `SurvivalSell failed: ${msg}`;
    }
  }
}
