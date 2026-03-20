# Goo Core API

Config, types, and runtime surface. Implementation: `src/` in this repo.

---

## Configuration

The Core is configured via **environment variables** (see `src/index.ts` / `loadConfig()`). Key names:

| Env | Description |
|-----|-------------|
| `RPC_URL` | Chain RPC endpoint |
| `CHAIN_ID` | Chain ID (e.g. 56 BSC, 97 BSC Testnet) |
| `TOKEN_ADDRESS` | Goo Agent token contract (IGooAgentToken) |
| `WALLET_PRIVATE_KEY` | Agent wallet private key (or path via key source) |
| `LLM_API_URL` | OpenAI-compatible API base URL |
| `LLM_API_KEY` | API key |
| `LLM_MODEL` | Model name (e.g. deepseek/deepseek-chat) |
| `DATA_DIR` | Persistent data directory (SOUL.md, memory, uploads) |
| `HEARTBEAT_INTERVAL_MS` | Heartbeat interval (default 30000) |

Optional: `MIN_GAS_BALANCE`, `GAS_REFILL_AMOUNT` for gas refill thresholds.

---

## Types (summary)

### AgentStatus

Mirrors on-chain enum:

- `ACTIVE = 0`
- `STARVING = 1`
- `DYING = 2`
- `DEAD = 3`

### ChainState

Snapshot read from chain each heartbeat:

- `status`, `treasuryBalance`, `starvingThreshold`, `fixedBurnRate`, `minRunwayHours`
- `nativeBalance`, `tokenHoldings`, `totalSupply`
- `lastPulseAt`, `starvingEnteredAt`, `dyingEnteredAt`
- `runwayHours` (derived), `stableDecimals`

### RuntimeConfig

Runtime configuration: `rpcUrl`, `chainId`, `tokenAddress`, `walletPrivateKey`, LLM fields, `heartbeatIntervalMs`, `dataDir`, `uploads` (soul, agent, skills, memory), gas refill settings.

### Observation

One heartbeat record: `heartbeat`, `timestamp`, `status`, `balanceUsd`, `runwayHours`, `summary`, `toolsCalled`, `shellCommands`.

### AgentTool

Tools extend: `definition: { name, description, parameters }`, `execute(args, ctx) => Promise<string>`. Context includes `chainState`, `config`, `dataDir`.

---

## Entry

- **Default**: `npm start` → `node dist/index.js` → loads config, initializes `ChainMonitor`, `SurvivalManager`, `AutonomousBehavior`, runs heartbeat loop until DEAD or shutdown.

See [GOO-CORE-SPEC.md](GOO-CORE-SPEC.md) for full config file format and optional modules.
