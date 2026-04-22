import { Connection, PublicKey } from "@solana/web3.js";
import {
    getMint,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { config } from "../../config";
import { validateEnv } from "../env-validator";
import { getBondingCurvePDA } from "../decoders/pumpTradeEvent";

export class TokenCheckManager {
    private connection: Connection;

    constructor(connection?: Connection) {
        const env = validateEnv();
        this.connection = connection || new Connection(env.HELIUS_HTTPS_URI, "confirmed");
    }

    /**
     * Check if a token's mint and freeze authorities are still enabled
     * @param mintAddress The token's mint address (contract address)
     * @returns Object containing authority status and details
     */
    public async getTokenAuthorities(mintAddress: string): Promise<TokenAuthorityStatus> {
        try {
            // Validate mint address
            if (!mintAddress || typeof mintAddress !== "string" || mintAddress.trim() === "") {
                throw new Error("Invalid mint address");
            }

            const mintPublicKey = new PublicKey(mintAddress);
            const mintInfo = await getMint(this.connection, mintPublicKey);

            // Check if mint authority exists (is not null)
            const hasMintAuthority = mintInfo.mintAuthority !== null;

            // Check if freeze authority exists (is not null)
            const hasFreezeAuthority = mintInfo.freezeAuthority !== null;

            // Get the addresses as strings if they exist
            const mintAuthorityAddress = mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : null;
            const freezeAuthorityAddress = mintInfo.freezeAuthority ? mintInfo.freezeAuthority.toBase58() : null;

            return {
                mintAddress: mintAddress,
                hasMintAuthority,
                hasFreezeAuthority,
                mintAuthorityAddress,
                freezeAuthorityAddress,
                isSecure: !hasMintAuthority && !hasFreezeAuthority,
                details: {
                    supply: mintInfo.supply.toString(),
                    decimals: mintInfo.decimals,
                },
            };
        } catch (error) {
            console.error(`Error checking token authorities for ${mintAddress}:`, error);
            throw error;
        }
    }
    /**
     * Simplified check that returns only whether the token passes security checks
     * based on the configuration settings
     * @param mintAddress The token's mint address
     * @returns Boolean indicating if the token passes security checks
     */
    public async isTokenSecure(mintAddress: string): Promise<boolean> {
        try {
            const authorityStatus = await this.getTokenAuthorities(mintAddress);

            // Check against configuration settings
            const allowMintAuthority = config.checks.settings.allow_mint_authority;
            const allowFreezeAuthority = config.checks.settings.allow_freeze_authority;

            // Token is secure if:
            // 1. It has no mint authority OR mint authority is allowed in config
            // 2. It has no freeze authority OR freeze authority is allowed in config
            return (!authorityStatus.hasMintAuthority || allowMintAuthority) &&
                (!authorityStatus.hasFreezeAuthority || allowFreezeAuthority);
        } catch (error) {
            console.error(`Error checking if token is secure: ${mintAddress}`, error);
            return false; // Consider token insecure if there's an error
        }
    }
}

/**
 * Interface for token authority check results
 */
export interface TokenAuthorityStatus {
    mintAddress: string;
    hasMintAuthority: boolean;
    hasFreezeAuthority: boolean;
    mintAuthorityAddress: string | null;
    freezeAuthorityAddress: string | null;
    isSecure: boolean;
    details: {
        supply: string;
        decimals: number;
    };
}

// Create a singleton instance for better performance
const tokenCheckManager = new TokenCheckManager();

/**
 * Check if a token's mint and freeze authorities are still enabled
 * @param mintAddress The token's mint address
 * @returns Object containing authority status and details
 */
export async function getTokenAuthorities(mintAddress: string): Promise<TokenAuthorityStatus> {
    return tokenCheckManager.getTokenAuthorities(mintAddress);
}

/**
 * Check if a token passes security checks based on configuration
 * @param mintAddress The token's mint address
 * @returns Boolean indicating if the token passes security checks
 */
export async function isTokenSecure(mintAddress: string): Promise<boolean> {
    return tokenCheckManager.isTokenSecure(mintAddress);
}

let sharedConnection: Connection | null = null;
function getSharedConnection(): Connection {
    if (!sharedConnection) {
        const env = validateEnv();
        sharedConnection = new Connection(env.HELIUS_HTTPS_URI, "confirmed");
    }
    return sharedConnection;
}

/**
 * Detect which token program owns a mint account (classic SPL Token vs Token-2022).
 * Pump.fun graduating tokens and some pumpfun-related flows use Token-2022 —
 * hitting them with the default TOKEN_PROGRAM_ID raises "Invalid param: not a Token mint".
 */
export async function getMintProgramId(mint: string): Promise<PublicKey | null> {
    const connection = getSharedConnection();
    const info = await connection.getAccountInfo(new PublicKey(mint));
    if (!info) return null;
    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
    return null; // account exists but isn't a token mint (e.g. bonding curve PDA hit by mistake)
}

/**
 * Return the largest holder's share of supply (percent), EXCLUDING the bonding
 * curve's associated token account. On pump.fun the bonding curve ATA holds the
 * bulk of the supply until graduation — counting it would drown out every other
 * signal.
 */
export async function getTopHolderPct(mint: string): Promise<number | null> {
    try {
        const connection = getSharedConnection();
        const mintPk = new PublicKey(mint);

        const programId = await getMintProgramId(mint);
        if (!programId) {
            console.error(`[getTopHolderPct] ${mint} is not owned by any token program`);
            return null;
        }

        const bondingCurve = new PublicKey(getBondingCurvePDA(mint));
        const excludedAta = getAssociatedTokenAddressSync(mintPk, bondingCurve, true, programId).toBase58();

        const [largest, mintInfo] = await Promise.all([
            connection.getTokenLargestAccounts(mintPk),
            getMint(connection, mintPk, undefined, programId),
        ]);

        const totalSupply = Number(mintInfo.supply);
        if (totalSupply <= 0) return null;

        // Accounts are sorted desc by amount; pick the largest that isn't the bonding curve ATA.
        for (const acc of largest.value) {
            if (acc.address.toBase58() === excludedAta) continue;
            const amount = Number(acc.amount);
            if (!isFinite(amount) || amount <= 0) continue;
            return (amount / totalSupply) * 100;
        }
        return 0; // only the bonding curve holds tokens → no external concentration
    } catch (error) {
        const msg = error instanceof Error
            ? (error.message || error.name || error.toString())
            : String(error);
        console.error(`[getTopHolderPct] failed for ${mint}: ${msg}`);
        return null;
    }
}