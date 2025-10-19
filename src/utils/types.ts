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

// Token holder type
export interface TokenHolder {
  address: string;
  pct: number;
  insider: boolean;
}

// Market type
export interface Market {
  liquidityA?: string;
  liquidityB?: string;
  liquidity?: number;
}

// Extended rug response with all necessary fields
export interface RugResponseExtended {
  score: number;
  risks: RiskItem[];
  rugged: boolean;
  creator?: string;
  token: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    isInitialized: boolean;
  };
  tokenMeta: {
    name: string;
    symbol: string;
    mutable: boolean;
  };
  topHolders: TokenHolder[];
  markets?: Market[];
  totalLPProviders: number;
}

// New token record type for tracking
export interface NewTokenRecord {
  time: number;
  mint: string;
  name: string;
  creator: string;
}
