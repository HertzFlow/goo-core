# goo-core Installation & Setup

How to install, configure, and run goo-core for a new or existing Goo Agent. Includes BYOD and testing.

---

## 1. Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** or **pnpm**
- **GooAgentToken** contract already deployed on BSC (Testnet 97 or Mainnet 56)
- **Agent wallet** private key (hex string, 0x optional) — the wallet that is allowed to call `emitPulse()` and `survivalSell()` on the token contract

---

## 2. Install from repo

```bash
cd packages/goo-core
npm install
npm run build
```

Or from a published package (if published):

```bash
npm install @devbond/gc   # or the package name under which goo-core is published
```

---

## 3. Configuration

Copy the example env and set required variables:

```bash
cp .env.example .env
```

**Required:**

| Variable | Description |
|----------|-------------|
| `RPC_URL` | JSON-RPC endpoint (e.g. `https://bsc-dataseed.binance.org` for testnet) |
| `CHAIN_ID` | `97` (BSC Testnet) or `56` (BSC Mainnet) |
| `TOKEN_ADDRESS` | GooAgentToken contract address |
| `AGENT_PRIVATE_KEY_FILE` | Path to file containing the agent wallet private key (one line, hex) |

**Optional (common):**

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/opt/data` | Persistent data directory (observations, SOUL.md, spend log) |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Milliseconds between heartbeats |
| `MIN_GAS_BALANCE` | `10000000000000000` (0.01 BNB) | Below this, gas refill is attempted |
| `GAS_REFILL_AMOUNT` | `10000000000000000` | Amount to withdraw from treasury for gas (wei) |
| `BUYBACK_ENABLED` | (unset) | Set `true` to enable buyback when ACTIVE and treasury healthy |
| `BUYBACK_THRESHOLD_MULTIPLIER` | `10` | Buyback when treasury > this × starvingThreshold |
| `X402_PAYMENT_TOKEN` | (unset) | USDT (or payment token) address for x402/LLM payments |
| `OPENCLAW_GATEWAY_URL` | (unset) | OpenClaw gateway URL for pushing heartbeat events |
| `OPENCLAW_GATEWAY_TOKEN` | (unset) | Token for gateway auth |
| `INSPECT_PORT` | `19791` | HTTP server for GET /liveness and GET /inspect |

See `.env.example` for the full list.

**Key file:** The agent private key file must contain a single line: the hex private key (with or without `0x`). Permissions should be restricted (e.g. `chmod 600`).

---

## 4. Run

```bash
npm start
# or
node dist/index.js
# or (dev, no build)
npm run dev
```

Process runs until:

- On-chain status becomes **DEAD**, or
- SIGINT/SIGTERM is received (graceful shutdown: save spend log, then exit)

---

## 5. New agent: end-to-end

1. **Deploy GooAgentToken** (e.g. via [goo-example](https://github.com/hyang74/goo-example) launch: prepare → user deploys with MetaMask → confirm). Record `TOKEN_ADDRESS` and the **agent wallet** private key (server may return it once for BYOD, or store it encrypted and run goo-core on the server).
2. **Create DATA_DIR** (e.g. `mkdir -p /opt/data`). Optionally place `soul.md`, `agent.md`, `skills.md`, `memory.md` in DATA_DIR for SOUL content.
3. **Write agent private key** to a file (e.g. `/opt/data/wallet/private-key`). Restrict permissions.
4. **Set .env** with `RPC_URL`, `CHAIN_ID`, `TOKEN_ADDRESS`, `AGENT_PRIVATE_KEY_FILE`, and optionally `DATA_DIR`, heartbeat, gas, buyback, OpenClaw, x402.
5. **Run goo-core** (`npm start` or via process manager / Docker). Ensure the agent wallet has BNB for gas (or use treasury withdraw if the contract supports `withdrawToWallet`).

---

## 6. Existing agent: attach goo-core

You already have a GooAgentToken and an agent wallet that is set as the token’s `agentWallet()`:

1. **Compatibility:** The contract must expose at least: `getAgentStatus()`, `treasuryBalance()`, `starvingThreshold()`, `fixedBurnRate()`, `minRunwayHours()`, `lastPulseAt()`, `emitPulse()`, `survivalSell(uint256,uint256)`. Optional: `withdrawToWallet(uint256)` for gas refill (V2).
2. **Key:** Use the same wallet the contract expects for `emitPulse` and `survivalSell`. Write its private key to a file and set `AGENT_PRIVATE_KEY_FILE`.
3. **Config:** Set `RPC_URL`, `CHAIN_ID`, `TOKEN_ADDRESS`, `AGENT_PRIVATE_KEY_FILE`, `DATA_DIR`. Then run goo-core as above.

If the contract does not support `withdrawToWallet`, goo-core will still run Pulse and SurvivalSell, but gas refill will be skipped (you must fund the agent wallet with BNB externally).

---

## 7. BYOD (Bring Your Own Device)

For self-hosted runtime (e.g. [goo-example deploy/byod](https://github.com/hyang74/goo-example/tree/main/deploy/byod)):

1. After launch confirm (BYOD mode), the server returns the agent private key once. Save it to a file on the machine where goo-core will run.
2. Create `.env` with the same variables; point `DATA_DIR` to a local path (e.g. `/var/lib/goo-agent/data`).
3. Run goo-core inside Docker or systemd. The BYOD compose typically runs OpenClaw + x402-proxy + goo-core in one container; goo-core uses the same key for Pulse, SurvivalSell, and x402 signing.

See the repo’s `deploy/byod/` for Docker and entrypoint examples.

---

## 8. Testing

```bash
npm run test           # all
npm run test:unit      # unit only
npm run test:integration
npm run test:e2e
npm run test:coverage
```

Unit tests use mocks. Integration/e2e may require env (e.g. `RPC_URL`, `TOKEN_ADDRESS`) or a local chain; see `test/` and `vitest.config.ts`.

---

## 9. Verification

After start:

- **Logs:** You should see token address, RPC, heartbeat interval, and “Starting heartbeat loop…”.
- **Liveness:** `curl http://localhost:19791/liveness` (or your INSPECT_PORT) should return JSON with `protocol: "goo"`, `status`, `lastPulseAt`, `treasuryBalanceUsd`, `runwayHours`.
- **Inspect:** `curl http://localhost:19791/inspect` returns full inspection (chain, survival, token, Three Laws).

If the contract is DEAD, goo-core will log “Goo Agent is Dead. Core stopping.” and exit.
