/**
 * Structured event emitter — outputs JSON lines to stdout for server-side parsing,
 * and optionally POSTs to EVENT_CALLBACK_URL for sandbox/remote agents.
 *
 * Format: {"goo_event":true,"ts":"...","type":"...","severity":"...","message":"...","data":{...}}
 * Server detects lines starting with `{"goo_event":` and persists them to AgentEvent table.
 */

import { ENV } from "./const.js";

export type EventSeverity = "info" | "warn" | "error" | "critical";

export function emitEvent(
  type: string,
  severity: EventSeverity,
  message: string,
  data?: Record<string, unknown>,
): void {
  const event = {
    goo_event: true,
    ts: new Date().toISOString(),
    type,
    severity,
    message,
    ...(data && { data }),
  };
  const line = JSON.stringify(event);
  process.stdout.write(line + "\n");

  // Fire-and-forget POST to callback URL (sandbox → server event bus)
  const callbackUrl = process.env[ENV.EVENT_CALLBACK_URL];
  if (callbackUrl) {
    fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: line,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Silently ignore callback failures — stdout is the primary channel
    });
  }
}
