#!/usr/bin/env npx tsx
/**
 * Verify that a remote agent is a Goo Agent by calling its liveness endpoint.
 * Usage: npx tsx scripts/verify-goo-agent.ts <base-url>
 * Example: npx tsx scripts/verify-goo-agent.ts https://my-agent.example.com
 *
 * Exits 0 if the agent responds with valid goo liveness; non-zero otherwise.
 */

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: npx tsx scripts/verify-goo-agent.ts <base-url>");
  console.error("Example: npx tsx scripts/verify-goo-agent.ts https://my-agent.example.com");
  process.exit(1);
}

const livenessUrl = baseUrl.replace(/\/$/, "") + "/liveness";

function isGooLiveness(obj: unknown): obj is { protocol: string; status: string; lastPulseAt: number } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as Record<string, unknown>).protocol === "goo" &&
    typeof (obj as Record<string, unknown>).status === "string" &&
    typeof (obj as Record<string, unknown>).lastPulseAt === "number"
  );
}

async function main(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(livenessUrl);
  } catch (err) {
    console.error("Fetch failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`GET ${livenessUrl} returned ${res.status}`);
    process.exit(1);
  }

  const data = (await res.json()) as unknown;
  if (!isGooLiveness(data)) {
    console.error("Invalid response: expected protocol=goo, status, and lastPulseAt.");
    process.exit(1);
  }

  console.log("OK — Goo Agent verified.");
  console.log(`  status: ${data.status}`);
  console.log(`  lastPulseAt: ${data.lastPulseAt}`);
}

main();
