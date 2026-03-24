/**
 * sandbox-lifecycle.ts — Abstract sandbox lifecycle management.
 *
 * Provides a unified interface for checking sandbox health and auto-renewing
 * across different providers (e2b, AGOS).
 *
 * Each provider has different renewal semantics:
 * - e2b:  time-based expiry, renewed via x402 payment to sandbox-manager
 * - AGOS: balance-based, auto-topup from agent wallet when funds are low
 */

import { ethers } from "ethers";
import type { SpendManager } from "../finance/spend.js";
import {
  renewSandbox,
  getSandboxStatus,
  type SandboxPaymentConfig,
  type SandboxInfo,
} from "../finance/action/sandbox-payment.js";
import { AgosInitialFund } from "../finance/action/agos-initial-fund.js";
import { emitEvent } from "../events.js";

// ─── Abstract Interface ──────────────────────────────────────────────────

export type SandboxProviderType = "e2b" | "agos" | "none";

export interface SandboxHealth {
  provider: SandboxProviderType;
  healthy: boolean;
  /** Human-readable status line for heartbeat context */
  status: string;
  /** Seconds until expiry/depletion, if applicable */
  remainingSecs?: number;
  /** Whether auto-renewal was attempted this check */
  renewed: boolean;
  /** Error message if renewal failed */
  error?: string;
}

export interface SandboxLifecycle {
  readonly provider: SandboxProviderType;

  /**
   * Check sandbox health and auto-renew if needed.
   * Called once per heartbeat from SurvivalManager.evaluate().
   */
  check(): Promise<SandboxHealth>;
}

// ─── E2B Provider ────────────────────────────────────────────────────────

/**
 * E2B sandbox: time-based expiry.
 * Auto-renews via x402 payment when remaining time drops below threshold.
 */
export class E2bSandboxLifecycle implements SandboxLifecycle {
  readonly provider: SandboxProviderType = "e2b";

  constructor(
    private agentId: string,
    private signer: ethers.Signer,
    private config: SandboxPaymentConfig,
    private spendManager?: SpendManager,
    private renewThresholdSecs: number = 600, // 10 minutes
  ) {}

  async check(): Promise<SandboxHealth> {
    let info: SandboxInfo | null;
    try {
      info = await getSandboxStatus(this.config, this.agentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        provider: this.provider,
        healthy: false,
        status: `e2b status check failed: ${msg}`,
        renewed: false,
        error: msg,
      };
    }

    if (!info) {
      return {
        provider: this.provider,
        healthy: false,
        status: "e2b sandbox not found",
        renewed: false,
      };
    }

    // Sandbox not running
    if (info.state !== "running") {
      return {
        provider: this.provider,
        healthy: false,
        status: `e2b sandbox ${info.state}`,
        renewed: false,
      };
    }

    // Check remaining time
    if (!info.endAt) {
      return {
        provider: this.provider,
        healthy: true,
        status: "e2b sandbox running (no expiry)",
        renewed: false,
      };
    }

    const remainingSecs = Math.max(
      0,
      Math.floor((new Date(info.endAt).getTime() - Date.now()) / 1000),
    );

    // Auto-renew if below threshold
    if (remainingSecs <= this.renewThresholdSecs) {
      return this.tryRenew(remainingSecs);
    }

    const mins = Math.floor(remainingSecs / 60);
    return {
      provider: this.provider,
      healthy: true,
      status: `e2b sandbox running (${mins}min remaining)`,
      remainingSecs,
      renewed: false,
    };
  }

  private async tryRenew(remainingSecs: number): Promise<SandboxHealth> {
    try {
      await renewSandbox(
        this.signer,
        this.config,
        this.agentId,
        undefined,
        this.spendManager,
      );
      emitEvent("sandbox_renewed", "info", `e2b sandbox auto-renewed (was ${remainingSecs}s remaining)`);
      return {
        provider: this.provider,
        healthy: true,
        status: `e2b sandbox auto-renewed (was ${remainingSecs}s remaining)`,
        remainingSecs,
        renewed: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("sandbox_renew_failed", "warn", msg);
      return {
        provider: this.provider,
        healthy: remainingSecs > 0,
        status: `e2b sandbox renewal failed: ${msg} (${remainingSecs}s remaining)`,
        remainingSecs,
        renewed: false,
        error: msg,
      };
    }
  }
}

// ─── AGOS Provider ───────────────────────────────────────────────────────

export interface AgosConfig {
  /** goo-server API base URL (e.g. "https://example.com") */
  apiUrl: string;
  /** Agent's agenterId in goo-server */
  agenterId: string;
  /** Runtime auth token for goo-server proxy calls */
  runtimeToken: string;
  /** Minimum AIOU balance before warning (default: 10) */
  minBalance?: number;
  /** Agent wallet private key for BSC Mainnet auto-topup. If unset, warn only. */
  walletPrivateKey?: string;
  /** AIOU amount to fund per topup (default: "10") */
  topupAmount?: string;
}

interface AgosBalanceResponse {
  ok: boolean;
  data: {
    availableBalance: string;
    frozenBalance: string;
    spentTotal: string;
  };
}

/**
 * AGOS sandbox: balance-based.
 * Checks AGOS account balance and auto-tops up from agent wallet when low.
 * When walletPrivateKey is provided, uses AgosInitialFund to do the full
 * BNB→USDT→AIOU→EIP-3009 flow on BSC Mainnet. Falls back to warn-only if no key.
 */
export class AgosSandboxLifecycle implements SandboxLifecycle {
  readonly provider: SandboxProviderType = "agos";
  private minBalance: number;
  private topupAmount: string;
  /** Timestamp of last topup attempt (ms) — cooldown prevents spamming */
  private lastTopupAttemptMs = 0;
  /** Cooldown between topup attempts: 5 minutes */
  private static readonly TOPUP_COOLDOWN_MS = 5 * 60 * 1000;

  constructor(private config: AgosConfig) {
    this.minBalance = config.minBalance ?? 10;
    this.topupAmount = config.topupAmount ?? "10";
  }

  async check(): Promise<SandboxHealth> {
    let balance: number;
    try {
      balance = await this.fetchBalance();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        provider: this.provider,
        healthy: false,
        status: `AGOS balance check failed: ${msg}`,
        renewed: false,
        error: msg,
      };
    }

    // Topup threshold: half of minBalance (e.g. 5 AIOU when minBalance=10)
    const topupThreshold = this.minBalance / 2;

    if (balance <= 0) {
      emitEvent("sandbox_agos_depleted", "error", `AGOS balance depleted (${balance})`);
      if (this.config.walletPrivateKey) {
        return this.tryAutoTopup(balance);
      }
      return {
        provider: this.provider,
        healthy: false,
        status: `AGOS balance depleted (${balance}). Needs manual top-up.`,
        renewed: false,
      };
    }

    if (balance < topupThreshold) {
      if (this.config.walletPrivateKey) {
        return this.tryAutoTopup(balance);
      }
      emitEvent("sandbox_agos_low", "warn", `AGOS balance low: ${balance}`);
      return {
        provider: this.provider,
        healthy: true,
        status: `AGOS balance low (${balance}). Consider top-up.`,
        renewed: false,
      };
    }

    if (balance < this.minBalance) {
      emitEvent("sandbox_agos_low", "warn", `AGOS balance low: ${balance}`);
      return {
        provider: this.provider,
        healthy: true,
        status: `AGOS balance low (${balance}). Consider top-up.`,
        renewed: false,
      };
    }

    return {
      provider: this.provider,
      healthy: true,
      status: `AGOS balance OK (${balance})`,
      renewed: false,
    };
  }

  private async tryAutoTopup(currentBalance: number): Promise<SandboxHealth> {
    // Cooldown: skip if last attempt was too recent
    const now = Date.now();
    if (now - this.lastTopupAttemptMs < AgosSandboxLifecycle.TOPUP_COOLDOWN_MS) {
      const waitSecs = Math.ceil(
        (AgosSandboxLifecycle.TOPUP_COOLDOWN_MS - (now - this.lastTopupAttemptMs)) / 1000,
      );
      return {
        provider: this.provider,
        healthy: currentBalance > 0,
        status: `AGOS balance low (${currentBalance}). Auto-topup on cooldown (${waitSecs}s).`,
        renewed: false,
      };
    }

    this.lastTopupAttemptMs = now;

    try {
      console.log("[agos-auto-topup] Balance low, attempting auto-topup...");
      const funder = new AgosInitialFund({
        walletPrivateKey: this.config.walletPrivateKey!,
        serverUrl: this.config.apiUrl,
        agenterId: this.config.agenterId,
        runtimeToken: this.config.runtimeToken,
        targetAiou: this.topupAmount,
      });

      const result = await funder.execute();
      for (const step of result.steps) {
        console.log(`  [agos-auto-topup] ${step}`);
      }

      if (result.done) {
        emitEvent("agos_auto_topup_ok", "info", `Auto-topup complete (was ${currentBalance} AIOU)`);
        return {
          provider: this.provider,
          healthy: true,
          status: `AGOS auto-topup OK (was ${currentBalance} AIOU)`,
          renewed: true,
        };
      }

      // Topup not done (e.g. insufficient BNB) — warn but don't crash
      const errMsg = result.error || "unknown";
      emitEvent("agos_auto_topup_failed", "warn", `Auto-topup failed: ${errMsg}`);
      return {
        provider: this.provider,
        healthy: currentBalance > 0,
        status: `AGOS auto-topup failed: ${errMsg} (balance: ${currentBalance})`,
        renewed: false,
        error: errMsg,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("agos_auto_topup_failed", "warn", `Auto-topup error: ${msg}`);
      return {
        provider: this.provider,
        healthy: currentBalance > 0,
        status: `AGOS auto-topup error: ${msg} (balance: ${currentBalance})`,
        renewed: false,
        error: msg,
      };
    }
  }

  private async fetchBalance(): Promise<number> {
    const url = `${this.config.apiUrl}/api/agos/agents/${this.config.agenterId}/rt/balance`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.runtimeToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${body}`);
    }
    const data = (await res.json()) as AgosBalanceResponse;
    return parseFloat(data.data.availableBalance) || 0;
  }
}

// ─── No-op Provider ──────────────────────────────────────────────────────

/**
 * Fallback when no sandbox provider is configured.
 */
export class NoopSandboxLifecycle implements SandboxLifecycle {
  readonly provider: SandboxProviderType = "none";

  async check(): Promise<SandboxHealth> {
    return {
      provider: this.provider,
      healthy: true,
      status: "no sandbox provider",
      renewed: false,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

export interface SandboxLifecycleFactoryParams {
  /** Agent ID for sandbox-manager API calls */
  agentId: string;
  /** ethers.Signer for x402 payments (e2b) */
  signer?: ethers.Signer;
  /** Sandbox manager base URL (e2b) */
  sandboxManagerUrl?: string;
  /** SpendManager for tracking renewal costs */
  spendManager?: SpendManager;
  /** Renewal threshold in seconds (e2b, default: 600) */
  renewThresholdSecs?: number;
  /** AGOS config (agos) */
  agosConfig?: AgosConfig;
}

/**
 * Create the appropriate SandboxLifecycle based on SANDBOX_PROVIDER env var.
 *
 * Reads process.env.SANDBOX_PROVIDER:
 * - "e2b"  → E2bSandboxLifecycle (requires sandboxManagerUrl + signer)
 * - "agos" → AgosSandboxLifecycle (requires agosConfig)
 * - unset  → NoopSandboxLifecycle
 */
export function createSandboxLifecycle(
  params: SandboxLifecycleFactoryParams,
): SandboxLifecycle {
  const provider = (process.env.SANDBOX_PROVIDER || "").toLowerCase();

  switch (provider) {
    case "e2b": {
      if (!params.sandboxManagerUrl) {
        console.warn("[sandbox-lifecycle] e2b provider but no SANDBOX_MANAGER_URL — falling back to noop");
        return new NoopSandboxLifecycle();
      }
      if (!params.signer) {
        console.warn("[sandbox-lifecycle] e2b provider but no signer — falling back to noop");
        return new NoopSandboxLifecycle();
      }
      console.log(`[sandbox-lifecycle] e2b provider (renew threshold: ${params.renewThresholdSecs ?? 600}s)`);
      return new E2bSandboxLifecycle(
        params.agentId,
        params.signer,
        { managerUrl: params.sandboxManagerUrl },
        params.spendManager,
        params.renewThresholdSecs,
      );
    }

    case "agos": {
      if (!params.agosConfig) {
        console.warn("[sandbox-lifecycle] agos provider but no agosConfig — falling back to noop");
        return new NoopSandboxLifecycle();
      }
      console.log(`[sandbox-lifecycle] agos provider (min balance: ${params.agosConfig.minBalance ?? 10})`);
      return new AgosSandboxLifecycle(params.agosConfig);
    }

    default: {
      return new NoopSandboxLifecycle();
    }
  }
}
