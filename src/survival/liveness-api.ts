import { createServer } from "node:http";
import type { ChainMonitor } from "./chain-monitor.js";
import type { SurvivalManager } from "./survival-manager.js";
import type { RuntimeConfig } from "../types.js";
import { getLivenessPayload } from "./pulse.js";
import { collectAgentInspection } from "./status-collector.js";
import { SoulManager } from "../autonomy/soul.js";

export interface LivenessApiDeps {
  monitor: ChainMonitor;
  survival: SurvivalManager;
  config: RuntimeConfig;
  getThreeLaws: () => string;
  /** Last survival action messages (from last evaluate). If not set, inspect uses []. */
  lastSurvivalActions?: string[];
}

/**
 * Create request listener that serves GET /liveness and GET /inspect.
 * When agent is publicly deployed, anyone can call these to verify it is a Goo Agent.
 */
export function createInspectRequestListener(deps: LivenessApiDeps) {
  return async (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse
  ): Promise<void> => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const state = await deps.monitor.readState();

      if (path === "/liveness" || path === "/liveness/") {
        const payload = getLivenessPayload(state, deps.config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload, null, 2));
        return;
      }

      if (path === "/inspect" || path === "/inspect/") {
        const survivalActions = deps.lastSurvivalActions ?? [];
        const payload = collectAgentInspection({
          chainState: state,
          survivalActions,
          config: deps.config,
          threeLaws: deps.getThreeLaws(),
          monitor: deps.monitor,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload, null, 2));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found", paths: ["/liveness", "/inspect"] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error", message: msg }));
    }
  };
}

/**
 * Start HTTP server that serves GET /liveness and GET /inspect.
 * Use when agent is publicly deployed so anyone can verify it is a Goo Agent.
 */
export function runInspectServer(
  port: number,
  deps: LivenessApiDeps
): import("node:http").Server {
  const listener = createInspectRequestListener(deps);
  const server = createServer((req, res) => {
    listener(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    });
  });
  server.listen(port, () => {
    console.log(`[liveness-api] Listening on http://0.0.0.0:${port} — GET /liveness, GET /inspect`);
  });
  return server;
}

/**
 * Build deps for liveness API from monitor, survival, config and dataDir (for SoulManager.getThreeLaws).
 */
export function buildLivenessApiDeps(
  monitor: ChainMonitor,
  survival: SurvivalManager,
  config: RuntimeConfig
): LivenessApiDeps {
  return {
    monitor,
    survival,
    config,
    getThreeLaws: () => SoulManager.getThreeLaws(),
  };
}
