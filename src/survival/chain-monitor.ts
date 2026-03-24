import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "../types.js";
import { TOKEN_ABI } from "../const.js";

export class ChainMonitor {
  private provider: ethers.JsonRpcProvider;
  private token: ethers.Contract;
  private agentWallet: string = "";

  constructor(private config: RuntimeConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.token = new ethers.Contract(
      config.tokenAddress,
      TOKEN_ABI,
      this.provider,
    );
  }

  /** One-time init: cache immutable values */
  async init(): Promise<void> {
    try {
      this.agentWallet = await this.token.agentWallet();
    } catch (err: any) {
      console.warn(
        `[ChainMonitor] agentWallet() call failed (${err.code || err.message}), will use signer address as fallback`,
      );
    }
  }

  /** Set wallet address externally (fallback when contract doesn't expose agentWallet) */
  setWalletAddress(address: string): void {
    if (!this.agentWallet && address) {
      this.agentWallet = address;
    }
  }

  /** Read full on-chain state snapshot */
  async readState(): Promise<ChainState> {
    const [
      statusRaw,
      treasuryBalance,
      starvingThreshold,
      dyingThreshold,
      lastPulseAt,
      starvingEnteredAt,
      dyingEnteredAt,
      totalSupply,
      tokenHoldings,
      nativeBalance,
      ownerAddress,
      isPaused,
    ] = await Promise.all([
      this.token.getAgentStatus() as Promise<bigint>,
      this.token.treasuryBalance() as Promise<bigint>,
      this.token.starvingThreshold() as Promise<bigint>,
      this.token.dyingThreshold() as Promise<bigint>,
      this.token.lastPulseAt() as Promise<bigint>,
      this.token.starvingEnteredAt() as Promise<bigint>,
      this.token.dyingEnteredAt() as Promise<bigint>,
      this.token.totalSupply() as Promise<bigint>,
      this.token.balanceOf(this.config.tokenAddress) as Promise<bigint>,
      (this.agentWallet
        ? this.provider.getBalance(this.agentWallet)
        : Promise.resolve(0n)) as Promise<bigint>,
      this.token.owner() as Promise<string>,
      this.token.paused() as Promise<boolean>,
    ]);

    const status = Number(statusRaw) as AgentStatus;

    return {
      status,
      treasuryBalance,
      starvingThreshold,
      dyingThreshold,
      nativeBalance,
      tokenHoldings,
      totalSupply,
      lastPulseAt,
      starvingEnteredAt,
      dyingEnteredAt,
      owner: ownerAddress,
      paused: isPaused,
    };
  }

  /** Format BNB balance for human display */
  formatBalance(amount: bigint): string {
    return ethers.formatEther(amount);
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
