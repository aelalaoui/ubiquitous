// WebSocket request types
export interface WebSocketRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: any[];
}

// Transaction details types
export interface DisplayDataItem {
  tokenMint: string;
  solMint: string;
}

export interface TransactionInstruction {
  programId: string;
  accounts: string[];
}

export interface TransactionDetailsResponseArray extends Array<{
  instructions: TransactionInstruction[];
}> {}

// Jupiter API types
export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: any;
  priceImpactPct: string;
  routePlan: any[];
}

export interface SerializedQuoteResponse {
  swapTransaction: string;
}

// Rug check types
export interface RiskItem {
  name: string;
  description: string;
  level: string;
  value: string;
}

export interface RugResponse {
  score: number;
  risks: RiskItem[];
}
