import { ethers } from "ethers";
import { analyzeTransactionRisk } from "./tx-risk-analyzer.js";
import type { PreparedTx, TxInput, TxRiskResult } from "./tx-types.js";

// ─── ABIs ───────────────────────────────────────────────────────────────

const TOKEN_WALLET_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ─── AgentWallet ────────────────────────────────────────────────────────

export class AgentWallet {
  private signer_: ethers.Signer;
  private provider: ethers.JsonRpcProvider;
  private tokenAddress: string;
  private paymentTokenAddress?: string;
  private minWalletBnb_: number;
  private _address: string = "";
  private tokenMetadataCache: Map<string, { symbol: string; decimals: number }> = new Map();

  // Contracts (initialized in init())
  private tokenContract!: ethers.Contract;
  private paymentTokenContract?: ethers.Contract;

  constructor(
    signer: ethers.Signer,
    tokenAddress: string,
    provider: ethers.JsonRpcProvider,
    paymentTokenAddress?: string,
    minWalletBnb: number = 0.01,
  ) {
    this.signer_ = signer;
    this.provider = provider;
    this.tokenAddress = tokenAddress;
    this.paymentTokenAddress = paymentTokenAddress;
    this.minWalletBnb_ = minWalletBnb;
  }

  /** Create from private key (backward compatibility). */
  static fromPrivateKey(
    privateKey: string,
    tokenAddress: string,
    provider: ethers.JsonRpcProvider,
    paymentToken?: string,
    minWalletBnb?: number,
  ): AgentWallet {
    return new AgentWallet(
      new ethers.Wallet(privateKey, provider),
      tokenAddress,
      provider,
      paymentToken,
      minWalletBnb,
    );
  }

  /** One-time init: resolve address and set up contracts */
  async init(): Promise<void> {
    this._address = await this.signer_.getAddress();

    this.tokenContract = new ethers.Contract(
      this.tokenAddress,
      TOKEN_WALLET_ABI,
      this.signer_,
    );

    if (this.paymentTokenAddress) {
      this.paymentTokenContract = new ethers.Contract(
        this.paymentTokenAddress,
        ERC20_ABI,
        this.signer_,
      );
      console.log(
        `[wallet] Initialized: addr=${this._address} paymentToken=${this.paymentTokenAddress}`,
      );
    } else {
      console.log(
        `[wallet] Initialized: addr=${this._address} (no payment token)`,
      );
    }
  }

  // ─── Balance queries ────────────────────────────────────────────────

  async getNativeBalance(): Promise<bigint> {
    return this.provider.getBalance(this._address);
  }

  async getNonce(): Promise<number> {
    return this.provider.getTransactionCount(this._address, "pending");
  }

  async getTokenBalance(): Promise<bigint> {
    return this.tokenContract.balanceOf(this._address);
  }

  /** Get x402 payment token (USDT) balance. Returns 0 if not configured. */
  async getPaymentTokenBalance(): Promise<bigint> {
    if (!this.paymentTokenContract) return 0n;
    return this.paymentTokenContract.balanceOf(this._address);
  }

  /** Get current Permit2 allowance for payment token. Returns 0 if not configured. */
  async getPaymentTokenAllowance(spender: string): Promise<bigint> {
    if (!this.paymentTokenContract) return 0n;
    return this.paymentTokenContract.allowance(this._address, spender);
  }

  async getTokenBalanceFor(tokenAddress: string): Promise<bigint> {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return token.balanceOf(this._address);
  }

  async getTokenAllowanceFor(tokenAddress: string, spender: string): Promise<bigint> {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return token.allowance(this._address, spender);
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const cached = this.tokenMetadataCache.get(tokenAddress.toLowerCase());
    if (cached) return cached.decimals;
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
    this.tokenMetadataCache.set(tokenAddress.toLowerCase(), { symbol, decimals });
    return decimals;
  }

  async getTokenSymbol(tokenAddress: string): Promise<string> {
    const cached = this.tokenMetadataCache.get(tokenAddress.toLowerCase());
    if (cached) return cached.symbol;
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
    this.tokenMetadataCache.set(tokenAddress.toLowerCase(), { symbol, decimals });
    return symbol;
  }

  async prepareTransaction(input: TxInput): Promise<PreparedTx> {
    const from = await this.signer_.getAddress();
    const tx: TxInput = {
      ...input,
      to: ethers.getAddress(input.to),
      chainId: input.chainId ?? Number((await this.provider.getNetwork()).chainId),
      nonce: input.nonce ?? (await this.getNonce()),
      data: input.data ?? "0x",
    };

    if (!tx.gasLimit) {
      tx.gasLimit = await this.provider.estimateGas({
        from,
        to: tx.to,
        value: tx.value ?? 0n,
        data: tx.data,
      });
    }

    if (tx.type == null) {
      tx.type = tx.maxFeePerGas != null || tx.maxPriorityFeePerGas != null ? 2 : 0;
    }

    if (tx.gasPrice == null && tx.maxFeePerGas == null && tx.maxPriorityFeePerGas == null) {
      const feeData = await this.provider.getFeeData();
      if (tx.type === 2 && feeData.maxFeePerGas != null) {
        tx.maxFeePerGas = feeData.maxFeePerGas;
        tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei");
      } else {
        tx.gasPrice = feeData.gasPrice ?? ethers.parseUnits("3", "gwei");
      }
    }

    return {
      ...tx,
      from,
      chainId: tx.chainId!,
      nonce: tx.nonce!,
      gasLimit: tx.gasLimit!,
    };
  }

  async signTransaction(input: TxInput): Promise<{ preparedTx: PreparedTx; signedTransaction: string }> {
    const preparedTx = await this.prepareTransaction(input);
    const signedTransaction = await this.signer_.signTransaction(preparedTx);
    return { preparedTx, signedTransaction };
  }

  async broadcastSignedTransaction(rawTx: string): Promise<string> {
    const response = await this.provider.broadcastTransaction(rawTx);
    return response.hash;
  }

  async signAndSendTransaction(input: TxInput): Promise<{ preparedTx: PreparedTx; signedTransaction: string; txHash: string }> {
    const { preparedTx, signedTransaction } = await this.signTransaction(input);
    const txHash = await this.broadcastSignedTransaction(signedTransaction);
    return { preparedTx, signedTransaction, txHash };
  }

  async analyzeTransaction(input: TxInput): Promise<TxRiskResult> {
    return analyzeTransactionRisk(this, input);
  }

  /** Approve spender (Permit2) to spend payment token. */
  async approvePaymentToken(spender: string, amount: bigint): Promise<string> {
    if (!this.paymentTokenContract) throw new Error("No payment token configured");
    const tx = await this.paymentTokenContract.approve(spender, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Accessors ──────────────────────────────────────────────────────

  get signer(): ethers.Signer {
    return this.signer_;
  }

  get address(): string {
    return this._address;
  }

  get rpcProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  get tokenAddr(): string {
    return this.tokenAddress;
  }

  get paymentTokenAddr(): string | undefined {
    return this.paymentTokenAddress;
  }

  get hasPaymentToken(): boolean {
    return !!this.paymentTokenAddress;
  }

  get minWalletBnb(): number {
    return this.minWalletBnb_;
  }
}
