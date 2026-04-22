import * as sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import { config } from "../config";

export type Verdict = "pending" | "allow" | "deny";
export type DevLookupState = "pending" | "resolved" | "failed";

export interface TokenRiskRow {
    mint: string;
    first_seen: number;
    last_seen: number;
    dev: string | null;
    dev_lookup_state: DevLookupState;
    progress: number;
    last_real_sol: number | null;
    last_real_tok: number | null;
    trade_count: number;
    buy_count: number;
    sell_count: number;
    unique_buyers_10: number | null;
    bot_concentration: number | null;
    curve_regression: number; // 0 | 1
    top_holder_pct: number | null;
    top_holder_at: number | null;
    dev_balance_tok: number | null;
    dev_holds_pct: number | null;
    dev_metrics_at: number | null;
    verdict: Verdict | null;
    verdict_reason: string | null;
    verdict_at: number | null;
    migrated_at: number | null;
    buy_attempted: number;       // 0 | 1
    buy_success: number | null;  // 0 | 1 | null
    buy_error: string | null;
    name: string | null;
    symbol: string | null;
}

let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
    if (!dbPromise) {
        dbPromise = (async () => {
            const db = await open({
                filename: config.db.pathname,
                driver: sqlite3.Database,
            });
            await db.exec(`
                CREATE TABLE IF NOT EXISTS token_risk (
                    mint               TEXT PRIMARY KEY,
                    first_seen         INTEGER NOT NULL,
                    last_seen          INTEGER NOT NULL,
                    dev                TEXT,
                    dev_lookup_state   TEXT DEFAULT 'pending',
                    progress           REAL NOT NULL DEFAULT 0,
                    last_real_sol      REAL,
                    last_real_tok      REAL,
                    trade_count        INTEGER DEFAULT 0,
                    buy_count          INTEGER DEFAULT 0,
                    sell_count         INTEGER DEFAULT 0,
                    unique_buyers_10   INTEGER,
                    bot_concentration  REAL,
                    curve_regression   INTEGER DEFAULT 0,
                    top_holder_pct     REAL,
                    top_holder_at      INTEGER,
                    dev_balance_tok    REAL,
                    dev_holds_pct      REAL,
                    dev_metrics_at     INTEGER,
                    verdict            TEXT,
                    verdict_reason     TEXT,
                    verdict_at         INTEGER
                );
            `);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_token_risk_verdict ON token_risk(verdict);`);

            // Idempotent schema migrations for columns added after initial release.
            const existingCols = new Set<string>(
                (await db.all<{ name: string }[]>(`PRAGMA table_info(token_risk)`))
                    .map(row => row.name)
            );
            const additions: Array<[string, string]> = [
                ["migrated_at", "INTEGER"],
                ["buy_attempted", "INTEGER DEFAULT 0"],
                ["buy_success", "INTEGER"],
                ["buy_error", "TEXT"],
                ["name", "TEXT"],
                ["symbol", "TEXT"],
            ];
            for (const [name, type] of additions) {
                if (!existingCols.has(name)) {
                    await db.exec(`ALTER TABLE token_risk ADD COLUMN ${name} ${type}`);
                }
            }
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_token_risk_migrated ON token_risk(migrated_at);`);

            return db;
        })();
    }
    return dbPromise;
}

export async function initRiskDb(): Promise<void> {
    await getDb();
}

export async function getRisk(mint: string): Promise<TokenRiskRow | null> {
    const db = await getDb();
    const row = await db.get<TokenRiskRow>(`SELECT * FROM token_risk WHERE mint = ?`, [mint]);
    return row ?? null;
}

export interface RiskUpsert {
    mint: string;
    last_seen: number;
    progress: number;
    last_real_sol: number;
    last_real_tok: number;
    trade_count: number;
    buy_count: number;
    sell_count: number;
    unique_buyers_10: number;
    bot_concentration: number;
    curve_regression: 0 | 1;
}

export async function upsertRisk(row: RiskUpsert): Promise<void> {
    const db = await getDb();
    await db.run(
        `INSERT INTO token_risk
            (mint, first_seen, last_seen, progress, last_real_sol, last_real_tok,
             trade_count, buy_count, sell_count, unique_buyers_10, bot_concentration, curve_regression, verdict)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(mint) DO UPDATE SET
            last_seen = excluded.last_seen,
            progress = excluded.progress,
            last_real_sol = excluded.last_real_sol,
            last_real_tok = excluded.last_real_tok,
            trade_count = excluded.trade_count,
            buy_count = excluded.buy_count,
            sell_count = excluded.sell_count,
            unique_buyers_10 = excluded.unique_buyers_10,
            bot_concentration = excluded.bot_concentration,
            curve_regression = excluded.curve_regression`,
        [
            row.mint,
            row.last_seen,
            row.last_seen,
            row.progress,
            row.last_real_sol,
            row.last_real_tok,
            row.trade_count,
            row.buy_count,
            row.sell_count,
            row.unique_buyers_10,
            row.bot_concentration,
            row.curve_regression,
        ]
    );
}

export async function setDev(mint: string, dev: string | null, state: DevLookupState): Promise<void> {
    const db = await getDb();
    await db.run(
        `UPDATE token_risk SET dev = ?, dev_lookup_state = ? WHERE mint = ?`,
        [dev, state, mint]
    );
}

export async function setTopHolder(mint: string, pct: number, at: number): Promise<void> {
    const db = await getDb();
    await db.run(
        `UPDATE token_risk SET top_holder_pct = ?, top_holder_at = ? WHERE mint = ?`,
        [pct, at, mint]
    );
}

export async function setMetadata(mint: string, name: string, symbol: string): Promise<void> {
    const db = await getDb();
    await db.run(
        `UPDATE token_risk SET name = ?, symbol = ? WHERE mint = ?`,
        [name, symbol, mint]
    );
}

export async function setDevMetrics(
    mint: string,
    balanceTok: number,
    holdsPct: number,
    at: number,
): Promise<void> {
    const db = await getDb();
    await db.run(
        `UPDATE token_risk SET dev_balance_tok = ?, dev_holds_pct = ?, dev_metrics_at = ? WHERE mint = ?`,
        [balanceTok, holdsPct, at, mint]
    );
}

export async function setVerdict(mint: string, verdict: Verdict, reason: string | null): Promise<void> {
    const db = await getDb();
    await db.run(
        `UPDATE token_risk SET verdict = ?, verdict_reason = ?, verdict_at = ? WHERE mint = ?`,
        [verdict, reason, Date.now(), mint]
    );
}

/**
 * Record the outcome of a migration event for this mint. `bought` indicates whether
 * the buy was attempted (verdict=allow path). `success` reflects whether the swap
 * actually went through; null means the buy was not attempted (deny path).
 */
export async function setMigrationOutcome(
    mint: string,
    bought: boolean,
    success: boolean | null,
    error: string | null = null,
): Promise<void> {
    const db = await getDb();
    const now = Date.now();
    // Use INSERT-OR-UPDATE: a mint may migrate without ever being tracked (no row yet).
    await db.run(
        `INSERT INTO token_risk (mint, first_seen, last_seen, migrated_at, buy_attempted, buy_success, buy_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mint) DO UPDATE SET
            migrated_at = excluded.migrated_at,
            buy_attempted = excluded.buy_attempted,
            buy_success = excluded.buy_success,
            buy_error = excluded.buy_error`,
        [mint, now, now, now, bought ? 1 : 0, success === null ? null : (success ? 1 : 0), error]
    );
}

/**
 * Tokens currently in the tracking band — have a risk row but haven't migrated yet.
 * Ordered by progress desc so the dashboard can show the closest-to-graduation first.
 */
export async function listTrackedRisks(limit: number = 200): Promise<TokenRiskRow[]> {
    const db = await getDb();
    return db.all<TokenRiskRow[]>(
        `SELECT * FROM token_risk
         WHERE migrated_at IS NULL
         ORDER BY progress DESC
         LIMIT ?`,
        [limit]
    );
}

export async function listMigrations(limit: number = 50): Promise<TokenRiskRow[]> {
    const db = await getDb();
    return db.all<TokenRiskRow[]>(
        `SELECT * FROM token_risk
         WHERE migrated_at IS NOT NULL
         ORDER BY migrated_at DESC
         LIMIT ?`,
        [limit]
    );
}

export interface StatsSnapshot {
    tracked_count: number;
    allow_count: number;
    deny_count: number;
    pending_count: number;
    migrations_today: number;
    migrations_week: number;
    buys_attempted_today: number;
    buys_success_today: number;
}

/**
 * Wipe every row in token_risk. Returns the number of rows deleted. Irreversible —
 * the dashboard's admin button is the only caller.
 */
export async function truncateRisk(): Promise<number> {
    const db = await getDb();
    const before = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM token_risk`);
    await db.exec(`DELETE FROM token_risk`);
    // Reclaim space and reset rowids so the next inserts start clean.
    await db.exec(`VACUUM`);
    return before?.c ?? 0;
}

export async function getStatsSnapshot(): Promise<StatsSnapshot> {
    const db = await getDb();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const [tracked, verdicts, migToday, migWeek, buysToday] = await Promise.all([
        db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM token_risk WHERE migrated_at IS NULL`),
        db.all<{ verdict: string | null; c: number }[]>(
            `SELECT verdict, COUNT(*) AS c FROM token_risk WHERE migrated_at IS NULL GROUP BY verdict`
        ),
        db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM token_risk WHERE migrated_at >= ?`, [dayAgo]),
        db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM token_risk WHERE migrated_at >= ?`, [weekAgo]),
        db.get<{ attempted: number; success: number }>(
            `SELECT
                SUM(CASE WHEN buy_attempted = 1 THEN 1 ELSE 0 END) AS attempted,
                SUM(CASE WHEN buy_success = 1 THEN 1 ELSE 0 END) AS success
             FROM token_risk
             WHERE migrated_at >= ?`,
            [dayAgo]
        ),
    ]);

    const byVerdict = new Map<string, number>();
    for (const row of verdicts) {
        byVerdict.set(row.verdict ?? "null", row.c);
    }

    return {
        tracked_count: tracked?.c ?? 0,
        allow_count: byVerdict.get("allow") ?? 0,
        deny_count: byVerdict.get("deny") ?? 0,
        pending_count: (byVerdict.get("pending") ?? 0) + (byVerdict.get("null") ?? 0),
        migrations_today: migToday?.c ?? 0,
        migrations_week: migWeek?.c ?? 0,
        buys_attempted_today: buysToday?.attempted ?? 0,
        buys_success_today: buysToday?.success ?? 0,
    };
}
