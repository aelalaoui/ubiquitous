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
        // LOG DE DEBUG VISIBLE - VERSION 2.0
        console.log("🚨🚨🚨 [DEBUG VERSION 2.0] getMintFromSignature called 🚨🚨🚨");
        console.log("🚨 [DEBUG] Input signature:", signature);

        if (!signature || typeof signature !== "string" || signature.trim() === "") {
            console.log(`🚨 [DEBUG] Invalid signature detected: "${signature}"`);
            return null; // Invalid signature, return null immediately
        }

        // Retry configuration for production
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 seconds

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`🚨 [DEBUG] Attempt ${attempt}/${MAX_RETRIES} - Fetching transaction: ${signature}`);
                console.log(`🚨 [DEBUG] Using connection endpoint: ${this.connection.rpcEndpoint}`);

                // Add delay before retry (except for first attempt)
                if (attempt > 1) {
                    console.log(`🚨 [DEBUG] Waiting ${RETRY_DELAY}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                }

                // Fetch transaction with minimal options
                const tx = await this.connection.getParsedTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed",
                });

                console.log(`🚨 [DEBUG] Transaction fetch result (attempt ${attempt}):`, {
                    found: !!tx,
                    hasMeta: !!tx?.meta,
                    blockTime: tx?.blockTime,
                    slot: tx?.slot
                });

                // If transaction not found, try again (unless it's the last attempt)
                if (!tx && attempt < MAX_RETRIES) {
                    console.log(`🚨 [DEBUG] Transaction not found on attempt ${attempt}, retrying...`);
                    continue;
                }

                // Quick validation
                if (!tx?.meta) {
                    if (attempt === MAX_RETRIES) {
                        console.log(`🚨 [DEBUG] FINAL FAILURE POINT: No transaction or meta found after ${MAX_RETRIES} attempts`);
                        console.log(`🚨 [DEBUG] tx exists:`, !!tx);
                        console.log(`🚨 [DEBUG] tx.meta exists:`, !!tx?.meta);
                    }
                    if (attempt < MAX_RETRIES) continue;
                    return null;
                }

                // Get token balances - prefer postTokenBalances as they're more likely to contain the new token
                const tokenBalances = tx.meta.postTokenBalances || tx.meta.preTokenBalances;

                console.log(`🚨 [DEBUG] Token balances analysis (attempt ${attempt}):`, {
                    postTokenBalances: tx.meta.postTokenBalances?.length || 0,
                    preTokenBalances: tx.meta.preTokenBalances?.length || 0,
                    usingPost: !!tx.meta.postTokenBalances,
                    finalCount: tokenBalances?.length || 0
                });

                if (!tokenBalances?.length) {
                    console.log(`🚨 [DEBUG] FAILURE POINT: No token balances found (attempt ${attempt})`);
                    return null;
                }

                console.log(`🚨 [DEBUG] SUCCESS: Processing ${tokenBalances.length} token balances...`);
                console.log(`🚨 [DEBUG] WSOL_MINT constant:`, WSOL_MINT);

                // Fast path: If we have exactly 2 token balances, one is likely WSOL and the other is the token
                if (tokenBalances.length === 2) {
                    const mint1 = tokenBalances[0].mint;
                    const mint2 = tokenBalances[1].mint;

                    console.log(`🚨 [DEBUG] 2-balance path: mint1=${mint1}, mint2=${mint2}`);

                    // If mint1 is WSOL, return mint2 (unless it's also WSOL)
                    if (mint1 === WSOL_MINT) {
                        const result = mint2 === WSOL_MINT ? null : mint2;
                        console.log(`🚨 [DEBUG] mint1 is WSOL, returning:`, result);
                        return result;
                    }

                    // If mint2 is WSOL, return mint1
                    if (mint2 === WSOL_MINT) {
                        console.log(`🚨 [DEBUG] mint2 is WSOL, returning:`, mint1);
                        return mint1;
                    }

                    // If neither is WSOL, return the first one
                    console.log(`🚨 [DEBUG] Neither is WSOL, returning first:`, mint1);
                    return mint1;
                }

                // For more than 2 balances, find the first non-WSOL mint
                console.log(`🚨 [DEBUG] Multi-balance path: searching through ${tokenBalances.length} balances`);
                for (let i = 0; i < tokenBalances.length; i++) {
                    const balance = tokenBalances[i];
                    console.log(`🚨 [DEBUG] Balance ${i+1}: mint=${balance.mint}, isWSol=${balance.mint === WSOL_MINT}`);
                    if (balance.mint !== WSOL_MINT) {
                        console.log(`🚨 [DEBUG] SUCCESS: Found non-WSOL mint:`, balance.mint);
                        return balance.mint;
                    }
                }

                // If we only found WSOL mints, return null
                console.log(`🚨 [DEBUG] FAILURE POINT: Only WSOL mints found`);
                return null;

            } catch (error) {
                // Enhanced error logging for production debugging
                console.error(`🚨🚨🚨 [DEBUG] ERROR on attempt ${attempt}/${MAX_RETRIES} processing signature ${signature}:`, error);
                if (error instanceof Error) {
                    console.error(`🚨 [DEBUG] Error message:`, error.message);
                    console.error(`🚨 [DEBUG] Error stack:`, error.stack);
                }

                // If it's not the last attempt, continue to retry
                if (attempt < MAX_RETRIES) {
                    console.log(`🚨 [DEBUG] Will retry after delay...`);
                    continue;
                }

                // Last attempt failed
                console.error(`🚨 [DEBUG] FINAL FAILURE: All ${MAX_RETRIES} attempts failed`);
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