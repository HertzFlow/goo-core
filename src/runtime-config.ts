import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeConfig } from "./types.js";
import { ENV, ENV_DEFAULTS } from "./const.js";
import { loadPrivateKeyFromFile } from "./finance/local-key-store.js";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const val = env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key] ?? fallback;
}

function parseChainId(raw: string): number {
  const chainId = Number.parseInt(raw, 10);
  if (chainId !== 56 && chainId !== 97) {
    throw new Error(`Unsupported CHAIN_ID=${raw}; only 56 and 97 are allowed`);
  }
  return chainId;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const dataDir = optional(env, ENV.DATA_DIR, ENV_DEFAULTS[ENV.DATA_DIR]);
  const walletPrivateKeyFile = required(env, ENV.AGENT_PRIVATE_KEY_FILE);

  return {
    rpcUrl: required(env, ENV.RPC_URL),
    chainId: parseChainId(optional(env, ENV.CHAIN_ID, ENV_DEFAULTS[ENV.CHAIN_ID])),
    tokenAddress: required(env, ENV.TOKEN_ADDRESS),
    walletPrivateKeyFile,
    walletPrivateKey: loadPrivateKeyFromFile(walletPrivateKeyFile),

    // LLM config (informational — actual calls delegated to OpenClaw)
    llmApiUrl: optional(env, ENV.LLM_API_URL, ENV_DEFAULTS[ENV.LLM_API_URL]),
    llmApiKey: env[ENV.LLM_API_KEY] || "",
    llmModel: optional(env, ENV.LLM_MODEL, ENV_DEFAULTS[ENV.LLM_MODEL]),

    heartbeatIntervalMs: Number.parseInt(optional(env, ENV.HEARTBEAT_INTERVAL_MS, ENV_DEFAULTS[ENV.HEARTBEAT_INTERVAL_MS]), 10),
    dataDir,

    uploads: {},

    minGasBalance: BigInt(optional(env, ENV.MIN_GAS_BALANCE, ENV_DEFAULTS[ENV.MIN_GAS_BALANCE])),
    gasRefillAmount: BigInt(optional(env, ENV.GAS_REFILL_AMOUNT, ENV_DEFAULTS[ENV.GAS_REFILL_AMOUNT])),
    minWalletBnb: Number.parseFloat(optional(env, ENV.MIN_WALLET_BNB, ENV_DEFAULTS[ENV.MIN_WALLET_BNB])),

    x402PaymentToken: env[ENV.X402_PAYMENT_TOKEN] || undefined,

    openclawGatewayUrl: env[ENV.OPENCLAW_GATEWAY_URL] || undefined,
    openclawGatewayToken: env[ENV.OPENCLAW_GATEWAY_TOKEN] || undefined,

    buyback:
      env[ENV.BUYBACK_ENABLED] === "true"
        ? {
            enabled: true,
            thresholdMultiplier: Number.parseInt(
              optional(env, ENV.BUYBACK_THRESHOLD_MULTIPLIER, ENV_DEFAULTS[ENV.BUYBACK_THRESHOLD_MULTIPLIER]),
              10,
            ),
            burnAddress: optional(
              env,
              ENV.BUYBACK_BURN_ADDRESS,
              ENV_DEFAULTS[ENV.BUYBACK_BURN_ADDRESS],
            ),
          }
        : undefined,
  };
}

export async function loadUploads(dataDir: string): Promise<RuntimeConfig["uploads"]> {
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
