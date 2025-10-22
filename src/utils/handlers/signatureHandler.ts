import { Connection } from "@solana/web3.js";
import { validateEnv } from "../env-validator";
import { config } from "../../config";

// Constants
const WSOL_MINT = config.wsol_pc_mint;

/**
 * SignatureHandler class optimized for speed
 */
export class SignatureHandler {
    private connection: Connection;

    constructor(connection?: Connection) {
        const env = validateEnv();
        this.connection = connection || new Connection(env.HELIUS_HTTPS_URI, "confirmed");
    }

    /**
     * Get the mint address from a transaction signature - optimized for speed
     * @param signature Transaction signature
     * @returns Promise resolving to mint address or null
     */
    public async getMintFromSignature(signature: string): Promise<string | null> {
        if (!signature || typeof signature !== "string" || signature.trim() === "") {
            return null; // Invalid signature, return null immediately
        }

        // Retry configuration for production - handle timing between WebSocket and RPC
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 seconds

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Add delay before retry (except for first attempt)
                if (attempt > 1) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                }

                // Fetch transaction with minimal options
                const tx = await this.connection.getParsedTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed",
                });

                // If transaction not found, try again (unless it's the last attempt)
                if (!tx && attempt < MAX_RETRIES) {
                    continue;
                }

                // Quick validation
                if (!tx?.meta) {
                    if (attempt < MAX_RETRIES) continue;
                    return null;
                }

                // Get token balances - prefer postTokenBalances as they're more likely to contain the new token
                const tokenBalances = tx.meta.postTokenBalances || tx.meta.preTokenBalances;

                if (!tokenBalances?.length) {
                    return null;
                }

                // Fast path: If we have exactly 2 token balances, one is likely WSOL and the other is the token
                if (tokenBalances.length === 2) {
                    const mint1 = tokenBalances[0].mint;
                    const mint2 = tokenBalances[1].mint;

                    // If mint1 is WSOL, return mint2 (unless it's also WSOL)
                    if (mint1 === WSOL_MINT) {
                        return mint2 === WSOL_MINT ? null : mint2;
                    }

                    // If mint2 is WSOL, return mint1
                    if (mint2 === WSOL_MINT) {
                        return mint1;
                    }

                    // If neither is WSOL, return the first one
                    return mint1;
                }

                // For more than 2 balances, find the first non-WSOL mint
                for (const balance of tokenBalances) {
                    if (balance.mint !== WSOL_MINT) {
                        return balance.mint;
                    }
                }

                // If we only found WSOL mints, return null
                return null;

            } catch (error) {
                // If it's not the last attempt, continue to retry
                if (attempt < MAX_RETRIES) {
                    continue;
                }

                // Last attempt failed - minimal logging for production
                console.error(`❌ [getMintFromSignature] Failed to process signature after ${MAX_RETRIES} attempts`);
                return null;
            }
        }

        return null;
    }
}

// Create a singleton instance for better performance
const signatureHandler = new SignatureHandler();

/**
 * Get the mint address from a transaction signature (optimized for speed)
 * @param signature Transaction signature
 * @returns Mint address or null
 */
export async function getMintFromSignature(signature: string): Promise<string | null> {
    return signatureHandler.getMintFromSignature(signature);
}