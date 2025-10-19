import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { config } from "../../config";
import { validateEnv } from "../env-validator";

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