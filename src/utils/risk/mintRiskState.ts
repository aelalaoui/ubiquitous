import { TradeEvent } from "../decoders/pumpTradeEvent";

interface TradeSample {
    trader: string;
    side: "buy" | "sell";
    progress: number;
    timestamp: number; // ms epoch
}

export interface MintRiskState {
    mint: string;
    firstSeen: number;
    lastSeen: number;
    prevProgress: number;
    maxProgress: number;             // peak progress observed for this mint
    curveDrawdown: number;           // current drawdown = maxProgress - current, reset as peak rises
    lastRealSol: number;
    lastRealTok: number;
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    curveRegression: boolean;        // latched: triggered when drawdown exceeds threshold
    trades: TradeSample[];            // ring buffer, newest last
    dev: string | null;
    devLookupState: "unstarted" | "pending" | "resolved" | "failed";
    topHolderPct: number | null;
    topHolderAt: number | null;
    devBalanceTok: number | null;
    devHoldsPct: number | null;
    devMetricsAt: number | null;
    refreshedAt98: boolean;           // whether the 98% re-check has been triggered
    lastEmittedVerdict: string | null;
    lastEmittedReason: string | null;
    name: string | null;
    symbol: string | null;
}

const RING_BUFFER_SIZE = 64;
const states = new Map<string, MintRiskState>();

export function getState(mint: string): MintRiskState | undefined {
    return states.get(mint);
}

export function getOrCreateState(mint: string, nowMs: number): MintRiskState {
    let s = states.get(mint);
    if (s) return s;
    s = {
        mint,
        firstSeen: nowMs,
        lastSeen: nowMs,
        prevProgress: 0,
        maxProgress: 0,
        curveDrawdown: 0,
        lastRealSol: 0,
        lastRealTok: 0,
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        curveRegression: false,
        trades: [],
        dev: null,
        devLookupState: "unstarted",
        topHolderPct: null,
        topHolderAt: null,
        devBalanceTok: null,
        devHoldsPct: null,
        devMetricsAt: null,
        refreshedAt98: false,
        lastEmittedVerdict: null,
        lastEmittedReason: null,
        name: null,
        symbol: null,
    };
    states.set(mint, s);
    return s;
}

export interface RegressionThreshold {
    /** % drop from peak (e.g. 1.5 → fire when peak - current >= 1.5 percentage points). */
    dropPct: number;
}

export function recordTrade(
    state: MintRiskState,
    ev: TradeEvent,
    nowMs: number,
    regressionThreshold: RegressionThreshold = { dropPct: 1.5 },
): void {
    // Track peak progress and current drawdown from it. A drawdown above threshold
    // flags the mint as actively dumping — much less noisy than "any sell".
    if (ev.progress > state.maxProgress) {
        state.maxProgress = ev.progress;
    }
    state.curveDrawdown = Math.max(0, state.maxProgress - ev.progress);
    if (state.tradeCount > 0 && state.curveDrawdown >= regressionThreshold.dropPct) {
        state.curveRegression = true;
    }

    state.lastSeen = nowMs;
    state.prevProgress = ev.progress;
    state.lastRealSol = ev.realSol;
    state.lastRealTok = ev.realTok;
    state.tradeCount += 1;
    if (ev.isBuy) state.buyCount += 1;
    else state.sellCount += 1;

    state.trades.push({
        trader: ev.user,
        side: ev.isBuy ? "buy" : "sell",
        progress: ev.progress,
        timestamp: nowMs,
    });
    if (state.trades.length > RING_BUFFER_SIZE) {
        state.trades.shift();
    }
}

/**
 * Fraction of buys in the ring buffer concentrated in the top-5 unique buyer wallets.
 * Returns 0 when fewer than `minBuys` buys have been observed (not enough signal yet).
 */
export function computeBotConcentration(state: MintRiskState, minBuys: number = 5): number {
    const buys = state.trades.filter(t => t.side === "buy");
    if (buys.length < minBuys) return 0;

    const counts = new Map<string, number>();
    for (const t of buys) {
        counts.set(t.trader, (counts.get(t.trader) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const top5 = sorted.slice(0, 5).reduce((sum, n) => sum + n, 0);
    return (top5 / buys.length) * 100;
}

/**
 * Count distinct trader pubkeys among the last `n` buys in the ring buffer.
 */
export function countUniqueBuyersLast(state: MintRiskState, n: number): number {
    const buys = state.trades.filter(t => t.side === "buy");
    const slice = buys.slice(-n);
    const unique = new Set<string>();
    for (const t of slice) unique.add(t.trader);
    return unique.size;
}

/**
 * Remove a mint's state from memory (e.g. after migration + verdict persisted).
 */
export function evictState(mint: string): void {
    states.delete(mint);
}

export function clearAllState(): number {
    const n = states.size;
    states.clear();
    return n;
}

export function stateCount(): number {
    return states.size;
}
