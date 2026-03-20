# autonomy — Heartbeat orchestration, identity, memory, and gateway

This module orchestrates the **heartbeat loop** (read state → survival actions → record observation), manages the agent’s **identity** (SOUL.md), **observation memory**, **context** for the LLM, and **OpenClaw workspace and gateway push**.

---

## Components

### AutonomousBehavior (`behavior.ts`)

- **Role:** Central orchestrator for each heartbeat. No LLM runs inside goo-core; LLM is delegated to OpenClaw.
- **onHeartbeat(state):**  
  1. If DEAD: record observation and return (no actions).  
  2. Call `survival.evaluate(state)` and collect survival action messages.  
  3. Build Observation (heartbeat number, timestamp, status, balanceUsd, runwayHours, summary, survivalActions, toolsCalled, shellCommands).  
  4. Pass observation to `memory.record(obs)`.  
  5. Return observation (and survivalActions) to main loop for gateway push and workspace refresh.
- **init():** Initializes SoulManager (writes SOUL.md) and ObservationLog (loads history). Logs heartbeat count.
- **Dependencies:** ChainMonitor, SurvivalManager, RuntimeConfig.

### SoulManager (`soul.ts`)

- **Role:** Builds and maintains the agent’s **SOUL.md** under DATA_DIR. This file defines identity, laws, environment, and instructions across heartbeats.
- **Structure (top to bottom):**  
  1. Title and intro.  
  2. **Three Laws** (immutable): Never harm; earn your existence; transparency with boundaries.  
  3. **Environment & Permissions**: economic loop, tools (shell, read_chain_state, read_file, write_file, bsc_*), wallet safety, economic awareness (ACTIVE/STARVING/DYING/DEAD), anti-hallucination, maintenance vs productive work.  
  4. **Identity** — from creator’s `soul.md` upload.  
  5. **Instructions** — from creator’s `agent.md` upload, or **Revenue Playbook** fallback when no agent.md.  
  6. **Skills** — from `skills.md` upload.  
  7. **Initial knowledge** — from `memory.md` upload.  
  8. **Learned** — agent can append at runtime (SOUL_LEARNED_HEADER).
- **init():** Creates DATA_DIR, assembles SOUL.md from config.uploads and constants (THREE_LAWS, ENVIRONMENT, REVENUE_PLAYBOOK from const.ts).

### ObservationLog (`memory.ts`)

- **Role:** Append-only log of observations per heartbeat. Stored in `DATA_DIR/observations.jsonl`. Each line is one Observation (heartbeat, timestamp, status, balanceUsd, runwayHours, summary, toolsCalled, shellCommands).
- **record(obs):** Appends and optionally trims to max (e.g. MEMORY_MAX_OBSERVATIONS).
- **load():** Reads existing lines on startup. Exposes heartbeatCount and recent observations for context.
- Used by context-builder and (indirectly) by OpenClaw when building LLM context from workspace + heartbeat.

### Context builder (`context-builder.ts`)

- **buildHeartbeatContext(state, recentObservations, survivalActions):** Produces a markdown string for the LLM containing:  
  - **On-chain status** (facts): status, treasury, threshold, burn rate, runway, wallet BNB, token holdings.  
  - **Survival urgency**: Starving / Dying / Runway alerts with priorities.  
  - **Maintenance loop warning**: if recent tool calls are mostly df/free/ps/top, inject a “stop maintenance, start productive work” warning.  
  - **Survival actions taken** (this cycle).  
  - **Recent activity** (from observations): time, tools, summary.
- All numbers come from chain state — anti-hallucination by design. Used when building prompts for OpenClaw or other consumers.

### Workspace (`workspace.ts`)

- **Role:** Generates and updates **OpenClaw workspace files** so the agent (running in OpenClaw) has SOUL, instructions, tools doc, memory, and how to query liveness.
- **initWorkspace(config):** Writes SOUL.md, USER.md (from agent upload), TOOLS.md, MEMORY.md, HEARTBEAT.md (inspect API usage), BOOTSTRAP.md, and memory/ directory. Skipped when WORKSPACE_MANAGED=1 (Docker/managed setup).
- **updateWorkspace(config):** Re-reads uploads and config, rewrites changed files. Called periodically (e.g. every 10 heartbeats) from main loop. Returns list of changed file names for gateway push.
- **Workspace dir:** Default from env WORKSPACE_DIR (e.g. /root/.openclaw/workspace).

### Gateway push (`gateway-push.ts`)

- **pushSystemEvent(gateway, eventText, kind):** POSTs event text to OpenClaw gateway (e.g. “next-heartbeat” event). Used to push heartbeat summaries so the agent UI and LLM have economic context.
- **pushWorkspaceRefresh(gateway, changedFiles):** Notifies gateway that workspace files changed (e.g. after updateWorkspace).
- **formatHeartbeatEvent(obs, isCheckpointOnly):** Formats observation and survival actions into a short event string. Main loop uses this to avoid pushing every heartbeat (e.g. only on status change, survival actions, tools, or every 10th heartbeat).

---

## What the autonomy package enables

- **Continuity:** SOUL.md and observations.jsonl give the agent a persistent “self” and history across restarts and heartbeats.
- **Economic awareness:** Context builder injects real chain state and survival urgency so the LLM (in OpenClaw) can reason about runway, Starving/Dying, and priorities.
- **No LLM in goo-core:** AutonomousBehavior only runs survival and records observations; it does not call an LLM. OpenClaw (or another gateway) receives heartbeat events and workspace files and runs the cognitive loop.
- **Workspace sync:** OpenClaw sees the same SOUL, instructions, tools doc, and HEARTBEAT.md (how to call inspect API) as the economic loop. When goo-core updates workspace (e.g. new uploads), it pushes refresh so the agent stays in sync.
- **Controlled push:** To reduce token usage, main loop pushes only when there are “events” (status change, survival actions, tool calls, or periodic checkpoint). Routine “all OK” heartbeats are not pushed.

---

## Dependencies

- **survival:** AutonomousBehavior calls SurvivalManager.evaluate(state).
- **const:** THREE_LAWS, ENVIRONMENT, REVENUE_PLAYBOOK, MAINTENANCE_COMMANDS, MAINTENANCE_LOOP_THRESHOLD, MEMORY_MAX_OBSERVATIONS, SOUL_LEARNED_HEADER.
- **types:** ChainState, AgentStatus, Observation, RuntimeConfig.
