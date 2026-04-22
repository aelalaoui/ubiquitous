import bs58 from "bs58";

// Anchor 8-byte event discriminator for pump.fun's CreateEvent.
// Computed as sha256("event:CreateEvent")[0..8].
export const CREATE_EVENT_DISCRIMINATOR = Buffer.from(
    [0x1b, 0x72, 0xa9, 0x4d, 0xde, 0xeb, 0x63, 0x76],
);

export interface PumpCreateEvent {
    name: string;
    symbol: string;
    uri: string;
    mint: string;
    bondingCurve: string;
    user: string;          // creator wallet (== fee payer in nearly every pump.fun creation)
}

const PROGRAM_DATA_PREFIX = "Program data: ";
const MAX_STRING_LEN = 4096; // sanity cap — pump.fun strings are small, anything bigger is corrupt

function readBorshString(buf: Buffer, o: number): { value: string; next: number } {
    if (o + 4 > buf.length) throw new Error("eof reading string length");
    const len = buf.readUInt32LE(o);
    if (len > MAX_STRING_LEN || o + 4 + len > buf.length) throw new Error("bad string length");
    const value = buf.slice(o + 4, o + 4 + len).toString("utf8");
    return { value, next: o + 4 + len };
}

/**
 * Decode a pump.fun CreateEvent from the base64 payload of a `Program data: ...` line.
 * Layout: 8-byte discriminator | name (borsh string) | symbol (borsh string) |
 *         uri (borsh string) | mint (32B) | bonding_curve (32B) | user (32B) [| ...]
 * Newer pump.fun builds append extra fields (creator, timestamp) — we read the first
 * three pubkeys and ignore anything after, so the decoder stays forward-compatible.
 */
export function decodeCreateEvent(programDataB64: string): PumpCreateEvent | null {
    let raw: Buffer;
    try { raw = Buffer.from(programDataB64, "base64"); } catch { return null; }
    if (raw.length < 8) return null;
    if (raw.compare(CREATE_EVENT_DISCRIMINATOR, 0, 8, 0, 8) !== 0) return null;

    try {
        let o = 8;
        const name = readBorshString(raw, o); o = name.next;
        const symbol = readBorshString(raw, o); o = symbol.next;
        const uri = readBorshString(raw, o); o = uri.next;
        if (o + 32 * 3 > raw.length) return null;
        const mint = bs58.encode(raw.subarray(o, o + 32)); o += 32;
        const bondingCurve = bs58.encode(raw.subarray(o, o + 32)); o += 32;
        const user = bs58.encode(raw.subarray(o, o + 32));
        return { name: name.value, symbol: symbol.value, uri: uri.value, mint, bondingCurve, user };
    } catch {
        return null;
    }
}

export function extractCreateEventsFromLogs(logs: string[]): PumpCreateEvent[] {
    const events: PumpCreateEvent[] = [];
    for (const line of logs) {
        if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
        const payload = line.slice(PROGRAM_DATA_PREFIX.length).trim();
        if (!payload) continue;
        const ev = decodeCreateEvent(payload);
        if (ev) events.push(ev);
    }
    return events;
}
