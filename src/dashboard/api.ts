import type { Express, Request, Response } from "express";
import {
    getRisk,
    getStatsSnapshot,
    listMigrations,
    listTrackedRisks,
    truncateRisk,
} from "../tracker/riskDb";
import { clearAllState, getState, stateCount } from "../utils/risk/mintRiskState";
import {
    clearAll as clearDevWalletStore,
    getCreation as lookupCreationFromStore,
    listCreations,
    size as devWalletStoreSize,
} from "../utils/risk/devWalletStore";
import type { TokenRiskRow } from "../tracker/riskDb";

/**
 * Fill in name/symbol from the live CreateEvent store whenever the persisted row
 * doesn't have them yet (token freshly crossed 90% but the metadata UPDATE hasn't
 * flushed, or migrated without ever carrying a label). Mutates the row in place.
 */
type EnrichedRow = TokenRiskRow & {
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
    description?: string | null;
    image?: string | null;
    uri?: string | null;
};

function enrichWithCreationLabel(row: TokenRiskRow): EnrichedRow {
    const enriched: EnrichedRow = row;
    const c = lookupCreationFromStore(row.mint);
    if (!c) return enriched;
    if (!enriched.name)   enriched.name   = c.name || null;
    if (!enriched.symbol) enriched.symbol = c.symbol || null;
    enriched.twitter     = c.twitter ?? null;
    enriched.telegram    = c.telegram ?? null;
    enriched.website     = c.website ?? null;
    enriched.description = c.description ?? null;
    enriched.image       = c.image ?? null;
    enriched.uri         = c.uri ?? null;
    return enriched;
}
import { listenerCount } from "./events";

export function registerApi(app: Express): void {
    app.get("/api/tokens", async (_req: Request, res: Response) => {
        try {
            const rows = await listTrackedRisks(200);
            res.json(rows.map(enrichWithCreationLabel));
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.get("/api/tokens/:mint", async (req: Request, res: Response) => {
        try {
            const mint = req.params.mint;
            const row = await getRisk(mint);
            if (!row) {
                res.status(404).json({ error: "mint not found" });
                return;
            }
            enrichWithCreationLabel(row);
            const memState = getState(mint);
            res.json({
                ...row,
                dev: row.dev,
                dev_lookup_state: row.dev_lookup_state,
                recent_trades: memState ? memState.trades : [],
                in_memory: memState
                    ? {
                        dev_lookup_state: memState.devLookupState,
                        refreshed_at_98: memState.refreshedAt98,
                        ring_buffer_size: memState.trades.length,
                    }
                    : null,
            });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.get("/api/creations", async (req: Request, res: Response) => {
        try {
            const rawLimit = Number(req.query.limit);
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 1000 ? rawLimit : 200;
            res.json(listCreations(limit));
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.get("/api/migrations", async (req: Request, res: Response) => {
        try {
            const rawLimit = Number(req.query.limit);
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 500 ? rawLimit : 50;
            const rows = await listMigrations(limit);
            res.json(rows.map(enrichWithCreationLabel));
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.post("/api/admin/truncate", async (_req: Request, res: Response) => {
        try {
            const rowsDeleted = await truncateRisk();
            const statesCleared = clearAllState();
            const devsCleared = clearDevWalletStore();
            console.log(`🧹 [admin] truncated token_risk (${rowsDeleted} rows), cleared ${statesCleared} in-memory states, ${devsCleared} dev-wallet entries`);
            res.json({ rows_deleted: rowsDeleted, states_cleared: statesCleared, devs_cleared: devsCleared });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.get("/api/stats", async (_req: Request, res: Response) => {
        try {
            const snapshot = await getStatsSnapshot();
            res.json({
                ...snapshot,
                in_memory_state_count: stateCount(),
                dev_wallet_store_count: devWalletStoreSize(),
                sse_listeners: listenerCount(),
            });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
}
