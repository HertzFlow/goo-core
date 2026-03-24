import { createServer } from "node:http";
import type { ChainMonitor } from "./chain-monitor.js";
import type { SurvivalManager } from "./survival-manager.js";
import type { RuntimeConfig } from "../types.js";
import { getLivenessPayload } from "./pulse.js";

export interface LivenessApiDeps {
  monitor: ChainMonitor;
  survival: SurvivalManager;
  config: RuntimeConfig;
}

/**
 * Create request listener that serves GET /liveness.
 * When agent is publicly deployed, anyone can call this to verify it is a Goo Agent.
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

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found", paths: ["/liveness"] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error", message: msg }));
    }
  };
}

/**
 * Start HTTP server that serves GET /liveness.
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
    console.log(`[liveness-api] Listening on http://0.0.0.0:${port} — GET /liveness`);
  });
  return server;
}

/** Build deps for the public liveness API. */
export function buildLivenessApiDeps(
  monitor: ChainMonitor,
  survival: SurvivalManager,
  config: RuntimeConfig
): LivenessApiDeps {
  return {
    monitor,
    survival,
    config,
  };
}
