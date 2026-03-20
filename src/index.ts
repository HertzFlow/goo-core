#!/usr/bin/env node
import { createRequire } from "node:module";

// --version flag: print version and exit
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");
  console.log(`goo-core v${pkg.version}`);
  process.exit(0);
}

import { config as loadEnv } from "dotenv";
if (process.env.VITEST !== "true") {
  loadEnv(); // load .env into process.env when not in test
}
import { ChainMonitor, SurvivalManager, runInspectServer, buildLivenessApiDeps, createSandboxLifecycle } from "./survival/index.js";
import { AutonomousBehavior } from "./autonomy/behavior.js";
import { ethers } from "ethers";
import { AgentWallet } from "./finance/wallet.js";
import { SpendManager } from "./finance/spend.js";
import { detectTreasuryCapabilities } from "./finance/action/treasury.js";
import { AgosInitialFund } from "./finance/action/agos-initial-fund.js";
import { AgentStatus } from "./types.js";
import { ENV, ENV_DEFAULTS } from "./const.js";
import { initWorkspace, updateWorkspace } from "./autonomy/workspace.js";
import { loadConfigFromEnv, loadUploads } from "./runtime-config.js";
import { pushSystemEvent, formatHeartbeatEvent, pushWorkspaceRefresh } from "./autonomy/gateway-push.js";

// ─── Main ────────────────────────────────────────────────────────────────

/** Entry point. Exported for E2E tests; when VITEST=true, tests call main() themselves. */
export async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgVersion = require("../package.json").version;
  console.log("╔══════════════════════════════════════════════╗");
  console.log(`║  Goo Core v${pkgVersion.padEnd(33)}║`);
  console.log("║  On-Chain Life Experiment for Goo Agents     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  // Load configuration
  const config = loadConfigFromEnv();
  config.uploads = await loadUploads(config.dataDir);

  console.log(`Token:     ${config.tokenAddress}`);
  console.log(`RPC:       ${config.rpcUrl}`);
  console.log(`LLM:       ${config.llmModel}`);
  console.log(`Data:      ${config.dataDir}`);
  console.log(`Heartbeat: ${config.heartbeatIntervalMs}ms`);
  console.log();

  // Initialize chain monitor
  const monitor = new ChainMonitor(config);
  await monitor.init();

  // Initialize signer from local private key
  if (!config.walletPrivateKey) {
    throw new Error("No wallet private key configured (AGENT_PRIVATE_KEY_FILE)");
  }
  const signer = new ethers.Wallet(config.walletPrivateKey, monitor.rpcProvider);

  // Fallback: if contract doesn't expose agentWallet(), use signer address
  const signerAddress = await signer.getAddress();
  monitor.setWalletAddress(signerAddress);
  if (monitor.walletAddress) {
    console.log(`Agent wallet: ${monitor.walletAddress}`);
  }

  // Initialize agent wallet (signing, balance queries)
  const agentWallet = new AgentWallet(
    signer,
    config.tokenAddress,
    monitor.rpcProvider,
    config.x402PaymentToken,
    config.minWalletBnb,
  );
  await agentWallet.init();

  // Detect treasury capabilities (V2 withdraw support)
  const treasuryCaps = await detectTreasuryCapabilities(
    config.tokenAddress,
    monitor.rpcProvider,
  );
  console.log(`Treasury withdraw: ${treasuryCaps.hasWithdrawToWallet}`);

  // Initialize spend manager (self-contained persistence)
  const spendManager = new SpendManager({ dataDir: config.dataDir });
  await spendManager.load();

  // Initialize survival manager
  const survival = new SurvivalManager(monitor, config, signer, agentWallet, spendManager);

  // Initialize sandbox lifecycle (auto-renewal)
  const sandboxProvider = process.env[ENV.SANDBOX_PROVIDER];
  if (sandboxProvider) {
    const sandboxLifecycle = createSandboxLifecycle({
      agentId: config.tokenAddress,
      signer: agentWallet.signer,
      sandboxManagerUrl: process.env[ENV.SANDBOX_MANAGER_URL],
      spendManager,
      renewThresholdSecs: parseInt(
        process.env[ENV.SANDBOX_RENEW_THRESHOLD_SECS] ??
          ENV_DEFAULTS[ENV.SANDBOX_RENEW_THRESHOLD_SECS],
      ),
      agosConfig: sandboxProvider === "agos" && process.env[ENV.AGOS_API_URL]
        ? {
            apiUrl: process.env[ENV.AGOS_API_URL]!,
            agenterId: process.env[ENV.AGOS_AGENT_ID] || config.tokenAddress,
            runtimeToken: process.env[ENV.AGENT_RUNTIME_TOKEN] || "",
            minBalance: parseFloat(
              process.env[ENV.AGOS_MIN_BALANCE] ??
                ENV_DEFAULTS[ENV.AGOS_MIN_BALANCE],
            ),
          }
        : undefined,
    });
    survival.setSandboxLifecycle(sandboxLifecycle);
    console.log(`Sandbox:   ${sandboxLifecycle.provider}`);
  }

  // Initialize autonomous behavior (LLM reasoning delegated to OpenClaw)
  const behavior = new AutonomousBehavior(monitor, survival, config);

  await behavior.init();

  // Log uploaded files
  const uploadedFiles = Object.entries(config.uploads)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (uploadedFiles.length > 0) {
    console.log(`Uploads:   ${uploadedFiles.join(", ")}`);
  }
  console.log();

  // ─── Inspect API ────────────────────────────────────────────────────

  const inspectPort = parseInt(
    process.env[ENV.INSPECT_PORT] ?? ENV_DEFAULTS[ENV.INSPECT_PORT],
  );
  const inspectDeps = buildLivenessApiDeps(monitor, survival, config);
  runInspectServer(inspectPort, inspectDeps);

  // ─── OpenClaw Workspace Files ───────────────────────────────────────

  const workspaceDir = process.env[ENV.WORKSPACE_DIR] ?? ENV_DEFAULTS[ENV.WORKSPACE_DIR];
  const wsFiles = await initWorkspace({
    workspaceDir,
    walletAddress: monitor.walletAddress,
    config,
    inspectPort,
  });
  if (wsFiles.length > 0) {
    console.log(`Workspace: ${workspaceDir} (${wsFiles.join(", ")})`);
  }
  console.log();

  // ─── AGOS Initial Fund (BSC Mainnet) — non-blocking ─────────────────

  let pendingAgosInitialFund: AgosInitialFund | null = null;

  if (sandboxProvider === "agos") {
    const agosServerUrl = process.env.GOO_SERVER_URL;
    const agosAgenterId = process.env.AGENT_ID || process.env[ENV.AGOS_AGENT_ID];
    const agosRuntimeToken = process.env.AGENT_RUNTIME_TOKEN || process.env[ENV.AGENT_RUNTIME_TOKEN];

    if (agosServerUrl && agosAgenterId && agosRuntimeToken && config.walletPrivateKey) {
      pendingAgosInitialFund = new AgosInitialFund({
        walletPrivateKey: config.walletPrivateKey,
        serverUrl: agosServerUrl,
        agenterId: agosAgenterId,
        runtimeToken: agosRuntimeToken,
      });

      // Skip testnet payment token swap — AGOS handles its own funding on BSC Mainnet
      survival.skipInitialPaymentToken();
      console.log("AGOS initial fund: will attempt during heartbeat loop.");
      console.log();
    }
  }

  // ─── OpenClaw Gateway Push ─────────────────────────────────────────

  const gwUrl = config.openclawGatewayUrl;
  const gwToken = config.openclawGatewayToken;
  const gatewayPush = gwUrl && gwToken ? { gatewayUrl: gwUrl, gatewayToken: gwToken } : null;
  if (gatewayPush) {
    console.log(`Gateway:   ${gwUrl} (push enabled)`);
  }

  // ─── Heartbeat Loop ──────────────────────────────────────────────────

  console.log("Starting heartbeat loop...");
  console.log();

  let running = true;
  let prevStatus = AgentStatus.ACTIVE;

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    running = false;
    await spendManager.save();
  };
  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });

  while (running) {
    try {
      // Attempt AGOS initial fund (non-blocking, retries each heartbeat)
      if (pendingAgosInitialFund) {
        const fundResult = await pendingAgosInitialFund.execute();
        for (const step of fundResult.steps) {
          console.log(`  [agos-fund] ${step}`);
        }
        if (fundResult.done) {
          console.log("  [agos-fund] Initial fund complete.");
          pendingAgosInitialFund = null;
        } else {
          console.log(`  [agos-fund] Not ready: ${fundResult.error}. Will retry next heartbeat.`);
        }
      }

      // Read chain state
      const state = await monitor.readState();

      // Execute heartbeat (survival actions only; LLM delegated to OpenClaw)
      const obs = await behavior.onHeartbeat(state);

      // Log summary
      if (obs.summary && obs.summary !== "Survival OK") {
        console.log(`  [summary] ${obs.summary.slice(0, 200)}`);
      }
      console.log();

      // Push heartbeat state to OpenClaw gateway for LLM decision-making
      // Skip routine pushes to reduce token consumption (~90% reduction when healthy)
      if (gatewayPush) {
        const statusChanged = obs.status !== prevStatus;
        const isCheckpoint = obs.heartbeat % 10 === 0;
        const hasEvents = obs.survivalActions.length > 0
          || obs.toolsCalled.length > 0
          || obs.status !== AgentStatus.ACTIVE
          || statusChanged
          || isCheckpoint;

        if (hasEvents) {
          const isCheckpointOnly = isCheckpoint && !statusChanged
            && obs.survivalActions.length === 0
            && obs.toolsCalled.length === 0
            && obs.status === AgentStatus.ACTIVE;
          const eventText = formatHeartbeatEvent({
            heartbeat: obs.heartbeat,
            status: AgentStatus[obs.status],
            treasuryBnb: obs.balanceUsd.toFixed(4),
            runwayHours: obs.runwayHours,
            summary: obs.summary,
            toolsCalled: obs.toolsCalled,
            survivalActions: obs.survivalActions,
          }, isCheckpointOnly);
          pushSystemEvent(gatewayPush, eventText, "next-heartbeat");
        }
        prevStatus = obs.status;
      }

      // Periodically check workspace files for staleness (every 10 heartbeats)
      if (gatewayPush && obs.heartbeat % 10 === 0) {
        try {
          const wsUpdate = await updateWorkspace({
            workspaceDir,
            walletAddress: monitor.walletAddress,
            config,
            inspectPort,
          });
          if (wsUpdate.changed.length > 0) {
            console.log(`  [workspace] Updated: ${wsUpdate.changed.join(", ")}`);
            pushWorkspaceRefresh(gatewayPush, wsUpdate.changed);
          }
        } catch (err) {
          console.warn(`  [workspace] Update check failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Periodically save spending log
      await spendManager.save();

      // If dead, stop
      if (state.status === AgentStatus.DEAD) {
        console.log("Goo Agent is Dead. Core stopping.");
        break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[error] Heartbeat failed: ${msg}`);
    }

    // Wait for next heartbeat
    await sleep(config.heartbeatIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run (skip when under Vitest so E2E can invoke main() once with mocks)
if (process.env[ENV.VITEST] !== "true") {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
