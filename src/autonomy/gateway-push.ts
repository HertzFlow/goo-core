import { execFile } from "node:child_process";

interface GatewayPushConfig {
  gatewayUrl: string; // e.g. "ws://127.0.0.1:19789"
  gatewayToken: string;
}

/**
 * Push a system event to the OpenClaw gateway via CLI.
 * Fire-and-forget — errors are logged but never block the heartbeat loop.
 */
export function pushSystemEvent(
  config: GatewayPushConfig,
  text: string,
  mode: "now" | "next-heartbeat" = "next-heartbeat",
): void {
  const args = [
    "system", "event",
    "--text", text,
    "--mode", mode,
    "--token", config.gatewayToken,
    "--url", config.gatewayUrl,
  ];

  execFile("openclaw", args, { timeout: 15_000 }, (err, _stdout, stderr) => {
    if (err) {
      console.warn(`[gateway-push] Failed: ${err.message}`);
    } else if (stderr && stderr.includes("Error")) {
      console.warn(`[gateway-push] Warning: ${stderr.trim().slice(0, 200)}`);
    }
  });
}

/**
 * Push a workspace-changed notification so the agent re-reads updated .md files.
 * Called only when workspace files actually changed (hash comparison).
 */
export function pushWorkspaceRefresh(
  config: GatewayPushConfig,
  changedFiles: string[],
): void {
  const fileList = changedFiles.join(", ");
  const text = `[SYSTEM] Workspace files updated: ${fileList}. Re-read these files for current state.`;
  pushSystemEvent(config, text, "now");
}

/**
 * Format an observation into a concise system event text for the gateway.
 */
export function formatHeartbeatEvent(obs: {
  heartbeat: number;
  status: string;
  treasuryBnb: string;
  runwayHours: number;
  summary: string;
  toolsCalled: string[];
  survivalActions: string[];
}, compact = false): string {
  if (compact) {
    return `#${obs.heartbeat} ${obs.status} ${obs.treasuryBnb}BNB ${obs.runwayHours}h`;
  }

  const parts = [
    `[heartbeat #${obs.heartbeat}]`,
    `Status=${obs.status}`,
    `Treasury=${obs.treasuryBnb} BNB`,
    `Runway=${obs.runwayHours}h`,
  ];

  if (obs.survivalActions.length > 0) {
    parts.push(`Survival: ${obs.survivalActions.join(", ")}`);
  }

  if (obs.toolsCalled.length > 0) {
    parts.push(`Tools: ${obs.toolsCalled.join(", ")}`);
  }

  if (obs.summary && obs.summary !== "(LLM not called)") {
    const shortSummary = obs.summary.length > 120
      ? obs.summary.slice(0, 117) + "..."
      : obs.summary;
    parts.push(`Summary: ${shortSummary}`);
  }

  return parts.join(" | ");
}
