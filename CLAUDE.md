# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Solana token trading bot that monitors blockchain events for new liquidity pool creation, validates tokens against security criteria, and executes swaps automatically. It supports multiple execution providers and includes position management with take-profit/stop-loss.

## Commands

```bash
npm run dev          # Development with auto-reload (ts-node)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (node dist/index.js)
npm run watch        # Watch mode TypeScript compilation
```

Docker:
```bash
docker build -t solana-bot .
docker-compose up
```

Deployment: `railway up --detach` (Railway CLI)

## Architecture

**Core pipeline** (`src/index.ts` → handlers → execution):

1. **WebSocket** (`src/utils/managers/websocketManager.ts`) — Helius RPC WebSocket with EventEmitter pattern, exponential backoff reconnect (1s–30s), state machine: DISCONNECTED → CONNECTING → CONNECTED
2. **Signature Handler** (`src/utils/handlers/signatureHandler.ts`) — Extracts token mint address from raw transaction signatures
3. **Token Handler** (`src/utils/handlers/tokenHandler.ts`) — Queries mint/freeze authority via `@solana/spl-token`
4. **Rug Check Handler** (`src/utils/handlers/rugCheckHandler.ts`) — Validates tokens against rugcheck.xyz API; three modes controlled by `config.ts`:
   - `"none"` — skip all checks
   - `"snipe"` — authority checks only
   - `"full"` — full rug check API call
5. **Sniperoo Handler** (`src/utils/handlers/sniperooHandler.ts`) — Socket.IO-based primary execution + position monitoring with auto-sell
6. **ALEMBEX Handler** (`src/utils/handlers/alembexHandler.ts`) — Pure-TS mathematical bet-sizing sequence; closes after 2 consecutive wins, resets on loss

**Data:** `src/tracker/db.ts` — SQLite (via `sqlite` promise wrapper) tracks discovered tokens to prevent duplicate processing.

**Configuration:** `src/config.ts` — single source of truth for all behavior: pool program IDs (Pump.fun, Raydium), swap amounts, slippage, concurrency limit, security mode, rug check thresholds.

**Environment:** `src/utils/env-validator.ts` — validates required vars at startup (throws on missing Helius URLs); `SNIPEROO_API_KEY` is optional with graceful degradation.

**Types:** `src/utils/types.ts` — TypeScript interfaces for all external API response shapes.

**Notifications:** `src/utils/notification.ts` — Telegram alerts and sound notifications.

## Key Conventions

- Logging uses emoji-prefixed `console.log` with ISO timestamps and separator lines between pipeline stages
- Transaction processing is async with a configurable concurrency limit (default: 1) in `config.ts`
- RPC fetches retry up to 3 times with a 2-second delay
- All external API calls use `axios` with explicit timeouts
- Module system is CommonJS (`"module": "commonjs"` in tsconfig), targeting ES2020

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `HELIUS_HTTP_URL` / `HELIUS_WSS_URL` — required Helius RPC endpoints
- `SNIPEROO_API_KEY` — optional; enables Sniperoo execution
- Telegram bot credentials for notifications

Required Node.js >= 20.18.0.
