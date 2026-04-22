import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { validateEnv } from "../env-validator";
import { getMintProgramId } from "./tokenHandler";

let sharedConnection: Connection | null = null;

function getConnection(): Connection {
    if (!sharedConnection) {
        const env = validateEnv();
        sharedConnection = new Connection(env.HELIUS_HTTPS_URI, "confirmed");
    }
    return sharedConnection;
}

export interface DevMetrics {
    balanceTok: number;   // dev's current balance of this mint (in whole tokens, 6 decimals)
    holdsPct: number;     // balance / total_supply * 100
}

/**
 * Look up the dev's current token balance for this mint and their % of total supply.
 * Sums all token accounts owned by dev that hold this mint (usually just one).
 * Detects the owning token program (SPL-Token vs Token-2022) so it works on both.
 *
 * Dev identification itself now happens live from pump.fun CreateEvent logs — see
 * `src/utils/risk/devWalletStore.ts`. The old signature-walking `identifyDev` has
 * been removed.
 */
export async function getDevMetrics(mint: string, dev: string): Promise<DevMetrics | null> {
    const connection = getConnection();
    const mintPk = new PublicKey(mint);
    const devPk = new PublicKey(dev);

    const programId = await getMintProgramId(mint);
    if (!programId) return null;

    const [mintInfo, accounts] = await Promise.all([
        getMint(connection, mintPk, undefined, programId),
        connection.getParsedTokenAccountsByOwner(devPk, { programId }),
    ]);

    let balanceRaw = 0n;
    for (const { account } of accounts.value) {
        const info = account.data?.parsed?.info;
        if (info?.mint !== mint) continue;
        const amount = info?.tokenAmount?.amount;
        if (typeof amount === "string") {
            try { balanceRaw += BigInt(amount); } catch { /* skip */ }
        }
    }

    const decimals = mintInfo.decimals;
    const divisor = 10 ** decimals;
    const balanceTok = Number(balanceRaw) / divisor;
    const totalSupply = Number(mintInfo.supply) / divisor;
    const holdsPct = totalSupply > 0 ? (balanceTok / totalSupply) * 100 : 0;

    return { balanceTok, holdsPct };
}
