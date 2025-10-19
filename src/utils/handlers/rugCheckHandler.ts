import axios from "axios";
import dotenv from "dotenv";
import { config } from "../../config";
import { RugResponseExtended, NewTokenRecord } from "../types";
import { insertNewToken, selectTokenByNameAndCreator } from "../../tracker/db";

// Load environment variables from the .env file
dotenv.config();

/**
 * Checks if a token passes all rug check criteria
 * @param tokenMint The token's mint address
 * @returns Promise<boolean> indicating if the token passes all checks
 */
export async function getRugCheckConfirmed(tokenMint: string): Promise<boolean> {
    try {
        const rugResponse = await axios.get<RugResponseExtended>(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`, {
            timeout: config.axios.get_timeout,
        });

        if (!rugResponse.data) return false;

        // For debugging purposes, log the full response data
        if (config.checks.verbose_logs) {
            console.log("[ Rug Check Handler ] Rug check response data:", rugResponse.data);
        }

        // Extract information from the token report
        const tokenReport: RugResponseExtended = rugResponse.data;
        const tokenCreator = tokenReport.creator ? tokenReport.creator : tokenMint;
        const mintAuthority = tokenReport.token.mintAuthority;
        const freezeAuthority = tokenReport.token.freezeAuthority;
        const isInitialized = tokenReport.token.isInitialized;
        const tokenName = tokenReport.tokenMeta.name;
        const tokenSymbol = tokenReport.tokenMeta.symbol;
        const tokenMutable = tokenReport.tokenMeta.mutable;
        let topHolders = tokenReport.topHolders;
        const marketsLength = tokenReport.markets ? tokenReport.markets.length : 0;
        const totalLPProviders = tokenReport.totalLPProviders;
        const isRugged = tokenReport.rugged;
        const rugScore = tokenReport.score;

        // Update topholders if liquidity pools are excluded
        if (config.checks.settings.exclude_lp_from_topholders) {
            // local types
            type Market = {
                liquidityA?: string;
                liquidityB?: string;
            };

            const markets: Market[] | undefined = tokenReport.markets;
            if (markets) {
                // Safely extract liquidity addresses from markets
                const liquidityAddresses: string[] = (markets ?? [])
                    .flatMap((market) => [market.liquidityA, market.liquidityB])
                    .filter((address): address is string => !!address);

                // Filter out topHolders that match any of the liquidity addresses
                topHolders = topHolders.filter((holder) => !liquidityAddresses.includes(holder.address));
            }
        }

        // Get config settings
        const rugCheckSettings = config.checks.settings;

        // Set conditions for token validation
        const conditions = [
            {
                check: !rugCheckSettings.allow_mint_authority && mintAuthority !== null,
                message: "🚫 Mint authority should be null",
            },
            {
                check: !rugCheckSettings.allow_not_initialized && !isInitialized,
                message: "🚫 Token is not initialized",
            },
            {
                check: !rugCheckSettings.allow_freeze_authority && freezeAuthority !== null,
                message: "🚫 Freeze authority should be null",
            },
            {
                check: !rugCheckSettings.allow_mutable && tokenMutable !== false,
                message: "🚫 Mutable should be false",
            },
            {
                check: !rugCheckSettings.allow_insider_topholders && topHolders.some((holder) => holder.insider),
                message: "🚫 Insider accounts should not be part of the top holders",
            },
            {
                check: topHolders.some((holder) => holder.pct > rugCheckSettings.max_allowed_pct_topholders),
                message: "🚫 An individual top holder exceeds more than the allowed percentage of the total supply",
            },
            {
                check: totalLPProviders < rugCheckSettings.min_total_lp_providers,
                message: "🚫 Not enough LP Providers.",
            },
            {
                check: marketsLength < rugCheckSettings.min_total_markets,
                message: "🚫 Not enough Markets.",
            },
            {
                check: !rugCheckSettings.allow_rugged && isRugged,
                message: "🚫 Token is marked as rugged",
            },
            {
                check: rugCheckSettings.max_score > 0 && rugScore > rugCheckSettings.max_score,
                message: "🚫 Rug score exceeds maximum allowed score",
            },
            {
                check: rugCheckSettings.block_symbols.includes(tokenSymbol),
                message: "🚫 Token symbol is in the blocked symbols list",
            },
            {
                check: rugCheckSettings.block_names.includes(tokenName),
                message: "🚫 Token name is in the blocked names list",
            },
            {
                check: rugCheckSettings.ignore_ends_with_pump && (tokenName.toLowerCase().endsWith("pump") || tokenSymbol.toLowerCase().endsWith("pump")),
                message: "🚫 Token name or symbol ends with 'pump'",
            },
            {
                check: tokenReport.markets && tokenReport.markets.some((market) => {
                    const liquidityValue = market.liquidity || 0;
                    return liquidityValue < rugCheckSettings.min_total_market_liquidity;
                }),
                message: "🚫 Market liquidity is below minimum required amount",
            },
        ];

        // Check for duplicate tokens if tracking is enabled
        if (rugCheckSettings.block_returning_token_names || rugCheckSettings.block_returning_token_creators) {
            try {
                // Get duplicates based on token name and creator
                const duplicate = await selectTokenByNameAndCreator(tokenName, tokenCreator);

                // Verify if duplicate token or creator was returned
                if (duplicate.length !== 0) {
                    if (rugCheckSettings.block_returning_token_names && duplicate.some((token) => token.name === tokenName)) {
                        console.log("🚫 Token with this name was already created");
                        return false;
                    }
                    if (rugCheckSettings.block_returning_token_creators && duplicate.some((token) => token.creator === tokenCreator)) {
                        console.log("🚫 Token from this creator was already created");
                        return false;
                    }
                }
            } catch (error) {
                console.error("Error checking for duplicate tokens:", error);
                // Continue with other checks even if this one fails
            }
        }

        // Create new token record for tracking
        const newToken: NewTokenRecord = {
            time: Date.now(),
            mint: tokenMint,
            name: tokenName,
            creator: tokenCreator,
        };

        try {
            await insertNewToken(newToken);
        } catch (err) {
            if (rugCheckSettings.block_returning_token_names || rugCheckSettings.block_returning_token_creators) {
                console.error("🚫 Unable to store new token for tracking duplicate tokens:", err);
            }
            // Continue with other checks even if this one fails
        }

        // Validate all conditions
        for (const condition of conditions) {
            if (condition.check) {
                console.log(condition.message);
                return false;
            }
        }

        return true;

    } catch (error) {
        console.error(`Error during rug check: ${tokenMint}`, error);
        return false;
    }
}
