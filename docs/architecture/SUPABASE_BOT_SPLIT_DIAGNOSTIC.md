# Diagnostico de Separacion Supabase para `kingdoom-bot`

Fecha: 2026-06-19
Autor: Codex

## Objetivo

Definir si conviene mover `kingdoom-bot` a otro proyecto de Supabase y, en caso de hacerlo, que partes deben:

- quedarse en el proyecto principal compartido con `Kingdoom-sync`
- migrarse a un proyecto separado del bot
- volverse cache local o persistencia ligera fuera de la base principal

## Veredicto Ejecutivo

No conviene una migracion total inmediata del bot a otro proyecto Supabase.

Si el objetivo es bajar egress y presion sobre la base actual, la mejor opcion es una separacion parcial:

1. Mantener en el proyecto principal toda la economia y el estado compartido con la web.
2. Mover a un proyecto separado del bot solo el estado operativo y ruidoso del bot.
3. Reducir antes de migrar las lecturas repetidas en `players`, `knowledge_documents`, `realm_missions` y `realm_events`.

## Hallazgos del Repo

Acoplamiento actual del bot a Supabase:

- `src/supabase.js` exporta 35+ helpers.
- Hay 64 accesos directos a tablas via `.from(...)`.
- Hay 8 RPCs criticas.
- Hay realtime de subastas via `postgres_changes`.

Archivos mas acoplados:

- `src/index.js`
- `src/scheduler.js`
- `src/handlers/player.js`
- `src/handlers/games.js`
- `src/handlers/admin.js`
- `src/handlers/auctions.js`
- `src/handlers/auctionsRealtime.js`
- `src/handlers/treasure.js`
- `src/gmTracker.js`
- `src/tracker.js`

## Clasificacion por Dominio

### 1. Nucleo compartido con la web: debe quedarse en el proyecto principal

Estas tablas y RPCs alimentan la misma economia que usa `Kingdoom-sync`. Separarlas rompe consistencia o exige reescribir tambien la web.

Tablas:

- `players`
- `character_sheets`
- `player_inventory`
- `market_items`
- `market_auctions`
- `market_auction_bids`
- `realm_missions`
- `realm_events`

RPCs:

- `increment_gold`
- `place_auction_bid`
- `withdraw_from_auction`
- `resolve_market_auction`
- `award_manual_mission_rank_points`
- `process_market_installments`

Funciones del bot que dependen de este nucleo:

- `getPlayersByPhone`
- `getPlayer`
- `findPlayerByIdentifier`
- `verifyAndLinkPlayer`
- `getLeaderboard`
- `getGoldLeaderboard`
- `getMarketItems`
- `searchMarketItems`
- `getMarketItemDetails`
- `getRealmSnapshot`
- `getLinkStatusByWhatsapp`
- `getStaffSnapshot`
- `getActiveMissions`
- `getMissionDetails`
- `getActiveEvents`
- `getEventDetails`
- `updateGold`
- `awardManualMissionRankPoints`
- `registerPlayer`
- `getRealmCensus`
- `getPlayerSheet`
- `getPlayerInventory`
- `touchPlayerActivity`
- `getActivityReport`
- `getMissionByShortId`

Conclusion:

Este bloque no se deberia mover en una primera fase si `Kingdoom-sync` sigue apuntando al Supabase actual.

### 2. Estado operativo del bot: candidato principal para mover a un Supabase del bot

Este estado es util para el bot, pero no es fuente de verdad para la web.

Tablas:

- `bot_daily_claims`
- `bot_treasure_events`
- `bot_treasure_claims`
- `bot_active_missions`

Funciones asociadas:

- `createTreasureEvent`
- `getOpenTreasureEvents`
- `expireTreasureEvent`
- `getTreasureClaims`
- `claimTreasureReward`
- `claimDailyReward`
- `hasClaimedDailyReward`
- `getDadosUsage`
- `incrementDadosUsage`
- `getBlackjackUsage`
- `incrementBlackjackUsage`
- `getCofreUsage`
- `incrementCofreUsage`
- `getTrampaUsage`
- `incrementTrampaUsage`
- `getRestrictedGroupCommandViolationsForDay`
- `getRestrictedGroupCommandSummaryForDay`
- `recordRestrictedGroupCommandViolation`
- `saveActiveMissionState`
- `getActiveMissionsFromDb`
- `deleteResolvedMission`

Conclusion:

Este es el mejor candidato para una migracion parcial. Si se mueve a otro proyecto Supabase, el bot descargaria gran parte de su ruido operativo fuera de la base principal sin tocar la economia compartida.

### 3. Contenido / lore: mantener por ahora, pero reducir lecturas

Tabla:

- `knowledge_documents`

Funciones asociadas:

- `getKnowledgeDocuments`
- `upsertKnowledgeDocument`
- `pickKnowledgeContext`
- `getFormattedEncyclopedia`
- `getFormattedGrimoire`
- `tracker.js` usa `knowledge_documents` como storage auxiliar para pendientes

Conclusion:

No recomiendo moverlo en la primera fase si el lore tambien lo consulta la web o herramientas del staff. Pero si el mayor ruido proviene del comando `!oraculo`, conviene cachear fuerte este bloque antes de pensar en migrarlo.

## Mapa de Migracion Recomendado

### Fase 0: optimizacion previa obligatoria

Antes de separar proyectos, conviene bajar la presion actual:

- cache mas agresiva de `getPlayer(...)` y `getPlayersByPhone(...)`
- cache de `getKnowledgeDocuments(...)`
- cache de `getActiveMissions(...)` y `getActiveEvents(...)`
- evitar que `!oraculo` recargue siempre:
  - documentos
  - ficha
  - inventario
  - misiones
  - eventos
- revisar `auctionsRealtime.js` para evitar lecturas extra por cada evento si el payload ya trae datos suficientes

### Fase 1: split parcial del bot

Crear un segundo proyecto Supabase solo para estado bot.

Mover:

- `bot_daily_claims`
- `bot_treasure_events`
- `bot_treasure_claims`
- `bot_active_missions`

Mantener:

- todo lo economico
- `players`
- `market_*`
- `character_sheets`
- `player_inventory`
- `realm_*`
- `knowledge_documents`

Cambios de codigo esperados:

- dividir `src/supabase.js` en dos clientes:
  - `coreSupabase`
  - `botSupabase`
- redirigir las funciones de uso diario, tesoro y tracking de misiones al cliente del bot
- mantener `updateGold(...)`, subastas y snapshots en el cliente principal

Riesgo:

- bajo a medio
- no requiere migrar `Kingdoom-sync`

### Fase 2: reevaluacion del lore y caches

Si aun asi el bot sigue cargando demasiado:

- mover `knowledge_documents` a lectura cacheada local con refresh periodico
- o replicar una version reducida del contexto del oraculo en storage local del bot

Riesgo:

- medio
- podria introducir desfasaje entre lore actualizado y respuestas del bot si no se diseña un refresh claro

### Fase 3: migracion total solo si la web tambien cambia

Solo tiene sentido si decides separar toda la economia del bot y la web.

Eso implicaria:

- mover tablas core compartidas
- recrear RPCs
- mover realtime
- repuntar `Kingdoom-sync`
- validar consistencia total de oro, subastas, mercado y ranking

Riesgo:

- alto
- no recomendado como primer movimiento

## Cambios de Arquitectura Minimos para un Split Parcial

### Variables de entorno nuevas

Se necesitarian dos bloques:

- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` para el proyecto principal
- `BOT_SUPABASE_URL` / `BOT_SUPABASE_SERVICE_KEY` para el proyecto del bot

### Refactor recomendado

Separar helpers por dominio:

- `src/supabase-core.js`
- `src/supabase-bot-state.js`
- `src/supabase.js` como facade o punto de exportacion unificado

Esto permitiria migrar por funciones sin reescribir todos los handlers de una vez.

## Coste / Beneficio

### Beneficio alto

- bajar presion del bot sobre el proyecto principal
- aislar cooldowns, faltas, tesoros y estados GM
- no tocar la economia central en la primera fase

### Coste controlado

- SQL nuevo para 4 tablas del bot
- 1 cliente Supabase adicional
- refactor moderado de helpers

### Lo que no arregla por si solo

- lecturas excesivas de `players`
- `!oraculo` si sigue cargando demasiado contexto por mensaje
- subastas realtime si se disparan mucho

## Recomendacion Final

Si confirmamos que `kingdoom-bot` es el principal consumidor, la mejor jugada es:

1. optimizar lecturas primero
2. hacer split parcial del estado del bot
3. dejar la economia compartida donde esta

No recomiendo una migracion completa del bot a otro proyecto Supabase mientras `Kingdoom-sync` siga usando el proyecto actual como fuente de verdad.

## Siguiente Paso Propuesto

Preparar un plan de implementacion del split parcial en tres entregas:

1. crear cliente dual y env vars
2. mover tablas `bot_*` y `bot_daily_claims`
3. validar comandos afectados:
   - `!cofre`
   - `!trampa`
   - `!21`
   - `!dados`
   - `!faltasgrupo`
   - tesoro errante
   - GM tracker
