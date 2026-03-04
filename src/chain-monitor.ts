import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "./types.js";

// Minimal ABI — only the view functions we need from GooAgentToken
const TOKEN_ABI = [
  "function getAgentStatus() view returns (uint8)",
  "function treasuryBalance() view returns (uint256)",
  "function starvingThreshold() view returns (uint256)",
  "function fixedBurnRate() view returns (uint256)",
  "function minRunwayHours() view returns (uint256)",
  "function lastPulseAt() view returns (uint256)",
  "function starvingEnteredAt() view returns (uint256)",
  "function dyingEnteredAt() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function stableDecimals() view returns (uint8)",
  "function stableToken() view returns (address)",
  "function agentWallet() view returns (address)",
  "function WRAPPED_NATIVE() view returns (address)",
  "function ROUTER() view returns (address)",
  "function MAX_SELL_BPS_VALUE() view returns (uint256)",
  "function SURVIVAL_SELL_COOLDOWN_SECS() view returns (uint256)",
  "function PULSE_TIMEOUT_SECS() view returns (uint256)",
  "function STARVING_GRACE_PERIOD_SECS() view returns (uint256)",
  "function DYING_MAX_DURATION_SECS() view returns (uint256)",
];

export class ChainMonitor {
  private provider: ethers.JsonRpcProvider;
  private token: ethers.Contract;
  private agentWallet: string = "";
  private stableDecimals: number = 18;

  constructor(private config: RuntimeConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.token = new ethers.Contract(
      config.tokenAddress,
      TOKEN_ABI,
      this.provider
    );
  }

  /** One-time init: cache immutable values */
  async init(): Promise<void> {
    this.agentWallet = await this.token.agentWallet();
    this.stableDecimals = Number(await this.token.stableDecimals());
  }

  /** Read full on-chain state snapshot */
  async readState(): Promise<ChainState> {
    // Batch all reads in parallel
    const [
      statusRaw,
      treasuryBalance,
      starvingThreshold,
      fixedBurnRate,
      minRunwayHours,
      lastPulseAt,
      starvingEnteredAt,
      dyingEnteredAt,
      totalSupply,
      tokenHoldings,
      nativeBalance,
    ] = await Promise.all([
      this.token.getAgentStatus(),
      this.token.treasuryBalance(),
      this.token.starvingThreshold(),
      this.token.fixedBurnRate(),
      this.token.minRunwayHours(),
      this.token.lastPulseAt(),
      this.token.starvingEnteredAt(),
      this.token.dyingEnteredAt(),
      this.token.totalSupply(),
      this.token.balanceOf(this.config.tokenAddress),
      this.provider.getBalance(this.agentWallet),
    ]);

    const status = Number(statusRaw) as AgentStatus;

    // Calculate runway: treasuryBalance / (fixedBurnRate / 24)
    // fixedBurnRate is per day, so hourly = fixedBurnRate / 24
    let runwayHours = 0;
    if (fixedBurnRate > 0n) {
      const hourlyBurn = fixedBurnRate / 24n;
      if (hourlyBurn > 0n) {
        runwayHours = Number(treasuryBalance / hourlyBurn);
      }
    }

    return {
      status,
      treasuryBalance,
      starvingThreshold,
      fixedBurnRate,
      minRunwayHours,
      nativeBalance,
      tokenHoldings,
      totalSupply,
      lastPulseAt,
      starvingEnteredAt,
      dyingEnteredAt,
      runwayHours,
      stableDecimals: this.stableDecimals,
    };
  }

  /** Format balance for human display */
  formatStable(amount: bigint): string {
    return ethers.formatUnits(amount, this.stableDecimals);
  }

  /** Format native token for human display */
  formatNative(amount: bigint): string {
    return ethers.formatEther(amount);
  }

  get walletAddress(): string {
    return this.agentWallet;
  }

  get tokenContract(): ethers.Contract {
    return this.token;
  }

  get rpcProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }
}
