import { ethers } from "ethers";
import type { ChainState } from "../types.js";
import { TOKEN_LIFECYCLE_ABI } from "../const.js";

export interface LifecycleDeps {
  tokenAddress: string;
  signer: ethers.Signer;
}

const ACTION_LABELS: Record<number, string> = {
  1: "triggerRecovery() → ACTIVE",
  2: "triggerStarving() → STARVING",
  3: "triggerDying() → DYING",
  4: "triggerDead() → DEAD",
};

/**
 * Call the unified triggerLifecycle() on-chain.
 *
 * Uses staticCall to preview the action first, then sends the tx only if needed.
 * The contract evaluates all transitions in priority order:
 *   1=recovery, 2=starving, 3=dying, 4=dead, 0=no-op.
 *
 * Returns a human-readable action string, or null if no transition occurred.
 */
export async function evaluateLifecycleTriggers(
  _state: ChainState,
  deps: LifecycleDeps,
): Promise<string | null> {
  const contract = new ethers.Contract(
    deps.tokenAddress,
    TOKEN_LIFECYCLE_ABI,
    deps.signer,
  );

  try {
    // Preview: check what action would be taken without sending a tx
    const action = Number(await contract.triggerLifecycle.staticCall());
    if (action === 0) return null;

    const label = ACTION_LABELS[action];
    if (!label) return null;

    // Execute the actual state-changing tx
    const tx = await contract.triggerLifecycle();
    const receipt = await tx.wait();
    return `Lifecycle: ${label} (tx: ${receipt.hash})`;
  } catch {
    // Contract revert or RPC error — not actionable
    return null;
  }
}
