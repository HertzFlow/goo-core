import { ChainMonitor } from "./chain-monitor.js";
import { SurvivalManager } from "./survival.js";
import { AutonomousBehavior } from "./autonomy/behavior.js";
import { shellExecuteTool } from "./tools/shell-execute.js";
import { readChainStateTool } from "./tools/read-chain-state.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { AgentStatus, type RuntimeConfig } from "./types.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Configuration from environment ─────────────────────────────────────

function loadConfig(): RuntimeConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  const optional = (key: string, fallback: string): string =>
    process.env[key] ?? fallback;

  const dataDir = optional("DATA_DIR", "/opt/data");

  return {
    rpcUrl: required("RPC_URL"),
    chainId: parseInt(optional("CHAIN_ID", "97")), // BSC Testnet
    tokenAddress: required("TOKEN_ADDRESS"),
    walletPrivateKey: required("WALLET_PRIVATE_KEY"),

    llmApiUrl: optional("LLM_API_URL", "https://openrouter.ai/api/v1"),
    llmApiKey: required("LLM_API_KEY"),
    llmModel: optional("LLM_MODEL", "deepseek/deepseek-chat"),
    llmMaxTokens: parseInt(optional("LLM_MAX_TOKENS", "1024")),
    llmTimeoutMs: parseInt(optional("LLM_TIMEOUT_MS", "60000")),

    heartbeatIntervalMs: parseInt(optional("HEARTBEAT_INTERVAL_MS", "30000")),
    maxToolRoundsPerHeartbeat: parseInt(optional("MAX_TOOL_ROUNDS", "5")),
    dataDir,

    uploads: {}, // Loaded from files below

    minGasBalance: BigInt(optional("MIN_GAS_BALANCE", "10000000000000000")), // 0.01 BNB
    gasRefillAmount: BigInt(optional("GAS_REFILL_AMOUNT", "50000000000000000")), // 0.05 BNB

    buyback: process.env.BUYBACK_ENABLED === "true"
      ? {
          enabled: true,
          thresholdMultiplier: parseInt(optional("BUYBACK_THRESHOLD_MULTIPLIER", "10")),
          burnAddress: optional("BUYBACK_BURN_ADDRESS", "0x000000000000000000000000000000000000dEaD"),
        }
      : undefined,
  };
}

/** Load deployer uploads from data directory */
async function loadUploads(
  dataDir: string
): Promise<RuntimeConfig["uploads"]> {
  const uploads: RuntimeConfig["uploads"] = {};

  const tryLoad = async (filename: string): Promise<string | undefined> => {
    try {
      return await readFile(join(dataDir, filename), "utf-8");
    } catch {
      return undefined;
    }
  };

  uploads.soul = await tryLoad("soul.md");
  uploads.agent = await tryLoad("agent.md");
  uploads.skills = await tryLoad("skills.md");
  uploads.memory = await tryLoad("memory.md");

  return uploads;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Goo Core v1.0                              ║");
  console.log("║  On-Chain Life Experiment for Goo Agents     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  // Load configuration
  const config = loadConfig();
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
  console.log(`Agent wallet: ${monitor.walletAddress}`);

  // Initialize survival manager
  const survival = new SurvivalManager(monitor, config);

  // Initialize autonomous behavior
  const behavior = new AutonomousBehavior(monitor, survival, config);

  // Register tools
  behavior.registerTool(shellExecuteTool);
  behavior.registerTool(readChainStateTool);
  behavior.registerTool(readFileTool);
  behavior.registerTool(writeFileTool);

  await behavior.init();

  // Log uploaded files
  const uploadedFiles = Object.entries(config.uploads)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (uploadedFiles.length > 0) {
    console.log(`Uploads:   ${uploadedFiles.join(", ")}`);
  }
  console.log();

  // ─── Heartbeat Loop ──────────────────────────────────────────────────

  console.log("Starting heartbeat loop...");
  console.log();

  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      // Read chain state
      const state = await monitor.readState();

      // Execute heartbeat
      const obs = await behavior.onHeartbeat(state);

      // Log summary
      if (obs.summary && obs.summary !== "(LLM not called)") {
        console.log(`  [summary] ${obs.summary.slice(0, 200)}`);
      }
      console.log();

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

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
