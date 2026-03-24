/**
 * Inspect / liveness HTTP integration — error paths and URL edge cases
 * not covered by liveness-integration.test.ts (happy-path only).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import {
  createInspectRequestListener,
  runInspectServer,
  type LivenessApiDeps,
} from "../../src/survival/liveness-api.js";
import type { ChainMonitor } from "../../src/survival/chain-monitor.js";
import type { SurvivalManager } from "../../src/survival/survival-manager.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";
import { AgentStatus } from "../../src/types.js";

function minimalDeps(overrides: Partial<LivenessApiDeps> = {}): LivenessApiDeps {
  return {
    monitor: {
      readState: async () => {
        throw new Error("simulated RPC failure");
      },
    } as unknown as ChainMonitor,
    survival: {} as unknown as SurvivalManager,
    config: mockRuntimeConfig,
    ...overrides,
  };
}

describe("Liveness / Inspect API — errors & URL handling", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  afterEach(async () => {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function listen(listener: ReturnType<typeof createInspectRequestListener>): Promise<void> {
    server = createServer((req, res) => {
      listener(req, res).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  it("GET /liveness returns 500 when readState throws", async () => {
    await listen(createInspectRequestListener(minimalDeps()));
    const res = await fetch(`${baseUrl}/liveness`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("Internal error");
    expect(body.message).toContain("simulated RPC failure");
  });

  it("GET /inspect returns 500 when readState throws before path handling", async () => {
    await listen(createInspectRequestListener(minimalDeps()));
    const res = await fetch(`${baseUrl}/inspect`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("Internal error");
    expect(body.message).toContain("simulated RPC failure");
  });

  it("strips query string from path for /liveness?debug=1", async () => {
    const deps = minimalDeps({
      monitor: {
        readState: async () => makeChainState({ status: AgentStatus.ACTIVE }),
      } as unknown as ChainMonitor,
    });
    await listen(createInspectRequestListener(deps));
    const res = await fetch(`${baseUrl}/liveness?debug=1`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.protocol).toBe("goo");
  });

  it("runInspectServer binds listener and serves GET /liveness", async () => {
    const deps: LivenessApiDeps = {
      monitor: {
        readState: async () => makeChainState({ status: AgentStatus.ACTIVE }),
      } as unknown as ChainMonitor,
      survival: {} as unknown as SurvivalManager,
      config: mockRuntimeConfig,
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = runInspectServer(0, deps);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}/liveness`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[liveness-api\] Listening on http:\/\/0\.0\.0\.0:\d+/),
    );
    logSpy.mockRestore();
  });
});
