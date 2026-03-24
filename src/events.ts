/**
 * Structured event emitter — outputs JSON lines to stdout for server-side parsing.
 *
 * Format: {"goo_event":true,"ts":"...","type":"...","severity":"...","message":"...","data":{...}}
 * Server detects lines starting with `{"goo_event":` and persists them to AgentEvent table.
 */

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
}
