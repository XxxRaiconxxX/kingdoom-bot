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

## Project Guardrails

- **Environment & Language:** Use Node.js with ES Modules (ESM) syntax (use `import`/`export`, not `require`).
- **Dependencies:** Do not modify or commit `package-lock.json` unless explicitly instructed.
- **Secrets & Configuration:** Never hardcode credentials, tokens, or private API keys. Use the `.env` file and read configuration via `process.env`.
- **Database Consistency:** Database operations must go through `src/supabase.js` or use RPC functions where appropriate to prevent RLS (Row Level Security) issues. Avoid direct raw SQL injections or unvalidated queries.
- **Audit Logs:** Ensure actions modifying user gold, balances, or items are logged correctly via the central audit logging system in `src/auditLog.js`.

## 1. Reglas de Negocio y Lógica de la Economía

### Mecánica de Subastas en WhatsApp
- **Comisión de entrada:** Se cobra una comisión única no reembolsable del 25% del precio base (`start_price`) del ítem al unirse a la subasta por primera vez.
- **Modelo Lock-and-Release:** El oro ofertado por los jugadores no se descuenta de forma permanente durante las pujas intermedias. Se retiene y, al terminar la subasta, se reembolsa a todos los jugadores que no resultaron ganadores, cobrándose únicamente al ganador final.
- **Pujas Acumulativas (WhatsApp Bot):** Las pujas realizadas por WhatsApp a través del comando `!pujar [monto]` se tratan como incrementos acumulativos (ej: si la puja acumulada está en 100,000 y el jugador escribe `!pujar 5000`, la puja acumulada pasa a 105,000). El jugador que no tenga oro suficiente para cubrir el nuevo total acumulado queda descalificado.

## 2. Estructura de la Base de Datos y Supabase (RPCs)

### Tablas Principales
- `players`: Perfil del jugador, contiene `gold`, `phone`, `is_admin`, `banned`.
- `character_sheets`: Ficha de rol del jugador. Usa la columna `playerId` (notar la I mayúscula en camelCase).
- `player_inventory`: Inventario real de objetos del mercado. Usa la columna `player_id` (notar snake_case) y lee por `item_name`.
- `market_auctions`: Registro de subastas activas (`active`, `completed`, `cancelled`).
- `market_auction_bids`: Historial de pujas realizadas por subasta.

### RPCs Clave
- `place_auction_bid(p_player_id, p_auction_id, p_amount)`: RPC de base de datos que encapsula el cobro de la comisión de entrada, las validaciones de saldo y el incremento acumulado del bot de WhatsApp y la web de forma unificada.

## 3. Playbooks (Guías Rápidas)

### Agregar un nuevo Comando al Bot
1. Identifica la categoría del comando (ej: administrativo, juego, perfil).
2. Crea la función manejadora o agrégala en el archivo correspondiente dentro de `src/handlers/`.
3. Registra el comando y su patrón regex de coincidencia en el despachador de mensajes dentro de `src/index.js`.
4. Documenta el comando y su uso en el archivo central de ayuda del bot.

### Modificar Lógica de Juegos y Minijuegos
- Edita `src/handlers/blackjack.js` o `src/handlers/games.js` según corresponda. Asegúrate de verificar siempre si el usuario tiene saldo de oro suficiente antes de permitir que inicie una partida y de registrar los resultados en la base de datos de Supabase.

## 4. Convenciones de Mensajería en WhatsApp

- **Formato de Texto:** Utilizar el formato de negrita de WhatsApp (`*texto*`) para destacar montos de oro, nombres de ítems y comandos.
- **Diseño Limpio:** Evitar bloques de texto demasiado extensos. Usar saltos de línea para estructurar la respuesta del bot de manera legible.
- **Sin Separadores Excesivos:** Evitar el uso reiterado de guiones o líneas horizontales decorativas (como `------------------------`) en los mensajes de respuesta del bot.

## 5. Validación y Verificación

- Ejecutar `node --check src/index.js` o sintaxis de Node para comprobar que no existan errores de código antes de realizar un commit.
- Utilizar scripts de prueba (ej: `test_blackjack.js`) en la carpeta raíz para validar cambios en las mecánicas de juegos de forma aislada.
- Revisar siempre que los errores y excepciones asíncronas estén capturados con bloques `try/catch` para evitar caídas inesperadas del cliente de WhatsApp Web.
