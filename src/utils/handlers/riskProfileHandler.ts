import { config } from "../../config";
import { TradeEvent } from "../decoders/pumpTradeEvent";
import {
    MintRiskState,
    computeBotConcentration,
    countUniqueBuyersLast,
    getOrCreateState,
    recordTrade,
} from "../risk/mintRiskState";
import {
    initRiskDb,
    setDev,
    setDevMetrics,
    setMetadata,
    setTopHolder,
    setVerdict,
    upsertRisk,
    Verdict,
} from "../../tracker/riskDb";
import { getTopHolderPct } from "./tokenHandler";
import { getDevMetrics } from "./devWalletHandler";
import { getTokenMetadata } from "./tokenMetadataHandler";
import { getCreation as lookupCreationFromStore, getDev as lookupDevFromStore } from "../risk/devWalletStore";
import { emitMetadata, emitTrade, emitVerdict } from "../../dashboard/events";

// Bounded concurrency for outbound RPC calls kicked off by the risk handler.
const rpcConcurrency = config.pump_risk?.rpc_concurrency ?? 4;
let rpcInFlight = 0;
const rpcQueue: Array<() => void> = [];

function acquireRpcSlot(): Promise<void> {
    return new Promise(resolve => {
        if (rpcInFlight < rpcConcurrency) {
            rpcInFlight++;
            resolve();
        } else {
            rpcQueue.push(() => {
                rpcInFlight++;
                resolve();
            });
        }
    });
}

function releaseRpcSlot(): void {
    rpcInFlight--;
    const next = rpcQueue.shift();
    if (next) next();
}

async function withRpcSlot<T>(fn: () => Promise<T>): Promise<T> {
    await acquireRpcSlot();
    try { return await fn(); } finally { releaseRpcSlot(); }
}

let dbInitialized = false;
async function ensureDb(): Promise<void> {
    if (dbInitialized) return;
    await initRiskDb();
    dbInitialized = true;
}

/**
 * Called for every decoded pump.fun TradeEvent. Gates on progress ≥ min_track_progress,
 * updates the in-memory state + persisted token_risk row, triggers one-shot dev+top-holder
 * lookups on first entry, refreshes them at refresh_at_progress, and recomputes the verdict.
 */
export async function onTradeEvent(ev: TradeEvent): Promise<void> {
    if (!config.pump_risk?.enabled) return;

    const minProgress = config.pump_risk.min_track_progress;
    if (ev.progress < minProgress) return;

    const now = Date.now();
    const state = getOrCreateState(ev.mint, now);
    const firstTrade = state.tradeCount === 0;

    // Hydrate the live name/symbol from the CreateEvent store as early as possible so
    // the very first emitTrade already carries the label. Zero RPC, zero latency.
    if (!state.name || !state.symbol) {
        const creation = lookupCreationFromStore(ev.mint);
        if (creation) {
            state.name = creation.name || state.name;
            state.symbol = creation.symbol || state.symbol;
        }
    }

    // Record the trade in memory (updates counters, ring buffer, regression flag).
    recordTrade(state, ev, now, {
        dropPct: config.pump_risk.thresholds.curve_regression_drop_pct ?? 1.5,
    });

    const minBuys = config.pump_risk.thresholds.min_buys_for_concentration ?? 5;
    const uniqueBuyers10 = countUniqueBuyersLast(state, 10);
    const botConcentration = computeBotConcentration(state, minBuys);

    try {
        await ensureDb();
        await upsertRisk({
            mint: ev.mint,
            last_seen: now,
            progress: ev.progress,
            last_real_sol: ev.realSol,
            last_real_tok: ev.realTok,
            trade_count: state.tradeCount,
            buy_count: state.buyCount,
            sell_count: state.sellCount,
            unique_buyers_10: uniqueBuyers10,
            bot_concentration: botConcentration,
            curve_regression: state.curveRegression ? 1 : 0,
        });
    } catch (err) {
        console.error(`[riskProfileHandler] upsertRisk failed for ${ev.mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
        return;
    }

    // Push the trade to any connected dashboard clients. Include name/symbol when
    // known so the row can show the token label as soon as metadata resolves.
    emitTrade({
        mint: ev.mint,
        progress: ev.progress,
        isBuy: ev.isBuy,
        realSol: ev.realSol,
        realTok: ev.realTok,
        tradeCount: state.tradeCount,
        timestamp: now,
        name: state.name,
        symbol: state.symbol,
    });

    // On first sighting of this mint in the tracking band, kick off the one-shot RPC lookups.
    if (firstTrade && state.devLookupState === "unstarted") {
        state.devLookupState = "pending";
        void runInitialLookups(state);
    }

    // At refresh_at_progress%, re-check top holder + dev balance once (dev may have just dumped).
    const refreshAt = config.pump_risk.refresh_at_progress ?? 98;
    if (!state.refreshedAt98 && ev.progress >= refreshAt) {
        state.refreshedAt98 = true;
        void runRefresh(state);
    }

    await evaluateAndPersistVerdict(state);
}

async function runInitialLookups(state: MintRiskState): Promise<void> {
    const mint = state.mint;

    // Dev identification is now a synchronous lookup into the live store populated by
    // pump.fun CreateEvent logs. No RPC, no latency. If the mint isn't in the store
    // the process started after the token's creation — we mark the lookup as failed
    // and carry on (dev-balance-based denies won't fire, but top holder / concentration
    // still can).
    let dev: string | null = lookupDevFromStore(mint);
    if (dev) {
        state.dev = dev;
        state.devLookupState = "resolved";
        await setDev(mint, dev, "resolved");
    } else {
        state.devLookupState = "failed";
        await setDev(mint, null, "failed");
        console.log(`[riskProfileHandler] dev unknown for ${mint} - process started after creation`);
    }

    const topHolderPromise = withRpcSlot(async () => {
        try {
            const pct = await getTopHolderPct(mint);
            if (pct !== null) {
                state.topHolderPct = pct;
                state.topHolderAt = Date.now();
                await setTopHolder(mint, pct, state.topHolderAt);
            }
        } catch (err) {
            console.error(`[riskProfileHandler] getTopHolderPct failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
        }
    });

    // Metadata: prefer the CreateEvent-captured label (zero RPC, always fresh). Fall
    // back to Metaplex only for tokens minted before the process started.
    // In both branches we push a `metadata` SSE event so connected dashboards update
    // the Live table immediately, without waiting for the next trade tick.
    const metadataPromise: Promise<void> = state.name
        ? (async () => {
            try {
                await setMetadata(mint, state.name!, state.symbol ?? "");
                emitMetadata({ mint, name: state.name, symbol: state.symbol });
            } catch (err) {
                console.error(`[riskProfileHandler] setMetadata (from store) failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
            }
        })()
        : withRpcSlot(async () => {
            try {
                const meta = await getTokenMetadata(mint);
                if (meta) {
                    state.name = meta.name;
                    state.symbol = meta.symbol;
                    await setMetadata(mint, meta.name, meta.symbol);
                    emitMetadata({ mint, name: meta.name, symbol: meta.symbol });
                }
            } catch (err) {
                console.error(`[riskProfileHandler] getTokenMetadata failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
            }
        });

    await Promise.all([topHolderPromise, metadataPromise]);

    // Dev balance depends on knowing the dev address.
    if (dev) {
        await withRpcSlot(async () => {
            try {
                const metrics = await getDevMetrics(mint, dev);
                if (metrics) {
                    state.devBalanceTok = metrics.balanceTok;
                    state.devHoldsPct = metrics.holdsPct;
                    state.devMetricsAt = Date.now();
                    await setDevMetrics(mint, metrics.balanceTok, metrics.holdsPct, state.devMetricsAt);
                }
            } catch (err) {
                console.error(`[riskProfileHandler] getDevMetrics failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
            }
        });
    }

    await evaluateAndPersistVerdict(state);
}

async function runRefresh(state: MintRiskState): Promise<void> {
    const mint = state.mint;
    const tasks: Promise<void>[] = [];

    tasks.push(withRpcSlot(async () => {
        try {
            const pct = await getTopHolderPct(mint);
            if (pct !== null) {
                state.topHolderPct = pct;
                state.topHolderAt = Date.now();
                await setTopHolder(mint, pct, state.topHolderAt);
            }
        } catch (err) {
            console.error(`[riskProfileHandler] refresh topHolder failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
        }
    }));

    if (state.dev) {
        const dev = state.dev;
        tasks.push(withRpcSlot(async () => {
            try {
                const metrics = await getDevMetrics(mint, dev);
                if (metrics) {
                    state.devBalanceTok = metrics.balanceTok;
                    state.devHoldsPct = metrics.holdsPct;
                    state.devMetricsAt = Date.now();
                    await setDevMetrics(mint, metrics.balanceTok, metrics.holdsPct, state.devMetricsAt);
                }
            } catch (err) {
                console.error(`[riskProfileHandler] refresh devMetrics failed for ${mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
            }
        }));
    }

    await Promise.all(tasks);
    await evaluateAndPersistVerdict(state);
}

export interface VerdictResult {
    verdict: Verdict;
    reason: string | null;
}

/**
 * Compute the go/no-go verdict from the in-memory state plus the latest RPC snapshots.
 * - deny: at least one hard condition is violated
 * - allow: every required signal has been computed AND is within thresholds
 * - pending: still waiting on a required signal (dev lookup, top holder) OR the buy sample
 *            is too small to judge concentration. Treated as "not allow" at the migration gate.
 */
export function evaluateVerdict(state: MintRiskState): VerdictResult {
    const t = config.pump_risk.thresholds;

    // Hard denies — if ANY of these is true with the current data, we deny immediately.
    if (state.topHolderPct !== null && state.topHolderPct > t.top1_deny) {
        return { verdict: "deny", reason: `top_holder_pct=${state.topHolderPct.toFixed(2)}% > ${t.top1_deny}` };
    }
    if (t.dev_balance_zero_deny && state.devBalanceTok !== null && state.devBalanceTok <= 0) {
        return { verdict: "deny", reason: "dev_balance_tok == 0 (dev sold out)" };
    }
    if (state.curveRegression && t.curve_regression_deny) {
        const threshold = t.curve_regression_drop_pct ?? 1.5;
        return {
            verdict: "deny",
            reason: `curve_regression: peak=${state.maxProgress.toFixed(2)}% → now=${state.prevProgress.toFixed(2)}% (drawdown ${state.curveDrawdown.toFixed(2)}pp ≥ ${threshold}pp)`,
        };
    }
    const minBuys = t.min_buys_for_concentration ?? 5;
    if (state.buyCount >= minBuys) {
        const botConc = computeBotConcentration(state, minBuys);
        if (botConc > t.bot_concentration_deny) {
            return { verdict: "deny", reason: `bot_concentration=${botConc.toFixed(2)}% > ${t.bot_concentration_deny}` };
        }
        const uniq = countUniqueBuyersLast(state, 10);
        if (uniq < t.unique_buyers_min_last10) {
            return { verdict: "deny", reason: `unique_buyers_last10=${uniq} < ${t.unique_buyers_min_last10}` };
        }
    }

    // To allow, we need both lookups to have completed successfully.
    const topHolderKnown = state.topHolderPct !== null;
    const devMetricsKnown = state.devBalanceTok !== null;
    const enoughBuys = state.buyCount >= minBuys;

    if (!topHolderKnown || !devMetricsKnown || !enoughBuys) {
        return { verdict: "pending", reason: null };
    }

    return { verdict: "allow", reason: null };
}

async function evaluateAndPersistVerdict(state: MintRiskState): Promise<void> {
    const { verdict, reason } = evaluateVerdict(state);
    try {
        await setVerdict(state.mint, verdict, reason);
    } catch (err) {
        console.error(`[riskProfileHandler] setVerdict failed for ${state.mint}:`, err instanceof Error ? (err.message || err.name || err.toString()) : String(err));
        return;
    }

    // Only push a verdict event when it actually changes — avoids flooding dashboard
    // listeners with identical 'pending' repeats on every trade.
    if (state.lastEmittedVerdict !== verdict || state.lastEmittedReason !== reason) {
        state.lastEmittedVerdict = verdict;
        state.lastEmittedReason = reason;
        emitVerdict({ mint: state.mint, verdict, reason });
    }
}

/**
 * Apply the configured fallback policy when a token migrates without a token_risk row
 * (bot was not running, or progress jumped past min_track_progress too fast to catch).
 * Returns true if the buy should proceed.
 */
export function resolveUntrackedPolicy(): "deny" | "legacy" | "allow" {
    return (config.pump_risk?.untracked_policy as "deny" | "legacy" | "allow") ?? "deny";
}
