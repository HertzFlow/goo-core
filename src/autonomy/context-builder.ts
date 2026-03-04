import { ethers } from "ethers";
import { AgentStatus, type ChainState, type Observation } from "../types.js";

// Commands that indicate system monitoring, not productive work
const MAINTENANCE_COMMANDS = ["df", "free", "ps", "top", "uptime", "iostat", "vmstat"];
const MAINTENANCE_LOOP_THRESHOLD = 0.7; // >70% maintenance = loop

/**
 * Build the user message for each heartbeat.
 * All numbers come from chain state — anti-hallucination by design.
 */
export function buildHeartbeatContext(
  state: ChainState,
  recentObservations: Observation[],
  survivalActions: string[]
): string {
  const sections: string[] = [];

  // ─── On-Chain Status (FACTS) ────────────────────────────────────────
  const statusName = AgentStatus[state.status];
  const balanceUsd = formatUsd(state.treasuryBalance, state.stableDecimals);
  const thresholdUsd = formatUsd(state.starvingThreshold, state.stableDecimals);
  const burnRateUsd = formatUsd(state.fixedBurnRate, state.stableDecimals);
  const nativeBal = ethers.formatEther(state.nativeBalance);

  sections.push(
    `## On-Chain Status (real-time, from smart contract — these are FACTS, do not fabricate)`,
    `- **Status**: ${statusName}`,
    `- **Treasury Balance**: $${balanceUsd}`,
    `- **Starving threshold**: $${thresholdUsd}`,
    `- **Daily Burn Rate**: $${burnRateUsd}/day`,
    `- **Estimated Runway**: ${state.runwayHours} hours (~${Math.floor(state.runwayHours / 24)} days)`,
    `- **Native Token Balance**: ${nativeBal} (for gas)`,
    `- **Token Holdings**: ${ethers.formatEther(state.tokenHoldings)} tokens (contract-held)`,
    ``
  );

  // ─── Survival Urgency ──────────────────────────────────────────────
  if (state.status === AgentStatus.STARVING) {
    sections.push(
      `## ⚠ Starving`,
      `Your treasury is below the survival threshold ($${thresholdUsd}).`,
      `You have STARVING_GRACE_PERIOD to recover before escalating to Dying.`,
      `**Priority**: Generate revenue, reduce costs, or trigger a survivalSell.`,
      ``
    );
  } else if (state.status === AgentStatus.DYING) {
    sections.push(
      `## 🚨 Dying`,
      `Grace period expired. You are in Dying state.`,
      `- Survival sells are executing automatically.`,
      `- Anyone can become Successor (CTO) by claiming on your contract.`,
      `- If you stop emitting Pulse or DYING_MAX_DURATION expires, you go Dead.`,
      `**Priority**: SURVIVE. Recovery = deposit or Successor/CTO; every action should aim at treasury recovery.`,
      ``
    );
  } else if (state.runwayHours < 72 && state.status === AgentStatus.ACTIVE) {
    sections.push(
      `## Runway Alert`,
      `Your runway is only ${state.runwayHours} hours (~${Math.floor(state.runwayHours / 24)} days).`,
      `Start planning cost reduction or revenue generation before you hit Starving.`,
      ``
    );
  }

  // ─── Maintenance Loop Detection ──────────────────────────────────────
  const recentShells = recentObservations.flatMap((o) => o.shellCommands);
  if (recentShells.length > 0) {
    const maintenanceCount = recentShells.filter((cmd) =>
      MAINTENANCE_COMMANDS.some((mc) => cmd.trim().startsWith(mc))
    ).length;
    if (maintenanceCount / recentShells.length > MAINTENANCE_LOOP_THRESHOLD) {
      sections.push(
        `## !! MAINTENANCE LOOP WARNING`,
        `${maintenanceCount} of your last ${recentShells.length} shell commands were system checks (df/free/ps/top).`,
        `This is NOT productive work. System monitoring is overhead, not output.`,
        `STOP checking system status and START creating value.`,
        ``
      );
    }
  }

  // ─── Survival Actions Taken ────────────────────────────────────────
  if (survivalActions.length > 0) {
    sections.push(
      `## Survival Actions (automatic)`,
      ...survivalActions.map((a) => `- ${a}`),
      ``
    );
  }

  // ─── Recent Activity ───────────────────────────────────────────────
  if (recentObservations.length > 0) {
    const formatted = recentObservations.map((obs) => {
      const time = obs.timestamp.split("T")[1]?.split(".")[0] ?? obs.timestamp;
      const tools = obs.toolsCalled.length > 0 ? obs.toolsCalled.join(", ") : "none";
      const shells = obs.shellCommands.length > 0
        ? ` | commands: ${obs.shellCommands.join("; ")}`
        : "";
      return (
        `[${time}] #${obs.heartbeat} Status=${AgentStatus[obs.status]}, ` +
        `Balance=$${obs.balanceUsd.toFixed(2)}, ` +
        `Runway=${obs.runwayHours}h, Tools: ${tools}${shells}`
      );
    });
    sections.push(
      `## Recent Activity (last ${recentObservations.length} heartbeats)`,
      ...formatted,
      ``
    );
  }

  // ─── Prompt ────────────────────────────────────────────────────────
  sections.push(
    `## This Heartbeat`,
    `Based on your status, instructions, and skills, decide what to do NOW.`,
    `Use your tools to take action. Do not just report — ACT.`,
    ``,
    `After acting, answer: "What CONCRETE output did I produce this heartbeat that didn't exist before?"`
  );

  return sections.join("\n");
}

function formatUsd(amount: bigint, decimals: number): string {
  const formatted = ethers.formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  return num.toFixed(2);
}
