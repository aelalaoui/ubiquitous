import { Connection, PublicKey } from "@solana/web3.js";
import { validateEnv } from "../env-validator";

// Metaplex Token Metadata program.
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export interface TokenMetadata {
    name: string;
    symbol: string;
}

let sharedConnection: Connection | null = null;
function getConn(): Connection {
    if (!sharedConnection) {
        const env = validateEnv();
        sharedConnection = new Connection(env.HELIUS_HTTPS_URI, "confirmed");
    }
    return sharedConnection;
}

const pdaCache = new Map<string, PublicKey>();
function getMetadataPDA(mint: string): PublicKey {
    const cached = pdaCache.get(mint);
    if (cached) return cached;
    const [pda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            METADATA_PROGRAM_ID.toBuffer(),
            new PublicKey(mint).toBuffer(),
        ],
        METADATA_PROGRAM_ID,
    );
    pdaCache.set(mint, pda);
    return pda;
}

function trimNul(s: string): string {
    // Metaplex pads name/symbol with NUL bytes to fill MAX_NAME_LENGTH / MAX_SYMBOL_LENGTH.
    // Strip trailing NULs then whitespace.
    return s.replace(/\u0000+$/g, "").trim();
}

/**
 * Fetch the on-chain Metaplex metadata account for this mint and parse the first
 * two fields (name, symbol). Returns null if the mint has no metadata account
 * (rare for pump.fun tokens) or if the account layout is unexpected.
 */
export async function getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    try {
        const conn = getConn();
        const pda = getMetadataPDA(mint);
        const info = await conn.getAccountInfo(pda);
        if (!info) return null;

        const buf = info.data;
        // Layout: key u8 (1) | update_authority Pubkey (32) | mint Pubkey (32) | data Data
        // Data starts at offset 65 with a borsh-serialized String (u32 LE length + bytes).
        let o = 65;
        if (buf.length < o + 4) return null;

        const nameLen = buf.readUInt32LE(o); o += 4;
        if (nameLen > 256 || o + nameLen > buf.length) return null;
        const name = trimNul(buf.slice(o, o + nameLen).toString("utf8"));
        o += nameLen;

        if (buf.length < o + 4) return { name, symbol: "" };
        const symbolLen = buf.readUInt32LE(o); o += 4;
        if (symbolLen > 64 || o + symbolLen > buf.length) return { name, symbol: "" };
        const symbol = trimNul(buf.slice(o, o + symbolLen).toString("utf8"));

        return { name, symbol };
    } catch (err) {
        const msg = err instanceof Error ? (err.message || err.name || err.toString()) : String(err);
        console.error(`[getTokenMetadata] failed for ${mint}: ${msg}`);
        return null;
    }
}
