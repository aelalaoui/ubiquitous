// configs > config
export const config = {
    liquidity_pool: [
        {
            enabled: true,
            id: "pump1",
            name: "pumpswap",
            program: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
            instruction: "Program log: Instruction: CreatePool",
        },
        {
            enabled: false,
            id: "rad1",
            name: "Raydium",
            program: "6EFBrrcethRSDBkzoznN8uv78hRvfcKJubJ14MSuBEwF6P",
            instruction: "Program log: initialize2: InitializeInstruction2",
        },
    ],

    concurrent_transactions: 1, // Number of simultaneous transactions
    wsol_pc_mint: "So11111111111111111111111111111111111111112",

    db: {
        pathname: "src/tracker/tokens.db", // Sqlite Database location
    },

    token_buy: {
        provider: "sniperoo",
        sol_amount: 1, // Amount of SOL to spend
        play_sound: true, // Works only on windows
        play_sound_text: "Order Filled!",
    },

    token_sell: {
        enabled: true, // If set to true, the bot will sell the token via Sniperoo API
        stop_loss_percent: 15,
        take_profit_percent: 5,
    },

    checks: {
        simulation_mode: false,
        mode: "none", // snipe=Minimal Checks, full=Full Checks based on Rug Check, none=No Checks
        verbose_logs: true,
        settings: {
            // Dangerous (Checked in snipe mode)
            allow_mint_authority: false, // The mint authority is the address that has permission to mint (create) new tokens
            allow_freeze_authority: false, // The freeze authority is the address that can freeze token transfers, effectively locking up funds

            // Critical
            max_allowed_pct_topholders: 50, // Max allowed percentage an individual topholder might hold
            exclude_lp_from_topholders: true, // If true, Liquidity Pools will not be seen as top holders
            block_returning_token_names: true,
            block_returning_token_creators: true,
            allow_insider_topholders: false, // Allow insider accounts to be part of the topholders
            allow_not_initialized: false, // This indicates whether the token account is properly set up on the blockchain.
            allow_rugged: false,
            allow_mutable: false,
            block_symbols: ["XXX"],
            block_names: ["XXX"],

            // Warning
            min_total_lp_providers: 999,
            min_total_markets: 999,
            min_total_market_liquidity: 5000,

            // Misc
            ignore_ends_with_pump: true,
            max_score: 1, // Set to 0 to ignore
        },
    },
    axios: {
        get_timeout: 10000, // Axios request timeout in milliseconds
    },

    dashboard: {
        enabled: true,
        port: 3000,
        auth_required: false, // in prod (NODE_ENV=production), auth is auto-forced
    },

    pump_risk: {
        enabled: true,
        min_track_progress: 90,        // below this %, decoded trades are discarded
        refresh_at_progress: 98,       // re-run top holder + dev metrics once this % is crossed
        untracked_policy: "deny" as "deny" | "legacy" | "allow",
        rpc_concurrency: 4,
        thresholds: {
            top1_deny: 20,              // top-1 holder % (excluding bonding curve PDA)
            top1_warn: 10,              // informational only
            dev_balance_zero_deny: true,
            dev_sold_pct_deny: 50,      // informational (dev_sold_pct not computed in V1)
            dev_holds_pct_warn: 15,     // informational only
            bot_concentration_deny: 60, // % of buys from top-5 wallets
            min_buys_for_concentration: 20, // minimum observed buys before concentration/verdict is trusted
            unique_buyers_min_last10: 3,
            curve_regression_deny: true,
            curve_regression_drop_pct: 3, // flag when drawdown from peak >= this (in progress points)
        },
    },
}