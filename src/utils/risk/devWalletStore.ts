/**
 * Live in-memory index of pump.fun token creations, populated from CreateEvent logs
 * as they arrive on the WSS. Replaces the old signature-walking dev lookup (zero RPC,
 * zero latency, always correct for tokens minted while the process is up).
 *
 * Beyond just "what dev made this mint", the store now remembers name/symbol/uri and
 * the bonding curve PDA — enough for the dashboard's Creations tab to show a human
 * label without hitting Metaplex or any extra RPC.
 *
 * Tokens minted before the process started (or before the WSS reconnected) are simply
 * absent — callers must handle the null case explicitly.
 */

export interface CreationEntry {
    dev: string;
    name: string;
    symbol: string;
    uri: string;
    bondingCurve: string;
    capturedAt: number;
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
    description?: string | null;
    image?: string | null;
}

export type CreationInput = Omit<CreationEntry, "capturedAt" | "twitter" | "telegram" | "website" | "description" | "image">;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;      // 24h — outlives typical pump.fun token lifetime
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1h

const store = new Map<string, CreationEntry>();
let pruneTimer: NodeJS.Timeout | null = null;

export function setCreation(mint: string, entry: CreationInput): void {
    store.set(mint, { ...entry, capturedAt: Date.now() });
}

export function attachSocials(
    mint: string,
    socials: { twitter: string | null; telegram: string | null; website: string | null; description: string | null; image: string | null },
): void {
    const existing = store.get(mint);
    if (!existing) return;
    existing.twitter = socials.twitter;
    existing.telegram = socials.telegram;
    existing.website = socials.website;
    existing.description = socials.description;
    existing.image = socials.image;
}

export function getCreation(mint: string): CreationEntry | null {
    return store.get(mint) ?? null;
}

export function getDev(mint: string): string | null {
    return store.get(mint)?.dev ?? null;
}

export function deleteDev(mint: string): void {
    store.delete(mint);
}

export function size(): number {
    return store.size;
}

export function clearAll(): number {
    const n = store.size;
    store.clear();
    return n;
}

/**
 * Return up to `limit` most recent creations (newest first).
 */
export function listCreations(limit: number = 200): Array<CreationEntry & { mint: string }> {
    const entries: Array<CreationEntry & { mint: string }> = [];
    for (const [mint, e] of store) entries.push({ mint, ...e });
    entries.sort((a, b) => b.capturedAt - a.capturedAt);
    return entries.slice(0, limit);
}

export function prune(maxAgeMs: number = DEFAULT_TTL_MS): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [mint, entry] of store) {
        if (entry.capturedAt < cutoff) {
            store.delete(mint);
            removed++;
        }
    }
    return removed;
}

export function startPruning(
    intervalMs: number = DEFAULT_PRUNE_INTERVAL_MS,
    maxAgeMs: number = DEFAULT_TTL_MS,
): void {
    if (pruneTimer) return;
    pruneTimer = setInterval(() => {
        const n = prune(maxAgeMs);
        if (n > 0) console.log(`🧹 [devWalletStore] pruned ${n} entries older than ${maxAgeMs / 1000}s`);
    }, intervalMs);
    pruneTimer.unref?.();
}

export function stopPruning(): void {
    if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
}
