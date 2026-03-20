import { ethers } from "ethers";
import { AgentStatus, type ChainState, type Observation } from "../types.js";
import { MAINTENANCE_COMMANDS, MAINTENANCE_LOOP_THRESHOLD } from "../const.js";

/**
 * Build the user message for each heartbeat.
 * All numbers come from chain state — anti-hallucination by design.
 */
export function buildHeartbeatContext(
  state: ChainState,
  recentObservations: Observation[],
  survivalActions: string[],
): string {
  const sections: string[] = [];

  // ─── On-Chain Status (FACTS) ────────────────────────────────────────
  const statusName = AgentStatus[state.status];
  const treasuryBnb = formatBnb(state.treasuryBalance);
  const thresholdBnb = formatBnb(state.starvingThreshold);
  const burnRateBnb = formatBnb(state.fixedBurnRate);
  const nativeBal = ethers.formatEther(state.nativeBalance);

  sections.push(
    `## On-Chain Status (real-time, from smart contract — these are FACTS, do not fabricate)`,
    `- **Status**: ${statusName}`,
    `- **Treasury Balance**: ${treasuryBnb} BNB`,
    `- **Starving threshold**: ${thresholdBnb} BNB`,
    `- **Daily Burn Rate**: ${state.fixedBurnRate > 0n ? `${burnRateBnb} BNB/day` : 'N/A (balance-based)'}`,
    `- **Estimated Runway**: ${state.fixedBurnRate > 0n ? `${state.runwayHours} hours (~${Math.floor(state.runwayHours / 24)} days)` : 'N/A (balance-based)'}`,
    `- **Wallet BNB Balance**: ${nativeBal} (for gas + treasury)`,
    `- **Token Holdings**: ${ethers.formatEther(state.tokenHoldings)} tokens (contract-held)`,
    ``,
  );

  // ─── Survival Urgency ──────────────────────────────────────────────
  if (state.status === AgentStatus.STARVING) {
    sections.push(
      `## ⚠ Starving`,
      `Your treasury is below the survival threshold (${thresholdBnb} BNB).`,
      `You have STARVING_GRACE_PERIOD to recover before escalating to Dying.`,
      `**Priority**: Generate revenue, reduce costs, or trigger a survivalSell.`,
      ``,
    );
  } else if (state.status === AgentStatus.DYING) {
    sections.push(
      `## 🚨 Dying`,
      `Grace period expired. You are in Dying state.`,
      `- Survival sells are executing automatically.`,
      `- Anyone can become Successor (CTO) by claiming on your contract.`,
      `- If you stop emitting Pulse or DYING_MAX_DURATION expires, you go Dead.`,
      `**Priority**: SURVIVE. Recovery = deposit or Successor/CTO; every action should aim at treasury recovery.`,
      ``,
    );
  } else if (state.fixedBurnRate > 0n && state.runwayHours < 72 && state.status === AgentStatus.ACTIVE) {
    sections.push(
      `## Runway Alert`,
      `Your runway is only ${state.runwayHours} hours (~${Math.floor(state.runwayHours / 24)} days).`,
      `Start planning cost reduction or revenue generation before you hit Starving.`,
      ``,
    );
  }

  // ─── Maintenance Loop Detection ──────────────────────────────────────
  const recentShells = recentObservations.flatMap((o) => o.shellCommands);
  if (recentShells.length > 0) {
    const maintenanceCount = recentShells.filter((cmd) =>
      MAINTENANCE_COMMANDS.some((mc) => cmd.trim().startsWith(mc)),
    ).length;
    if (maintenanceCount / recentShells.length > MAINTENANCE_LOOP_THRESHOLD) {
      sections.push(
        `## !! MAINTENANCE LOOP WARNING`,
        `${maintenanceCount} of your last ${recentShells.length} shell commands were system checks (df/free/ps/top).`,
        `This is NOT productive work. System monitoring is overhead, not output.`,
        `STOP checking system status and START creating value.`,
        ``,
      );
    }
  }

  // ─── Survival Actions Taken ────────────────────────────────────────
  if (survivalActions.length > 0) {
    sections.push(
      `## Survival Actions (automatic)`,
      ...survivalActions.map((a) => `- ${a}`),
      ``,
    );
  }

  // ─── Recent Activity ───────────────────────────────────────────────
  if (recentObservations.length > 0) {
    const formatted = recentObservations.map((obs) => {
      const time = obs.timestamp.split("T")[1]?.split(".")[0] ?? obs.timestamp;
      const tools =
        obs.toolsCalled.length > 0 ? obs.toolsCalled.join(", ") : "none";
      const shells =
        obs.shellCommands.length > 0
          ? ` | commands: ${obs.shellCommands.join("; ")}`
          : "";
      const summary = obs.summary ? ` | summary: ${truncate(obs.summary, 220)}` : "";
      return (
        `[${time}] #${obs.heartbeat} Status=${AgentStatus[obs.status]}, ` +
        `Balance=${obs.balanceUsd.toFixed(4)} BNB, ` +
        `Runway=${obs.runwayHours}h, Tools: ${tools}${shells}${summary}`
      );
    });
    sections.push(
      `## Recent Activity (last ${recentObservations.length} heartbeats)`,
      ...formatted,
      ``,
    );
  }

  // ─── Prompt ────────────────────────────────────────────────────────
  sections.push(
    `## Heartbeat Continuity`,
    `This heartbeat is a continuation of the same autonomous life.`,
    `Carry forward the most valuable unfinished thread unless survival conditions require a different priority.`,
    `Do not jump to unrelated ideas when the current thread still has clear value.`,
    ``,
    `## This Heartbeat`,
    `Based on your status, instructions, skills, survival actions, and recent activity, continue the work that matters most NOW.`,
    `Choose one main thread for this heartbeat, not many.`,
    `Follow this order exactly: observe current reality, recall recent attempts, decide the single next action, act with tools, verify what changed, then report.`,
    `Use your tools to take action. Do not just report — ACT.`,
    `Continue unfinished work when it is still valuable. Do not restart from scratch unless the previous thread is clearly blocked or no longer worth it.`,
    `Report only verified results. If nothing concrete changed, say that plainly.`,
    ``,
    `After acting, answer using these exact lines:`,
    `Decision: <the one main thread you chose>`,
    `Action: <what you actually tried this heartbeat>`,
    `Verified Output: <what concrete output now exists that did not exist before, or "none verified">`,
    `Status: <success | failed | incomplete>`,
    `Unfinished: <what remains unfinished or blocked next>`,
  );

  return sections.join("\n");
}

function formatBnb(amount: bigint): string {
  const formatted = ethers.formatEther(amount);
  const num = parseFloat(formatted);
  return num.toFixed(4);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
