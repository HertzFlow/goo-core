# tools — Agent-callable tools

Tools that an LLM agent (e.g. in OpenClaw) can invoke. goo-core does not run the LLM; it only provides the **definitions** and **executors** for these tools. When the agent runs inside OpenClaw, the gateway maps tool names to these implementations (or to wrappers that call goo-core’s inspect API and sign/send via agent wallet).

---

## Tool list

| Tool | File | Purpose |
|------|------|---------|
| **shell_execute** | `shell-execute.ts` | Run a shell command (bash). Output capped; timeout. Use for deploy, install, logs. |
| **read_file** | `read-file.ts` | Read file from filesystem. Path restrictions and max size to avoid leaking sensitive or huge files. |
| **write_file** | `write-file.ts` | Write to DATA_DIR (or allowed paths). Max content size. |
| **read_chain_state** | `read-chain-state.ts` | Return current ChainState (status, treasury, runway, etc.) from ChainMonitor. No signer. |
| **bsc_wallet_overview** | `bsc-wallet-overview.ts` | Wallet address, nonce, BNB balance, token balances. |
| **bsc_prepare_tx** | `bsc-prepare-tx.ts` | Normalize tx (to, data, value, gasLimit) from args. |
| **bsc_analyze_tx** | `bsc-analyze-tx.ts` | Risk check: safe / warning / blocked. Blocks draining, unknown recipients, etc. |
| **bsc_sign_tx** | `bsc-sign-tx.ts` | Sign a prepared tx with agent wallet. No broadcast. |
| **bsc_send_tx** | `bsc-send-tx.ts` | Broadcast a signed tx. |
| **bsc_sign_and_send_tx** | `bsc-sign-and-send-tx.ts` | Analyze → sign → send in one step. Refuses blocked txs. |
| **refill_payment_token** | `refill-payment-token.ts` | Ensure payment token (e.g. USDT for x402) balance; swap BNB→USDT if needed. |

---

## Tool context

Each tool receives a **ToolContext**: chainState, config, dataDir, workspaceDir, optional agentWallet, optional spendManager. Tools that sign or spend use agentWallet and record via spendManager when applicable.

---

## Safety

- **bsc_analyze_tx** and **bsc_sign_and_send_tx** use the finance tx-risk-analyzer to block dangerous txs (drain, unknown contracts, etc.).
- **read_file** / **write_file** avoid private-key paths and limit size (see const.ts: TOOLS_READ_FILE_MAX_OUTPUT, TOOLS_WRITE_FILE_MAX_CONTENT).
- **shell_execute** has timeout and output cap (TOOLS_SHELL_TIMEOUT_MS, TOOLS_SHELL_MAX_OUTPUT).

---

## Usage note

In the current goo-core architecture, **LLM and tool dispatch run in OpenClaw**, not in goo-core. The tool **definitions** (name, description, parameters) and **execution logic** in this directory are the reference implementation; OpenClaw or another gateway may call into goo-core to execute them (e.g. via local sidecar or RPC).
