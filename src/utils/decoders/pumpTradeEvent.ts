import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Initial real token reserves on pump.fun bonding curve, in base units (6 decimals).
// Used to derive bonding curve progress from `real_tok`.
export const INITIAL_REAL_TOKEN_RESERVES: bigint = 793_100_000n * 1_000_000n;

export interface TradeEvent {
    mint: string;
    solAmount: number;      // in SOL (divided by 1e9)
    tokenAmount: number;    // in tokens (divided by 1e6)
    isBuy: boolean;
    user: string;
    timestamp: number;      // unix seconds
    virtualSol: number;
    virtualTok: number;
    realSol: number;
    realTok: number;
    progress: number;       // 0–100, % bonding curve filled
    complete: boolean;
}

const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 1_000_000;
const EVENT_LEN = 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 8; // 129

// Anchor 8-byte event discriminator for pump.fun's TradeEvent. Computed as
// sha256("event:TradeEvent")[0..8]. This prefix appears in the base64 payload as
// "vdt/007mYe…" — the canonical sniff string documented by pump.fun reverse-engineering.
// `Program data:` lines also carry CreateEvent and CompleteEvent; without this check we
// would misalign their payloads and extract bogus mint/trader pubkeys.
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee]);

/**
 * Decode a pump.fun TradeEvent from the base64 payload of a `Program data: ...` log line.
 * Returns null if the payload is the wrong length or decoding fails.
 */
export function decodeTradeEvent(programDataB64: string): TradeEvent | null {
    let raw: Buffer;
    try {
        raw = Buffer.from(programDataB64, "base64");
    } catch {
        return null;
    }

    if (raw.length < EVENT_LEN) return null;
    // Skip any `Program data:` line that isn't a TradeEvent (CreateEvent, CompleteEvent, etc.)
    if (raw.compare(TRADE_EVENT_DISCRIMINATOR, 0, 8, 0, 8) !== 0) return null;

    try {
        let o = 8; // skip 8-byte Anchor discriminator

        const mint = bs58.encode(raw.subarray(o, o + 32));
        o += 32;

        const solAmountRaw = raw.readBigUInt64LE(o); o += 8;
        const tokenAmountRaw = raw.readBigUInt64LE(o); o += 8;
        const isBuy = raw[o] === 1; o += 1;

        const user = bs58.encode(raw.subarray(o, o + 32));
        o += 32;

        const timestampRaw = raw.readBigInt64LE(o); o += 8;
        const virtualSolRaw = raw.readBigUInt64LE(o); o += 8;
        const virtualTokRaw = raw.readBigUInt64LE(o); o += 8;
        const realSolRaw = raw.readBigUInt64LE(o); o += 8;
        const realTokRaw = raw.readBigUInt64LE(o); o += 8;

        // progress = (1 - real_tok / INITIAL) * 100, done with bigints to avoid float drift
        const progress = realTokRaw >= INITIAL_REAL_TOKEN_RESERVES
            ? 0
            : (1 - Number(realTokRaw) / Number(INITIAL_REAL_TOKEN_RESERVES)) * 100;

        return {
            mint,
            solAmount: Number(solAmountRaw) / LAMPORTS_PER_SOL,
            tokenAmount: Number(tokenAmountRaw) / TOKEN_DECIMALS,
            isBuy,
            user,
            timestamp: Number(timestampRaw),
            virtualSol: Number(virtualSolRaw) / LAMPORTS_PER_SOL,
            virtualTok: Number(virtualTokRaw) / TOKEN_DECIMALS,
            realSol: Number(realSolRaw) / LAMPORTS_PER_SOL,
            realTok: Number(realTokRaw) / TOKEN_DECIMALS,
            progress,
            complete: realTokRaw === 0n,
        };
    } catch {
        return null;
    }
}

const PROGRAM_DATA_PREFIX = "Program data: ";

/**
 * Scan logMessages[] and decode every `Program data: ...` line into a TradeEvent.
 * Non-TradeEvent program-data lines return null and are filtered out.
 */
export function extractTradeEventsFromLogs(logs: string[]): TradeEvent[] {
    const events: TradeEvent[] = [];
    for (const line of logs) {
        if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
        const payload = line.slice(PROGRAM_DATA_PREFIX.length).trim();
        if (!payload) continue;
        const ev = decodeTradeEvent(payload);
        if (ev) events.push(ev);
    }
    return events;
}

const PUMP_PROGRAM_PK = new PublicKey(PUMP_FUN_PROGRAM_ID);
const pdaCache = new Map<string, string>();

/**
 * Derive the bonding curve PDA for a given mint.
 * Seed: [b"bonding-curve", mint_pubkey].
 * Cached per mint — the derivation is pure.
 */
export function getBondingCurvePDA(mint: string): string {
    const cached = pdaCache.get(mint);
    if (cached) return cached;
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
        PUMP_PROGRAM_PK,
    );
    const b58 = pda.toBase58();
    pdaCache.set(mint, b58);
    return b58;
}
