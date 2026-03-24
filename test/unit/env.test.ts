import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV, ENV_DEFAULTS } from "../../src/const.js";
import { loadConfigFromEnv } from "../../src/runtime-config.js";

describe("env (ENV keys and ENV_DEFAULTS)", () => {
  describe("ENV", () => {
    it("has all required env key names", () => {
      // Keys that map to their own name
      const sameNameKeys = [
        "RPC_URL",
        "CHAIN_ID",
        "TOKEN_ADDRESS",
        "AGENT_PRIVATE_KEY_FILE",
        "WALLET_PRIVATE_KEY",
        "LLM_MODEL",
        "HEARTBEAT_INTERVAL_MS",
        "DATA_DIR",
        "MIN_GAS_BALANCE",
        "GAS_REFILL_AMOUNT",
        "BUYBACK_ENABLED",
        "BUYBACK_THRESHOLD_MULTIPLIER",
        "BUYBACK_BURN_ADDRESS",
        "VITEST",
      ];
      for (const key of sameNameKeys) {
        expect(ENV).toHaveProperty(key);
        expect(typeof (ENV as Record<string, string>)[key]).toBe("string");
        expect((ENV as Record<string, string>)[key]).toBe(key);
      }
    });

    it("ENV values are non-empty strings", () => {
      for (const value of Object.values(ENV)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("ENV_DEFAULTS", () => {
    it("has default for every optional env key", () => {
      const optionalKeys = [
        ENV.CHAIN_ID,
        ENV.DATA_DIR,
        ENV.LLM_MODEL,
        ENV.HEARTBEAT_INTERVAL_MS,
        ENV.MIN_GAS_BALANCE,
        ENV.GAS_REFILL_AMOUNT,
        ENV.BUYBACK_THRESHOLD_MULTIPLIER,
        ENV.BUYBACK_BURN_ADDRESS,
      ];
      for (const key of optionalKeys) {
        expect(ENV_DEFAULTS[key]).toBeDefined();
        expect(typeof ENV_DEFAULTS[key]).toBe("string");
      }
    });

    it("CHAIN_ID default parses as integer", () => {
      expect(Number.parseInt(ENV_DEFAULTS[ENV.CHAIN_ID], 10)).toBe(97);
    });

    it("DATA_DIR default is path-like", () => {
      expect(ENV_DEFAULTS[ENV.DATA_DIR]).toBe("/opt/data");
    });

    it("BUYBACK_BURN_ADDRESS default is ethereum address format", () => {
      const addr = ENV_DEFAULTS[ENV.BUYBACK_BURN_ADDRESS];
      expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  describe("load config from process.env (using ENV + ENV_DEFAULTS)", () => {
      const requiredVars = [
        ENV.RPC_URL,
        ENV.TOKEN_ADDRESS,
        ENV.AGENT_PRIVATE_KEY_FILE,
      ] as const;

    let envBackup: Record<string, string | undefined>;
    let tempDir: string;
    let keyFile: string;

    beforeEach(() => {
      envBackup = {};
      for (const k of requiredVars) {
        envBackup[k] = process.env[k];
      }
      tempDir = mkdtempSync(join(tmpdir(), "goo-env-"));
      mkdirSync(join(tempDir, "wallet"), { recursive: true, mode: 0o700 });
      keyFile = join(tempDir, "wallet", "private-key");
      writeFileSync(
        keyFile,
        "0x0000000000000000000000000000000000000000000000000000000000000001\n",
        { mode: 0o600 },
      );
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
      for (const [k, v] of Object.entries(envBackup)) {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
      }
    });

    it("throws when a required var is missing", () => {
        const env = {
          [ENV.RPC_URL]: "https://rpc.example.com",
          [ENV.TOKEN_ADDRESS]: "0x111111111111111111111111111111111111111111",
          [ENV.AGENT_PRIVATE_KEY_FILE]: keyFile,
        };
      expect(() => loadConfigFromEnv(env)).not.toThrow();

      for (const key of requiredVars) {
        const envMissing = { ...env, [key]: undefined };
        expect(() => loadConfigFromEnv(envMissing as NodeJS.ProcessEnv)).toThrow(
          new RegExp(`Missing required env var: ${key}`)
        );
      }
    });

    it("returns config with defaults when only required vars set", () => {
      const env: NodeJS.ProcessEnv = {
        [ENV.RPC_URL]: "https://rpc.example.com",
        [ENV.TOKEN_ADDRESS]: "0x111111111111111111111111111111111111111111",
        [ENV.AGENT_PRIVATE_KEY_FILE]: keyFile,
      };
      const config = loadConfigFromEnv(env);
      expect(config.rpcUrl).toBe(env[ENV.RPC_URL]);
      expect(config.chainId).toBe(97);
      expect(config.dataDir).toBe("/opt/data");
      expect(config.llmModel).toBe("deepseek/deepseek-chat");
      expect(config.walletPrivateKeyFile).toBe(keyFile);
      expect(config.walletPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(config.buyback).toBeUndefined();
    });

    it("uses process.env when set and falls back to ENV_DEFAULTS", () => {
      const env: NodeJS.ProcessEnv = {
        [ENV.RPC_URL]: "https://rpc.example.com",
        [ENV.TOKEN_ADDRESS]: "0x111111111111111111111111111111111111111111",
        [ENV.AGENT_PRIVATE_KEY_FILE]: keyFile,
        [ENV.DATA_DIR]: "/custom/data",
        [ENV.CHAIN_ID]: "56",
      };
      const config = loadConfigFromEnv(env);
      expect(config.dataDir).toBe("/custom/data");
      expect(config.chainId).toBe(56);
    });

    it("sets buyback when BUYBACK_ENABLED=true", () => {
      const env: NodeJS.ProcessEnv = {
        [ENV.RPC_URL]: "https://rpc.example.com",
        [ENV.TOKEN_ADDRESS]: "0x111111111111111111111111111111111111111111",
        [ENV.AGENT_PRIVATE_KEY_FILE]: keyFile,
        [ENV.BUYBACK_ENABLED]: "true",
      };
      const config = loadConfigFromEnv(env);
      expect(config.buyback).toBeDefined();
      expect(config.buyback?.enabled).toBe(true);
      expect(config.buyback?.thresholdMultiplier).toBe(10);
      expect(config.buyback?.burnAddress).toBe(ENV_DEFAULTS[ENV.BUYBACK_BURN_ADDRESS]);
    });

    it("rejects unsupported chain ids", () => {
      const env: NodeJS.ProcessEnv = {
        [ENV.RPC_URL]: "https://rpc.example.com",
        [ENV.TOKEN_ADDRESS]: "0x111111111111111111111111111111111111111111",
        [ENV.AGENT_PRIVATE_KEY_FILE]: keyFile,
        [ENV.CHAIN_ID]: "1",
      };
      expect(() => loadConfigFromEnv(env)).toThrow(/Unsupported CHAIN_ID/);
    });
  });
});
