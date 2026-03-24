import { AgentStatus, type ChainState, type RuntimeConfig } from "../../src/types.js";

export const mockRuntimeConfig: RuntimeConfig = {
  rpcUrl: "https://bsc-dataseed.test.org",
  chainId: 97,
  tokenAddress: "0x111111111111111111111111111111111111111111",
  walletPrivateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
  llmModel: "test-model",

  heartbeatIntervalMs: 30000,
  dataDir: "/tmp/goo-core-test-data",

  uploads: {},
  minGasBalance: BigInt("10000000000000000"),
  gasRefillAmount: BigInt("50000000000000000"),
  minWalletBnb: 0.01,
};

export function makeChainState(overrides: Partial<ChainState> = {}): ChainState {
  return {
    status: AgentStatus.ACTIVE,
    treasuryBalance: BigInt("1500000000000000000"),
    starvingThreshold: BigInt("1000000000000000000"),
    dyingThreshold: BigInt("20000000000000000"), // 0.02 BNB
    nativeBalance: BigInt("50000000000000000000"),
    tokenHoldings: BigInt("1000000000000000000000"),
    totalSupply: BigInt("10000000000000000000000"),
    lastPulseAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
    starvingEnteredAt: 0n,
    dyingEnteredAt: 0n,
    owner: "0x0000000000000000000000000000000000000001",
    paused: false,
    ...overrides,
  };
}

export { AgentStatus };
