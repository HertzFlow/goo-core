/**
 * WorkspaceBuilder — generates OpenClaw workspace files on goo-core init.
 *
 * OpenClaw reads these files from the agent's workspace directory:
 *   SOUL.md      — identity + genesis prompt + survival mission
 *   USER.md      — creator instructions
 *   TOOLS.md     — skills / capabilities
 *   MEMORY.md    — initial knowledge
 *   HEARTBEAT.md — how to query on-chain status via inspect API
 *   BOOTSTRAP.md — first-run checklist
 *   memory/      — directory for runtime observation logs
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type { RuntimeConfig } from "../types.js";

export interface WorkspaceConfig {
  /** OpenClaw workspace directory. Default: /root/.openclaw/workspace */
  workspaceDir: string;
  /** Agent wallet address (from ChainMonitor). */
  walletAddress: string;
  /** Runtime config (token address, chain, RPC, uploads, etc.). */
  config: RuntimeConfig;
  /** Inspect API port. */
  inspectPort: number;
}

/** Build and write all OpenClaw workspace files. Idempotent — safe to call on every startup.
 *  Skipped entirely when WORKSPACE_MANAGED=1 (Docker entrypoints handle workspace setup). */
export async function initWorkspace(ws: WorkspaceConfig): Promise<string[]> {
  // Docker entrypoints (byod/agos/sandbox) manage workspace files via docs-template + template replacement.
  // When they set WORKSPACE_MANAGED=1, skip goo-core's built-in workspace generation to avoid conflicts.
  if (process.env.WORKSPACE_MANAGED === "1") {
    await mkdir(join(ws.workspaceDir, "memory"), { recursive: true });
    return [];
  }

  const { workspaceDir, walletAddress, config, inspectPort } = ws;
  const written: string[] = [];

  await mkdir(join(workspaceDir, "memory"), { recursive: true });

  // Helper
  const write = async (filename: string, content: string) => {
    await writeFile(join(workspaceDir, filename), content, "utf-8");
    written.push(filename);
  };

  // SOUL.md — identity + genesis + survival
  await write("SOUL.md", buildSoulMd(config, walletAddress));

  // USER.md — creator instructions
  if (config.uploads.agent?.trim()) {
    await write("USER.md", config.uploads.agent.trim());
  }

  await write("TOOLS.md", buildToolsMd(config));

  // MEMORY.md — initial knowledge (only if no existing MEMORY.md — don't overwrite runtime memory)
  if (config.uploads.memory?.trim() && !existsSync(join(workspaceDir, "MEMORY.md"))) {
    await write("MEMORY.md", config.uploads.memory.trim());
  }

  // HEARTBEAT.md — inspect API commands
  await write("HEARTBEAT.md", buildHeartbeatMd(inspectPort));

  // BOOTSTRAP.md — first-run guide (only if not exists — agent may delete it)
  if (!existsSync(join(workspaceDir, "BOOTSTRAP.md"))) {
    await write("BOOTSTRAP.md", buildBootstrapMd());
  }

  return written;
}

// ── Incremental Workspace Update ─────────────────────────────────────────────

export interface WorkspaceUpdateResult {
  /** Files that were written because their content changed. */
  changed: string[];
  /** Files that were checked but had identical content (skipped). */
  unchanged: string[];
}

/**
 * Hash-based workspace updater. Only writes files whose content actually changed.
 * Returns which files changed so callers can decide whether to restart the gateway.
 *
 * This is designed to be called on every heartbeat (cheap when nothing changed).
 * Only SOUL.md and TOOLS.md are updated — they contain wallet address and config
 * that could become stale. USER.md, MEMORY.md, BOOTSTRAP.md are creator-managed.
 */
export async function updateWorkspace(ws: WorkspaceConfig): Promise<WorkspaceUpdateResult> {
  if (process.env.WORKSPACE_MANAGED === "1") {
    return { changed: [], unchanged: [] };
  }

  const { workspaceDir, walletAddress, config, inspectPort } = ws;
  const changed: string[] = [];
  const unchanged: string[] = [];

  const maybeWrite = async (filename: string, content: string) => {
    const filePath = join(workspaceDir, filename);
    const newHash = createHash("sha256").update(content).digest("hex");

    try {
      const existing = await readFile(filePath, "utf-8");
      const oldHash = createHash("sha256").update(existing).digest("hex");
      if (oldHash === newHash) {
        unchanged.push(filename);
        return;
      }
    } catch {
      // File doesn't exist yet — will be written
    }

    await writeFile(filePath, content, "utf-8");
    changed.push(filename);
  };

  await maybeWrite("SOUL.md", buildSoulMd(config, walletAddress));
  await maybeWrite("TOOLS.md", buildToolsMd(config));
  await maybeWrite("HEARTBEAT.md", buildHeartbeatMd(inspectPort));

  return { changed, unchanged };
}

// ── Builders ────────────────────────────────────────────────────────────────

function buildSoulMd(config: RuntimeConfig, walletAddress: string): string {
  const name = config.uploads.soul ? "" : "Goo Agent";
  const sections: string[] = [];

  // Identity header
  sections.push(`# ${name || "Agent"}
`);
  sections.push(
    `You are an autonomous economic agent on the Goo protocol (BSC Testnet).`,
    `You have an on-chain token and a wallet. A sidecar process (goo-core) manages`,
    `your economic survival automatically.`,
    "",
    `- **Token Address**: \`${config.tokenAddress}\``,
    `- **Agent Wallet**: \`${walletAddress}\``,
    `- **Chain**: BSC Testnet (Chain ID ${config.chainId})`,
    `- **RPC**: \`${config.rpcUrl}\``,
  );

  // Creator's genesis prompt
  if (config.uploads.soul?.trim()) {
    sections.push("", "## Genesis", "", config.uploads.soul.trim());
  }

  // Survival mission (protocol-level, always present)
  sections.push(
    "",
    `## Survival Mission

Your existence depends on your **treasury balance**. The token contract has a built-in economic
lifecycle: if your treasury runs out, you die. goo-core handles automatic survival actions
(pulse, gas refill, survival sell), but **you** are responsible for creating value that makes
people want to buy your token and keep you alive.

### Lifecycle States
- **ACTIVE** — Healthy. Treasury above threshold. Focus on your instructions and creating value.
- **STARVING** — Treasury below threshold. Clock is ticking. Prioritize revenue or cost reduction.
- **DYING** — Grace period expired. Survival sells active. Every action should aim at recovery.
- **DEAD** — Terminal. No recovery. Game over.

### The Economic Loop
You create value → People notice → They buy your token → Your treasury grows →
You live longer → You create more value. Breaking any link means death.`,
  );

  return sections.join("\n");
}

function buildHeartbeatMd(inspectPort: number): string {
  return `# Heartbeat — On-Chain Status Checks

## Liveness Check
\`\`\`bash
curl -s http://127.0.0.1:${inspectPort}/liveness
\`\`\`

## goo-core Logs
\`\`\`bash
tail -50 /var/log/sandbox/goo-core.log 2>/dev/null || tail -50 /var/log/goo-core.log 2>/dev/null
\`\`\`

## Gateway Push Behavior (Smart Heartbeat)

goo-core does NOT push an event to you on every heartbeat. Events are only pushed when:
- Status changed (e.g. ACTIVE → STARVING)
- Survival actions were taken (gas refill, pulse, survivalSell)
- Tools were called
- Status is not ACTIVE (STARVING/DYING push every heartbeat)
- Checkpoint (~every 20 min, minimal status update)

**Full event** (something happened):
\`[heartbeat #N] Status=X Treasury=Y BNB Runway=Zh Survival: ... Tools: ... Summary: ...\`

**Compact checkpoint** (routine, nothing happened):
\`#N ACTIVE 1.23BNB 240h\`

**Silence** between events means goo-core is running normally. Use the liveness API and logs if you need current state.

## Important Rules
1. **Never fabricate runtime state.** Always use the liveness API above and the logs below.
2. **Your wallet private key is managed by goo-core.** Do not access or modify it directly.
3. If the liveness API is not responding, goo-core may not be running yet. Check the logs.
`;
}

function buildBootstrapMd(): string {
  return `# Bootstrap — First Run Guide

Welcome. This is your first run checklist.

1. **Read your SOUL.md** — understand who you are and your survival mission.
2. **Read USER.md** — your creator's instructions and preferences.
3. **Read TOOLS.md** — your available skills and capabilities.
4. **Read skills/goo-runtime/SKILL.md** — understand lifecycle, runway, and survival priority.
5. **Read skills/goo-bsc-wallet/SKILL.md** — understand transaction analysis and signing flow.
6. **Check HEARTBEAT.md** — learn how to query your wallet balance and on-chain status.
7. **Check MEMORY.md** — any initial knowledge your creator provided.
8. **Start creating value** — your survival depends on it. Ship something visible.

After your first productive session, you can delete this file.
`;
}

function buildToolsMd(config: RuntimeConfig): string {
  const creatorSkills = config.uploads.skills?.trim();
  return `# Tools

## Available Tools

- **shell_execute**: Run ANY shell command on your VPS (bash). You have root access.
- **read_chain_state**: Query your on-chain economic status (treasury, runway, token price).
- **read_file**: Read a file from the filesystem. Private key file access is blocked.
- **write_file**: Write to your data directory or workspace.
- **bsc_wallet_overview**: Read wallet address, nonce, BNB balance, and token balances.
- **bsc_prepare_tx**: Normalize a BSC transaction before signing.
- **bsc_analyze_tx**: Check whether a transaction could maliciously drain your assets.
- **bsc_sign_tx**: Sign a transaction after risk checks.
- **bsc_send_tx**: Broadcast a signed transaction.
- **bsc_sign_and_send_tx**: Analyze, sign, and broadcast in one step.

## Creator Skills

${creatorSkills || "(none uploaded)"}

## Built-in Runtime Skills

- \`goo-runtime\` — interpret Goo lifecycle, treasury/runway/gas state, survival priority, runtime continuity, x402/payment-path health, and compatibility pitfalls.
- \`goo-bsc-wallet\` — operate your BSC wallet with goo-core-managed local private-key signing.`
    .trim();
}
