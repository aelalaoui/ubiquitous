import WebSocket from "ws"; // Node.js websocket library
import { validateEnv } from "./utils/env-validator";
import { config } from "./config";
import { WebSocketManager, StateChangeEvent } from "./utils/managers/websocketManager";
import { getMintFromSignature } from "./utils/handlers/signatureHandler";
import { getTokenAuthorities, TokenAuthorityStatus } from "./utils/handlers/tokenHandler";
import { buyToken, SniperooHandler } from "./utils/handlers/sniperooHandler";
import { getRugCheckConfirmed } from "./utils/handlers/rugCheckHandler";
import { playSound, sendTelegramMessage } from "./utils/notification";
import { extractTradeEventsFromLogs } from "./utils/decoders/pumpTradeEvent";
import { extractCreateEventsFromLogs } from "./utils/decoders/pumpCreateEvent";
import { onTradeEvent, resolveUntrackedPolicy } from "./utils/handlers/riskProfileHandler";
import { getRisk, initRiskDb, setMigrationOutcome, Verdict } from "./tracker/riskDb";
import { emitCreation, emitMigration, emitSocials } from "./dashboard/events";
import { startDashboard } from "./dashboard/server";
import {
    attachSocials as attachSocialsToStore,
    deleteDev as deleteDevFromStore,
    setCreation as setCreationInStore,
    startPruning as startDevWalletPruning,
    stopPruning as stopDevWalletPruning,
} from "./utils/risk/devWalletStore";
import { fetchSocialsQueued } from "./utils/handlers/tokenSocialsHandler";

// Regional Variables
let activeTransactions = 0;
const MAX_CONCURRENT = config.concurrent_transactions;
const CHECK_MODE = config.checks.mode || "full";
const BUY_PROVIDER = config.token_buy.provider;
const BUY_AMOUNT = config.token_buy.sol_amount;
const SUBSCRIBE_LP = config.liquidity_pool;
const SIM_MODE = config.checks.simulation_mode || false;
const PLAY_SOUND = config.token_buy.play_sound || false;

// Sell Options
const SELL_ENABLED = config.token_sell.enabled || false;
const SELL_STOP_LOSS = config.token_sell.stop_loss_percent || 15;
const SELL_TAKE_PROFIT = config.token_sell.take_profit_percent || 50;

// Initialize Sniperoo Handler
let sniperooHandler: SniperooHandler | null = null;

// Function used to handle the transaction once a new pool creation is found
async function processTransaction(signature: string): Promise<void> {
    console.log("=========================================");
    console.log("🆕 [Process Transaction] New Liquidity Pool signature found");
    console.log("🔍 [Process Transaction] Extracting token CA from signature...\n");
    console.log("https://solscan.io/tx/" + signature);

    /**
     * Extract the token CA from the transaction signature
     */
    const returnedMint = await getMintFromSignature(signature);
    if (!returnedMint) {
        console.log("❌ [Process Transaction] No valid token CA could be extracted");
        console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
        return;
    }

    console.log("✅ [Process Transaction] Token CA extracted successfully");

    /**
     * Output token mint address
     */
    console.log("🪙 GMGN:", `https://gmgn.ai/sol/token/` + returnedMint);
    console.log("🪙 BullX:", `https://neo.bullx.io/terminal?chainId=1399811149&address=` + returnedMint);

    // Send Telegram notification with token information
    const telegramMessage = `🚀 <b>Nouveau Token Détecté!</b>

🪙 <b>Token CA:</b> <code>${returnedMint}</code>
📊 <b>GMGN:</b> https://gmgn.ai/sol/token/${returnedMint}
🔗 <b>Transaction:</b> https://solscan.io/tx/${signature}
📈 <b>BullX:</b> https://neo.bullx.io/terminal?chainId=1399811149&address=${returnedMint}`;

    await sendTelegramMessage(telegramMessage);

    /**
     * Progressive risk profile gate: if pump_risk is enabled we consult the DB row
     * built from observed trades in the 90-98% band instead of hitting rugcheck.xyz.
     */
    let pumpRiskGateTaken = false;
    let migrationVerdict: Verdict | "untracked" = "untracked";
    let migrationReason: string | null = null;

    if (config.pump_risk?.enabled) {
        pumpRiskGateTaken = true;
        const risk = await getRisk(returnedMint);

        const recordDeny = async (reason: string, verdict: Verdict | "untracked" = "deny") => {
            migrationVerdict = verdict;
            migrationReason = reason;
            try { await setMigrationOutcome(returnedMint, false, null, reason); } catch { /* ignore */ }
            emitMigration({ mint: returnedMint, verdict, reason, bought: false });
        };

        if (!risk) {
            const policy = resolveUntrackedPolicy();
            if (policy === "deny") {
                const reason = "no pre-migration risk profile (untracked_policy=deny)";
                console.log(`❌ [Process Transaction] ${reason}, skipping ${returnedMint}`);
                await sendTelegramMessage(`🛑 <b>Deny</b> <code>${returnedMint}</code>\nReason: ${reason}`);
                await recordDeny(reason, "untracked");
                return;
            }
            if (policy === "legacy") {
                console.log("⚠️ [Process Transaction] No risk profile, falling back to legacy rugcheck");
                const ok = await getRugCheckConfirmed(returnedMint);
                if (!ok) {
                    console.log("❌ [Process Transaction] Legacy rugcheck rejected, skipping");
                    await sendTelegramMessage(`🛑 <b>Deny (legacy)</b> <code>${returnedMint}</code>`);
                    await recordDeny("legacy rugcheck rejected", "untracked");
                    return;
                }
                migrationVerdict = "allow";
                migrationReason = "legacy rugcheck passed (untracked policy)";
            } else {
                migrationVerdict = "allow";
                migrationReason = "untracked_policy=allow";
            }
        } else if (risk.verdict !== "allow") {
            const reason = risk.verdict_reason ?? risk.verdict ?? "pending";
            console.log(`❌ [Process Transaction] risk verdict=${risk.verdict} reason=${reason}, skipping`);
            await sendTelegramMessage(
                `🛑 <b>Deny</b> <code>${returnedMint}</code>\n` +
                `Verdict: ${risk.verdict}\nReason: ${reason}\n` +
                `progress=${risk.progress?.toFixed(2)}% trades=${risk.trade_count}`
            );
            await recordDeny(reason, (risk.verdict ?? "pending") as Verdict);
            return;
        } else {
            migrationVerdict = "allow";
            migrationReason = risk.verdict_reason;
            await sendTelegramMessage(
                `✅ <b>Allow</b> <code>${returnedMint}</code>\n` +
                `top1=${risk.top_holder_pct?.toFixed(2)}% dev_bal=${risk.dev_balance_tok?.toFixed(0)} ` +
                `bot_conc=${risk.bot_concentration?.toFixed(2)}% trades=${risk.trade_count}`
            );
        }
    } else if (CHECK_MODE == "snipe") {
        console.log(`🔎 [Process Transaction] Performing ${CHECK_MODE} check`);
        const tokenAuthorityStatus: TokenAuthorityStatus = await getTokenAuthorities(returnedMint);
        if (!tokenAuthorityStatus.isSecure) {
            /**
             * Token is not secure, check if we should skip based on preferences
             */
            const allowMintAuthority = config.checks.settings.allow_mint_authority || false;
            const allowFreezeAuthority = config.checks.settings.allow_freeze_authority || false;

            if (!allowMintAuthority && tokenAuthorityStatus.hasMintAuthority) {
                console.log("❌ [Process Transaction] Token has mint authority, skipping...");
                console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
                return;
            }

            if (!allowFreezeAuthority && tokenAuthorityStatus.hasFreezeAuthority) {
                console.log("❌ [Process Transaction] Token has freeze authority, skipping...");
                console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
                return;
            }
        }
    } else if (CHECK_MODE === "full") {
        /**
         * Perform full check
         */
        if (returnedMint.trim().toLowerCase().endsWith("pump") && config.checks.settings.ignore_ends_with_pump) {
            console.log("❌ [Process Transaction] Token ends with pump, skipping...");
            console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
            return;
        }

        // Check rug check
        const isRugCheckPassed = await getRugCheckConfirmed(returnedMint);
        if (!isRugCheckPassed) {
            console.log("❌ [Process Transaction] Full rug check not passed, skipping...");
            console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
            return;
        }
    }

    /**
     * Perform Swap Transaction
     */
    let buyAttempted = false;
    let buySuccess: boolean | null = null;
    let buyError: string | null = null;

    if (BUY_PROVIDER === "sniperoo" && !SIM_MODE) {
        console.log("🎯 [Process Transaction] Sniping token using Sniperoo...");
        buyAttempted = true;
        const result = await buyToken(returnedMint, BUY_AMOUNT, SELL_ENABLED, SELL_TAKE_PROFIT, SELL_STOP_LOSS);
        buySuccess = !!result;
        if (!result) {
            console.log("❌ [Process Transaction] Token not swapped. Sniperoo failed.");
            console.log("🔁 [Process Transaction] Looking for new Liquidity Pools again\n");
            buyError = "sniperoo buyToken returned falsy";
        } else {
            if (PLAY_SOUND) playSound();
            console.log("✅ [Process Transaction] Token swapped successfully using Sniperoo");
        }
    }

    /**
     * Check if Simulation Mode is enabled in order to output the warning
     */
    if (SIM_MODE) console.log("⚠️ [Process Transaction] Token not swapped! Simulation Mode turned on.");

    // Persist migration outcome and push to dashboard, but only for the pump_risk path.
    if (pumpRiskGateTaken) {
        try {
            await setMigrationOutcome(returnedMint, buyAttempted, buySuccess, buyError);
        } catch (err) {
            console.error("[Process Transaction] setMigrationOutcome failed:", err instanceof Error ? err.message : err);
        }
        emitMigration({
            mint: returnedMint,
            verdict: migrationVerdict,
            reason: migrationReason,
            bought: buyAttempted && buySuccess === true,
            error: buyError,
        });
        // Token has graduated — no need to keep its dev wallet in the live store.
        deleteDevFromStore(returnedMint);
    }
}

// Main function to start the application
async function main(): Promise<void> {
    console.clear();
    console.log("🚀 Starting Solana Token Sniper...");

    // Load environment variables from the .env file
    const env = validateEnv();

    // Initialize the token_risk DB so the first incoming trade doesn't race the schema.
    if (config.pump_risk?.enabled) {
        await initRiskDb();
        console.log("🧠 [Risk] token_risk DB initialized (min_track=" +
            config.pump_risk.min_track_progress + "%, untracked=" +
            config.pump_risk.untracked_policy + ")");
        // Background eviction of stale dev-wallet entries (24h TTL, 1h interval).
        startDevWalletPruning();
    }

    // Start the dashboard HTTP server before opening WSS so connected browsers don't
    // miss the first trades. Railway/Render inject PORT, which takes precedence.
    if (config.dashboard?.enabled) {
        const port = Number(process.env.PORT) || config.dashboard.port;
        try {
            await startDashboard(port);
        } catch (err) {
            console.error("📊 [Dashboard] failed to start:", err instanceof Error ? err.message : err);
        }
    }

    // Initialize SniperooHandler for monitoring positions and orders if API key is available
    let stateInterval: NodeJS.Timeout | null = null;

    if (env.SNIPEROO_API_KEY) {
        console.log("🔗 Initializing Sniperoo monitoring...");
        sniperooHandler = new SniperooHandler(env.SNIPEROO_API_KEY);

        try {
            await sniperooHandler.connect();

            // Display initial state after connection
            setTimeout(() => {
                sniperooHandler?.displayCurrentState();
            }, 3000);

            // Display state every 5 minutes
            stateInterval = setInterval(() => {
                sniperooHandler?.displayCurrentState();
            }, 300000); // 5 minutes

        } catch (error) {
            console.error('❌ Failed to connect to Sniperoo API:', error instanceof Error ? error.message : error);
            console.log('⚠️ Continuing without Sniperoo monitoring...');
        }
    } else {
        console.log('⚠️ SNIPEROO_API_KEY not provided, Sniperoo monitoring disabled');
    }

    // Create WebSocket manager
    const wsManager = new WebSocketManager({
        url: env.HELIUS_WSS_URI,
        initialBackoff: 1000,
        maxBackoff: 30000,
        maxRetries: Infinity,
        debug: false,
    });

    // Set up event handlers
    wsManager.on("connected", () => {
        console.log("✅ [WebSocket] Connected successfully!");

        /**
         * Create a new subscription request for each program ID
         */
        SUBSCRIBE_LP.filter((pool) => pool.enabled).forEach((pool) => {
            const subscriptionMessage = {
                jsonrpc: "2.0",
                id: pool.id,
                method: "logsSubscribe",
                params: [
                    {
                        mentions: [pool.program],
                    },
                    {
                        commitment: "processed", // Can use finalized to be more accurate.
                    },
                ],
            };

            wsManager.send(JSON.stringify(subscriptionMessage));
        });
    });

    wsManager.on("state_change", (state: StateChangeEvent) => {
        console.log(`🔄 [WebSocket] State: ${state.from} -> ${state.to}`);
    });

    wsManager.on("error", (error: Error) => {
        console.error("🚫 [WebSocket] Connection error:", error.message);
    });

    wsManager.on("message", async (parsedData: any) => {
        try {
            // Handle subscription response
            if (parsedData.result !== undefined && !parsedData.error) {
                console.log("✅ Subscription confirmed for ID:", parsedData.id);
                return;
            }

            // Only log RPC errors for debugging
            if (parsedData.error) {
                console.error("🚫 RPC Error:", parsedData.error);
                return;
            }

            // Safely access the nested structure
            const logs = parsedData?.params?.result?.value?.logs;
            const signature = parsedData?.params?.result?.value?.signature;

            // Validate `logs` is an array and if we have a signature

            if (!Array.isArray(logs) || !signature) {
                return;
            }

            // Harvest pump.fun events from the logs. CreateEvent → register the dev
            // wallet in the in-memory store so the eventual risk lookup at 90% is free.
            // TradeEvent → feed the progressive risk profile. Fire-and-forget: we must
            // not block the WSS message loop on per-trade DB writes.
            if (config.pump_risk?.enabled) {
                const createEvents = extractCreateEventsFromLogs(logs);
                for (const ce of createEvents) {
                    setCreationInStore(ce.mint, {
                        dev: ce.user,
                        name: ce.name,
                        symbol: ce.symbol,
                        uri: ce.uri,
                        bondingCurve: ce.bondingCurve,
                    });
                    emitCreation({
                        mint: ce.mint,
                        name: ce.name,
                        symbol: ce.symbol,
                        uri: ce.uri,
                        dev: ce.user,
                        bondingCurve: ce.bondingCurve,
                        capturedAt: Date.now(),
                    });

                    // Background fetch of the metadata JSON to extract twitter / telegram /
                    // website. Fire-and-forget, bounded concurrency. Failure = socials stay null.
                    if (ce.uri) {
                        const mint = ce.mint;
                        const uri = ce.uri;
                        fetchSocialsQueued(uri).then((socials) => {
                            if (!socials) return;
                            attachSocialsToStore(mint, socials);
                            emitSocials({ mint, ...socials });
                        }).catch(() => { /* swallow — non-critical */ });
                    }
                }

                const tradeEvents = extractTradeEventsFromLogs(logs);
                for (const ev of tradeEvents) {
                    onTradeEvent(ev).catch((err) => {
                        console.error("[onTradeEvent] error:", err instanceof Error ? err.message : err);
                    });
                }
            }

            // Verify if this is a new pool creation

            const lookfor  = SUBSCRIBE_LP.filter((pool) => pool.enabled).map((pool) => pool.instruction);
            const containsCreate = lookfor.some( instruction => logs.some(log => log.includes(instruction)));
            if (!containsCreate || typeof signature !== "string") {

                return;
            }
            console.log(signature);

            // Verify if we have reached the max concurrent transactions
            if (activeTransactions >= MAX_CONCURRENT) {
                console.log("⏳ Max concurrent transactions reached, skipping...");
                return;
            }

            // Add additional concurrent transaction
            activeTransactions++;

            // Process transaction asynchronously
            processTransaction(signature)
                .catch((error) => {
                    console.error("Error processing transaction:", error);
                })
                .finally(() => {
                    activeTransactions--;
                });
        } catch (error) {
            console.error("❗ Error processing message:", {
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
            });
        }
    });

    // Start the connection
    wsManager.connect();

    // Handle application shutdown
    const gracefulShutdown = async () => {
        console.log("👋 Shutting down gracefully...");

        if (stateInterval) {
            clearInterval(stateInterval);
        }

        stopDevWalletPruning();

        if (sniperooHandler) {
            await sniperooHandler.disconnect();
        }

        wsManager.disconnect();
        process.exit(0);
    };

    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
}

// Start the application
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
