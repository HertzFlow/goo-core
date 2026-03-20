import { ethers } from "ethers";
import { type ChainState, type RuntimeConfig } from "../types.js";
import type { LivenessPayload } from "../types.js";
import type { ChainMonitor } from "./chain-monitor.js";
import { buildLivenessPayload } from "./status-collector.js";
import { DEFAULT_PULSE_TIMEOUT_SECS } from "../const.js";

export interface PulseEmitterDeps {
  tokenAddress: string;
  signer: ethers.Signer;
  monitor: ChainMonitor;
}

/**
 * Emit Pulse (proof-of-life) on-chain if enough time has passed since lastPulseAt.
 * Returns action message or null if no emit needed.
 */
export async function emitPulse(
  state: ChainState,
  deps: PulseEmitterDeps,
  lastPulseTimeRef: { current: number },
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const lastPulse = Number(state.lastPulseAt);

  let timeout: number;
  try {
    const contract = new ethers.Contract(
      deps.tokenAddress,
      ["function PULSE_TIMEOUT_SECS() view returns (uint256)"],
      deps.monitor.rpcProvider,
    );
    timeout = Number(await contract.PULSE_TIMEOUT_SECS());
  } catch {
    timeout = DEFAULT_PULSE_TIMEOUT_SECS;
  }

  const pulseInterval = Math.floor(timeout / 3);
  if (
    now - lastPulse < pulseInterval &&
    now - lastPulseTimeRef.current < pulseInterval
  ) {
    return null;
  }

  const token = new ethers.Contract(
    deps.tokenAddress,
    ["function emitPulse()"],
    deps.signer,
  );

  try {
    const tx = await token.emitPulse();
    await tx.wait();
    lastPulseTimeRef.current = now;
    return `Pulse sent (tx: ${tx.hash})`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Pulse failed: ${msg}`;
  }
}

/**
 * Build liveness payload for API (re-export from status-collector for pulse module surface).
 */
export function getLivenessPayload(
  state: ChainState,
  config: Pick<RuntimeConfig, "tokenAddress" | "chainId">,
): LivenessPayload {
  return buildLivenessPayload(state, config);
}
