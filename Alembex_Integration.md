# ALEMBEX Algorithm Integration Guide

## Overview

The ALEMBEX module is a TypeScript implementation of Mustaapha Belkhayate's mathematical betting sequence algorithm. It calculates optimal bet sizes for trading strategies and tracks portfolio state across multiple trades.

## Features

- **Optimal Bet Sizing**: Automatically calculates bet sizes based on ALEMBEX rules
- **Drawdown Minimization**: Resets to base unit after losses to reduce exposure
- **Sequence Management**: Automatically closes sequences after two consecutive winning trades
- **State Tracking**: Maintains complete trade history and cumulative statistics
- **Easy Integration**: Pure TypeScript functions with no external dependencies

## Installation

### 1. Copy the File

Copy `AlembexHandlers.ts` to your project:

```bash
# Copy to your utilities/handlers folder
cp AlembexHandlers.ts src/handlers/
```

### 2. Import the Module

```typescript
import {
  initializeAlembex,
  miseAlembex,
  processTradeAlembex,
  getAlembexStats,
  resetAlembex,
  type AlembexState,
  type AlembexConfig,
  type TradeRecord,
} from './handlers/AlembexHandlers';
```

## Usage

### Basic Setup

```typescript
// 1. Initialize ALEMBEX state with starting capital
const config: AlembexConfig = {
  uniteBase: 100,        // Base unit for betting
  ratioGainPerte: 1,     // Gain/Loss ratio
};

let state = initializeAlembex(5000); // $5000 starting capital

// 2. Calculate next bet size
const nextBet = miseAlembex(state, config);
console.log(`Next bet size: $${nextBet}`);

// 3. Execute trade and get result (e.g., 'Gain' or 'Perte')
const tradeResult = 'Gain'; // or 'Perte'

// 4. Process the result and update state
state = processTradeAlembex(state, config, tradeResult);

// 5. Get current statistics
const stats = getAlembexStats(state);
console.log(stats);
```

### Complete Trading Loop Example

```typescript
import {
  initializeAlembex,
  miseAlembex,
  processTradeAlembex,
  getAlembexStats,
} from './handlers/AlembexHandlers';

const config = {
  uniteBase: 100,
  ratioGainPerte: 1,
};

let state = initializeAlembex(5000);

// Simulate trades
const trades = ['Gain', 'Perte', 'Perte', 'Gain', 'Gain'];

trades.forEach((result) => {
  // Calculate bet for this trade
  const mise = miseAlembex(state, config);
  
  console.log(`Trade ${state.historique.length + 1}: Betting $${mise}`);
  
  // Process result
  state = processTradeAlembex(state, config, result as 'Gain' | 'Perte');
  
  const lastTrade = state.historique[state.historique.length - 1];
  console.log(`Result: ${result} | P&L: $${lastTrade.pnl} | Cumul: $${lastTrade.cumulTotal}`);
});

// Get final statistics
const stats = getAlembexStats(state);
console.log('\n=== Final Statistics ===');
console.log(`Total Trades: ${stats.totalTrades}`);
console.log(`Win Rate: ${stats.winRate}%`);
console.log(`Final Capital: $${stats.finalCapital}`);
console.log(`Max Drawdown: $${stats.maxDrawdown}`);
console.log(`ROI: ${stats.roi}%`);
```

## API Reference

### Types

#### `AlembexConfig`
Configuration object for ALEMBEX calculation.

```typescript
interface AlembexConfig {
  uniteBase: number;      // Base betting unit
  ratioGainPerte: number; // Win/Loss ratio (typically 1)
}
```

#### `AlembexState`
Current state of the ALEMBEX system.

```typescript
interface AlembexState {
  historique: TradeRecord[];          // Complete trade history
  cumulSeq: number;                   // Cumulative P&L for current sequence
  cumulTotal: number;                 // Total cumulative P&L
  seqNum: number;                     // Current sequence number
  lastWasTwoConsecutiveGains: boolean; // Whether sequence just closed
  capitalDepart: number;              // Initial capital
}
```

#### `TradeRecord`
Individual trade record.

```typescript
interface TradeRecord {
  tradeNum: number;       // Trade number
  seqNum: number;         // Sequence number
  mise: number;           // Bet size
  result: 'Gain' | 'Perte'; // Trade result
  pnl: number;            // Profit/Loss amount
  cumulSeq: number;       // Cumulative in sequence
  cumulTotal: number;     // Total cumulative
}
```

### Functions

#### `initializeAlembex(capitalDepart: number): AlembexState`
Initialize ALEMBEX state with starting capital.

```typescript
const state = initializeAlembex(5000);
```

#### `miseAlembex(state: AlembexState, config: AlembexConfig): number`
Calculate the optimal bet size for the next trade.

**Rules:**
- New sequence: `mise = uniteBase`
- After a win: `mise = |cumul(n-2)| + uniteBase`
- After a loss: `mise = uniteBase` (reset to minimize drawdown)

```typescript
const nextBet = miseAlembex(state, config);
```

#### `processTradeAlembex(state: AlembexState, config: AlembexConfig, tradeResult: 'Gain' | 'Perte'): AlembexState`
Process a trade result and return updated state.

```typescript
state = processTradeAlembex(state, config, 'Gain');
```

#### `getAlembexStats(state: AlembexState): object`
Get comprehensive trading statistics.

Returns object with:
- `totalTrades`: Total number of trades executed
- `winningTrades`: Number of winning trades
- `losingTrades`: Number of losing trades
- `winRate`: Win rate percentage
- `finalCapital`: Final account balance
- `totalGain`: Total P&L in dollars
- `maxDrawdown`: Maximum drawdown experienced
- `roi`: Return on investment percentage

```typescript
const stats = getAlembexStats(state);
console.log(`Win Rate: ${stats.winRate}%`);
```

#### `resetAlembex(capitalDepart: number): AlembexState`
Reset state to initial conditions.

```typescript
state = resetAlembex(5000);
```

## ALEMBEX Algorithm Details

### Sequence Rules

1. **Sequence Closure**: A sequence closes after **two consecutive winning trades**
2. **Base Unit**: Each new sequence starts with a bet equal to `uniteBase`
3. **Recovery Bets**: After a loss, reset to base unit (minimize risk)
4. **Win Bets**: After a win, increase bet to compensate for previous losses

### Bet Calculation Logic

```
IF (cumulative == 0 OR sequence just closed)
    mise = uniteBase
ELSE IF (last trade was a win)
    mise = |cumul(previous trade)| + uniteBase
ELSE IF (last trade was a loss)
    mise = uniteBase  // Reset to minimize drawdown
```

### Example Sequence

| Trade | Mise | Result | P&L | Cumul Seq | Notes |
|-------|------|--------|-----|-----------|-------|
| 1 | $1 | Loss | -$1 | -$1 | Start new sequence |
| 2 | $1 | Loss | -$1 | -$2 | Continue, reset bet |
| 3 | $1 | Win | +$1 | -$1 | After loss, reset |
| 4 | $2 | Loss | -$2 | -$3 | After win: \|(-1)\| + 1 |
| 5 | $1 | Win | +$1 | -$2 | After loss, reset |
| 6 | $3 | Win | +$3 | +$1 | After win: \|(-2)\| + 1 |
| 7 | $1 | - | - | - | **Sequence Closed** (2 wins) |

## Integration with Your Trading Bot

### Example with Real Broker API

```typescript
import { binance } from 'ccxt';
import {
  initializeAlembex,
  miseAlembex,
  processTradeAlembex,
} from './handlers/AlembexHandlers';

const exchange = new binance();
let alembexState = initializeAlembex(10000);
const config = { uniteBase: 100, ratioGainPerte: 1 };

async function executeTrade(symbol: string, direction: 'buy' | 'sell') {
  // Calculate ALEMBEX bet
  const betSize = miseAlembex(alembexState, config);
  
  try {
    // Execute trade with calculated bet size
    const order = await exchange.createOrder(symbol, 'market', direction, betSize);
    
    // Determine if trade was profitable (simplified)
    const wasWinning = order.average > order.info.executedQty; // Example logic
    const result = wasWinning ? 'Gain' : 'Perte';
    
    // Update ALEMBEX state
    alembexState = processTradeAlembex(alembexState, config, result);
    
    console.log(`Order executed. Next bet: $${miseAlembex(alembexState, config)}`);
  } catch (error) {
    console.error('Trade failed:', error);
  }
}
```

## Performance Considerations

- **Zero Dependencies**: Pure TypeScript, no external libraries
- **O(1) Operations**: Bet calculation runs in constant time
- **O(n) Stats**: Statistics calculation is linear with trade count
- **Memory Efficient**: Minimal state storage

## Best Practices

1. **Always Initialize**: Call `initializeAlembex()` before starting trading
2. **Validate Inputs**: Ensure `uniteBase` and `capitalDepart` are positive
3. **Update State**: Always assign the result of `processTradeAlembex()` back to state
4. **Monitor Stats**: Check `getAlembexStats()` regularly to track performance
5. **Error Handling**: Wrap trade processing in try-catch blocks

## Disclaimer

ALEMBEX is a mathematical betting sequence algorithm. Past performance does not guarantee future results. Use with proper risk management and never bet more than you can afford to lose.

## License

This implementation is provided as-is for educational and integration purposes.