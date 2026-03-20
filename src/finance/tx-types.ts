export interface TxInput {
  to: string;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  chainId?: number;
  type?: number;
}

export interface PreparedTx extends TxInput {
  from: string;
  chainId: number;
  nonce: number;
  gasLimit: bigint;
}

export type TxRiskLevel = "safe" | "warning" | "blocked";

export interface TxRiskResult {
  riskLevel: TxRiskLevel;
  reasons: string[];
  selector?: string;
  decodedAction: string;
  assetSymbol?: string;
  estimatedValue?: string;
}
