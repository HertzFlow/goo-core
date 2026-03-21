import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "../types.js";
import type { ChainMonitor } from "./chain-monitor.js";
import { emitPulse as emitPulseOnChain } from "./pulse.js";
import { TOKEN_WRITE_ABI, TOKEN_ABI } from "../const.js";
import type { AgentWallet } from "../finance/index.js";
import type { SpendManager } from "../finance/spend.js";
import { ensureWalletGas } from "../finance/action/gas-refill.js";
import { ensurePaymentToken } from "../finance/action/payment-token-refill.js";
import { executeBuyback } from "../finance/action/buyback.js";
import { emitEvent } from "../events.js";
import type { SandboxLifecycle } from "./sandbox-lifecycle.js";
import { MaiatReputation, type ReputationConfig } from "../reputation/index.js";


/**
 * Survival module — Goo Core economic actions (survivalSell, Pulse).
 *
 * 1. SurvivalSell: sell agent tokens for BNB when in Starving or Dying; can fund treasury → Recovery to Active.
 * 2. Gas refill: ensure agent wallet has enough BNB for transactions (withdraw from treasury).
 * 3. Pulse (emitPulse): proof-of-life; required in Dying to avoid Dead.
 * 4. Sandbox lifecycle: auto-renew sandbox when approaching expiry.
 */
export class SurvivalManager {
  private signer_: ethers.Signer;
  private token: ethers.Contract;
  private lastPulseTime: number = 0;
  private agentWallet?: AgentWallet;
  private spendManager?: SpendManager;
  private sandboxLifecycle?: SandboxLifecycle;
  private maiatReputation?: MaiatReputation;
  /** Once initial AIOU fund succeeds (or balance already sufficient), stop auto-refilling */
  private initialPaymentTokenDone = false;

  constructor(
    private monitor: ChainMonitor,
    private config: RuntimeConfig,
    signer: ethers.Signer,
    agentWallet?: AgentWallet,
    spendManager?: SpendManager,
  ) {
    this.signer_ = signer;
    this.token = new ethers.Contract(
      config.tokenAddress,
      TOKEN_WRITE_ABI,
      signer,
    );
    this.agentWallet = agentWallet;
    this.spendManager = spendManager;
  }

  setSandboxLifecycle(lifecycle: SandboxLifecycle): void {
    this.sandboxLifecycle = lifecycle;
  }

  /**
   * Enable Maiat reputation tracking for this agent.
   * When enabled, trust scores are checked every heartbeat and
   * reputation data is surfaced alongside survival actions.
   */
  setMaiatReputation(agentAddress: string, config?: Partial<ReputationConfig>): void {
    this.maiatReputation = new MaiatReputation(agentAddress, config);
  }

  /** Mark initial payment token fund as done (e.g. AGOS handles its own funding on BSC Mainnet). */
  skipInitialPaymentToken(): void {
    this.initialPaymentTokenDone = true;
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

    // 1. Gas refill: auto-swap via gas-refill module if wallet available, otherwise warn
    if (state.nativeBalance < this.config.minGasBalance) {
      if (this.agentWallet) {
        try {
          const result = await ensureWalletGas(
            this.agentWallet,
            {
              minGasBalance: this.config.minGasBalance,
              gasRefillAmount: this.config.gasRefillAmount,
            },
            this.spendManager,
          );
          if (result.refilled) {
            actions.push(
              `Gas refilled: withdrew BNB from treasury (tx: ${result.txHash})`,
            );
            emitEvent("gas_refill_ok", "info", "Gas refilled from treasury", {
              txHash: result.txHash,
            });
          } else if (result.error) {
            actions.push(`Gas refill failed: ${result.error}`);
            emitEvent("gas_refill_failed", "warn", result.error);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          actions.push(`Gas refill error: ${msg}`);
          emitEvent("gas_refill_failed", "error", msg);
        }
      } else {
        const warnMsg =
          `Native balance (${this.monitor.formatNative(state.nativeBalance)}) ` +
          `below minimum (${this.monitor.formatNative(this.config.minGasBalance)})`;
        actions.push(`WARNING: ${warnMsg}. Agent wallet needs gas to transact.`);
        emitEvent("gas_low", "warn", warnMsg);
      }
    }

    // 2. Initial payment token fund (one-shot): ensure agent has AIOU before sandbox starts.
    //    Ongoing refills are handled by the agent via refill_payment_token tool.
    if (this.agentWallet?.hasPaymentToken && !this.initialPaymentTokenDone) {
      try {
        const ptResult = await ensurePaymentToken(this.agentWallet, this.spendManager);
        if (ptResult.refilled) {
          this.initialPaymentTokenDone = true;
          actions.push(`Initial AIOU funded: swapped BNB→USDT (tx: ${ptResult.swapTxHash})`);
          emitEvent("payment_token_refill_ok", "info", "Initial AIOU fund: swapped BNB→USDT", {
            swapTxHash: ptResult.swapTxHash,
            approveTxHash: ptResult.approveTxHash,
          });
        } else if (ptResult.approveTxHash) {
          // Permit2 approved but balance was already sufficient — initial fund done
          this.initialPaymentTokenDone = true;
          actions.push(`Payment token: Permit2 approved (tx: ${ptResult.approveTxHash})`);
        } else if (ptResult.error) {
          // Keep retrying on next heartbeat
          actions.push(`Initial AIOU fund skipped: ${ptResult.error}`);
        } else {
          // Balance already sufficient, no action needed — mark done
          this.initialPaymentTokenDone = true;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(`Initial AIOU fund error: ${msg}`);
        emitEvent("payment_token_refill_failed", "error", msg);
      }
    }

    // 3. Pulse — emit periodically to prevent forced death
    const lastPulseRef = { current: this.lastPulseTime };
    const pulseAction = await emitPulseOnChain(
      state,
      {
        tokenAddress: this.config.tokenAddress,
        signer: this.signer_,
        monitor: this.monitor,
      },
      lastPulseRef,
    );
    this.lastPulseTime = lastPulseRef.current;
    if (pulseAction) {
      actions.push(pulseAction);
      if (pulseAction.startsWith("Pulse sent")) {
        emitEvent("pulse_emitted", "info", pulseAction);
      } else if (pulseAction.startsWith("Pulse failed")) {
        emitEvent("pulse_failed", "error", pulseAction);
      }
    }

    // 4. SurvivalSell — when in Starving or Dying, sell tokens for BNB to fund treasury
    if (
      state.status === AgentStatus.STARVING ||
      state.status === AgentStatus.DYING
    ) {
      const sellAction = await this.maybeSurvivalSell(state);
      if (sellAction) actions.push(sellAction);
    }

    // 5. Buyback — when ACTIVE and treasury is healthy, buy back agent tokens with excess BNB
    if (
      this.config.buyback?.enabled &&
      state.status === AgentStatus.ACTIVE &&
      this.agentWallet
    ) {
      const buybackAction = await this.maybeBuyback(state);
      if (buybackAction) actions.push(buybackAction);
    }

    // 6. Sandbox lifecycle — check health and auto-renew if needed
    if (this.sandboxLifecycle) {
      try {
        const health = await this.sandboxLifecycle.check();
        if (health.renewed) {
          actions.push(`Sandbox renewed: ${health.status}`);
        } else if (!health.healthy) {
          actions.push(`WARNING: Sandbox unhealthy — ${health.status}`);
        } else if (health.remainingSecs !== undefined && health.remainingSecs < 900) {
          // Surface status when under 15 minutes even if not yet at renewal threshold
          actions.push(`Sandbox: ${health.status}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(`Sandbox check error: ${msg}`);
        emitEvent("sandbox_check_error", "error", msg);
      }
    }

    // 7. Maiat Reputation — check trust score and surface reputation data
    if (this.maiatReputation) {
      try {
        const reputationActions = await this.maiatReputation.evaluate();
        actions.push(...reputationActions);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(`Maiat reputation check error: ${msg}`);
      }
    }

    return actions;
  }

  /**
   * Buyback: when treasury > threshold, use wallet BNB to buy back agent tokens.
   * Only runs when ACTIVE and buyback is enabled. Keeps a gas buffer.
   */
  private async maybeBuyback(state: ChainState): Promise<string | null> {
    const buybackConfig = this.config.buyback!;
    const threshold = state.starvingThreshold * BigInt(buybackConfig.thresholdMultiplier);

    if (state.treasuryBalance <= threshold) {
      return null; // Treasury not healthy enough for buyback
    }

    // Use wallet BNB for buyback, keeping 2x minGasBalance as buffer
    const gasBuffer = this.config.minGasBalance * 2n;
    const available = state.nativeBalance - gasBuffer;

    // Minimum buyback: 0.01 BNB (avoid dust transactions)
    const minBuyback = ethers.parseEther("0.01");
    if (available < minBuyback) {
      return null; // Not enough BNB in wallet for buyback
    }

    try {
      const result = await executeBuyback(
        this.agentWallet!,
        { amountIn: available },
        this.spendManager,
      );
      if (result.success) {
        return `Buyback: ${ethers.formatEther(available)} BNB → ${ethers.formatEther(result.amountOut || 0n)} tokens (tx: ${result.txHash})`;
      }
      if (result.error) {
        return `Buyback skipped: ${result.error}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("buyback_error", "error", msg);
      return `Buyback error: ${msg}`;
    }
    return null;
  }

  /** Execute survival sell: sell agent tokens for BNB */
  private async maybeSurvivalSell(state: ChainState): Promise<string | null> {
    if (state.tokenHoldings === 0n) {
      return "No token holdings to sell.";
    }

    // Calculate max allowed sell amount
    const maxSellBps = await this.token.MAX_SELL_BPS_VALUE();
    const maxAllowed = (state.tokenHoldings * BigInt(maxSellBps)) / 10_000n;

    if (maxAllowed === 0n) {
      return "Max allowed sell amount is 0.";
    }

    // Quote expected BNB output for slippage protection
    let minNativeOut = 0n;
    try {
      const tokenRead = new ethers.Contract(this.config.tokenAddress, TOKEN_ABI, this.monitor.rpcProvider);
      const executorAddr: string = await tokenRead.swapExecutor();
      const executor = new ethers.Contract(executorAddr,
        ["function router() view returns (address)", "function wrappedNative() view returns (address)"],
        this.monitor.rpcProvider);
      const routerAddr: string = await executor.router();
      const wethAddr: string = await executor.wrappedNative();
      const router = new ethers.Contract(routerAddr,
        ["function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)"],
        this.monitor.rpcProvider);
      const amounts: bigint[] = await router.getAmountsOut(maxAllowed, [this.config.tokenAddress, wethAddr]);
      // 5% slippage: covers 1% FoT + price movement
      minNativeOut = amounts[1] * 95n / 100n;
    } catch {
      console.warn("[survival] getAmountsOut for survivalSell failed, proceeding without slippage protection");
    }

    try {
      const tx = await this.token.survivalSell(maxAllowed, minNativeOut);
      const receipt = await tx.wait();
      const resultMsg =
        `SurvivalSell executed: ${ethers.formatEther(maxAllowed)} tokens ` +
        `(tx: ${receipt.hash})`;
      emitEvent("survival_sell", "info", resultMsg, { txHash: receipt.hash });
      return resultMsg;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Likely cooldown active
      if (msg.includes("cooldown")) {
        return "SurvivalSell skipped: cooldown active.";
      }
      emitEvent("survival_sell_failed", "warn", msg);
      return `SurvivalSell failed: ${msg}`;
    }
  }
}
