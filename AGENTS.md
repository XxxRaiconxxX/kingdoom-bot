# Kingdoom Bot Agent Context

Use this file as local guidance for Jules, Codex, Antigravity, and other AI coding agents working in this repository.

## Project Overview

Kingdoom Bot is a WhatsApp bot designed for group gaming economy, minigames, and virtual auctions. It integrates with WhatsApp Web and uses a Supabase database for persistent state and audit logs.

## Repository Architecture

All source files are located in the `src/` directory:
- `src/index.js`: Main entry point. Initializes `whatsapp-web.js` client, setups database connections, and routes incoming messages to handlers.
- `src/supabase.js`: Wrapper for Supabase client database operations and Remote Procedure Calls (RPC).
- `src/scheduler.js`: Scheduled cron jobs for automated system events (daily limits, auction closings, event cleanups).
- `src/handlers/`: Modular message handlers grouped by command category:
  - `admin.js`: Game Master (GM) and Administrator tools.
  - `auctions.js` & `auctionsRealtime.js`: Auction bidding mechanics, lock-and-release currency holding, and commission handling.
  - `blackjack.js`: Complete Blackjack card game mechanics.
  - `games.js`: General minigames and player commands.
  - `marketForge.js`: Economy crafting, item upgrading, and forge shops.
  - `player.js`: Player profiles, balance queries, item usage, and inventory.
  - `treasure.js`: Treasure chest drops and event notifications.
  - `welcome.js`: Welcome animations and messages for new group participants.
- `src/activeProfileStore.js` & `src/adminStore.js`: Memory storage for active session caches.

## Coding Guardrails

- **Environment & Language:** Use Node.js with ES Modules (ESM) syntax (use `import`/`export`, not `require`).
- **Dependencies:** Do not modify or commit `package-lock.json` unless explicitly instructed.
- **Secrets & Configuration:** Never hardcode credentials, tokens, or private API keys. Use the `.env` file and read configuration via `process.env`.
- **Database Consistency:** Database operations must go through `src/supabase.js` or use RPC functions where appropriate to prevent RLS (Row Level Security) issues. Avoid direct raw SQL injections or unvalidated queries.
- **Audit Logs:** Ensure actions modifying user gold, balances, or items are logged correctly via the central audit logging system in `src/auditLog.js`.

## Validation & Testing

- Run `node --check src/index.js` or syntax checks on modified files before committing.
- Make sure to review changed handlers with test scripts (e.g. `test_blackjack.js`) when available.
- Double-check error handling within callbacks and asynchronous flows to prevent bot crashes.
