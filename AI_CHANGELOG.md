# AI Collaboration Log & Project Context - Kingdoom Bot

Este archivo sirve como registro de actividad y contexto operativo para el repositorio `kingdoom-bot`.

## Historial de Cambios (Changelog)

### [Fecha: 17/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/adminStore.js`, `src/scheduler.js`, `src/handlers/admin.js`, `src/handlers/welcome.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Corrección de envíos de mensajes privados a usuarios verificados desde Comunidades de WhatsApp (Soporte para nodos `@lid`).
*   **Cambios Clave:**
    *   **[Core - JID Helper]:** Se agregó una función heurística `formatJid` en `adminStore.js` que evalúa la longitud del número de teléfono. Si tiene >= 15 dígitos, asume que es un Local ID encriptado de Comunidad y le añade el sufijo `@lid`. De lo contrario, usa `@c.us`.
    *   **[Core - Notificaciones]:** Se implementó `formatJid` en `sendToAll` dentro de `scheduler.js`, permitiendo que el mensaje diario/semanal llegue a los IDs enmascarados que fallaban silenciosamente.
    *   **[Core - Admin]:** Se aplicó el formato dinámico a los comandos `!registrar` y `!kick`.
    *   **[Core - Welcome]:** Se adaptó `normalizeWhatsappId` en `welcome.js` para retener explícitamente el sufijo `@lid` si un jugador ya entra con ese sufijo desde un grupo de comunidad.
*   **Notas/Advertencias:** La regla de >= 15 dígitos funciona perfectamente para la región actual del juego (donde los números reales tienen un máximo de 12 a 13 dígitos). Si en el futuro entra un país con una longitud de número E.164 válida de 15 dígitos, la heurística deberá refinarse.

### [Fecha: 17/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/games.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Implementación de soporte para multiplicadores (`xN`) en los comandos `!cofre` y `!trampa`.
*   **Cambios Clave:**
    *   **[Bot - Base de datos]:** Se actualizó `incrementBotUsageCount`, `incrementCofreUsage` y `incrementTrampaUsage` para admitir operaciones en bloque mediante un nuevo parámetro `amount`.
    *   **[Bot - Juegos]:** `handleCofre` y `handleTrampa` ahora extraen un multiplicador con formato `x[N]`. Se agrupan las tiradas en un bucle interno, respetando los límites de usos diarios, consolidando la respuesta enviada por WhatsApp y sumando o descontando el oro de forma atómica en un único paso.
    *   **[Bot - Validación Financiera]:** Se agregó un freno preventivo en `!trampa` que deniega el comando completo si el jugador no posee suficiente oro para costear el total combinado (`apuesta * N`).
*   **Notas/Advertencias:** Ninguna detectada.

### [Fecha: 16/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `src/index.js`, `src/scheduler.js`, `src/handlers/auctionsRealtime.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Optimizacion de carga PostgREST para reducir presion sobre Supabase desde el bot.
*   **Cambios Clave:**
    *   **[Bot - Supabase]:** Se anadio timeout global para requests del cliente Supabase y una cache corta para `getPlayersByPhone(...)`, reduciendo consultas repetidas a `players`.
    *   **[Bot - Lecturas de players]:** Se reemplazaron varios `select('*')` por columnas minimas en resolucion por telefono, busqueda por identificador y snapshots operativos.
    *   **[Bot - Index]:** Se reutiliza una sola lectura de perfiles del remitente por mensaje para el touch de actividad y la validacion admin, evitando doble consulta al mismo telefono.
    *   **[Bot - Scheduler]:** Se agregaron guardas anti-solapamiento para cron jobs, limite de lotes al barrido de subastas expiradas y se evitan ciclos concurrentes cuando una ejecucion previa sigue viva.
    *   **[Bot - Realtime]:** Las pujas en tiempo real ahora resuelven datos en paralelo y consultan solo las columnas necesarias de `market_auctions`.
*   **Notas/Advertencias:** La optimizacion reduce egress y consultas redundantes, pero el proyecto sigue sensible por estar en compute Nano y cerca del limite de egress. Conviene observar el arranque de Hugging Face con el bot solo durante unos minutos antes de retomar uso normal.

### [Fecha: 15/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/admin.js`, `src/handlers/player.js`, `src/index.js`, `src/supabase.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Integracion operativa del comando `!misioncompleta` para otorgar puntos manuales de clasificatoria desde WhatsApp.
*   **Cambios Clave:**
    *   **Permisos:** Se habilito `!misioncompleta` para staff y administradores, con validacion combinada por owner/admin/staff y perfiles admin en base de datos.
    *   **Resolucion de jugadores:** El comando exige menciones reales, resuelve cada telefono contra `players`, y cancela si detecta menciones sin vinculo o perfiles ambiguos.
    *   **Blindaje anti-duplicado:** Se usa un `externalRef` derivado del chat y del identificador del mensaje para evitar dobles otorgamientos del mismo comando.
    *   **Supabase:** Se conecto la llamada RPC a `award_manual_mission_rank_points(...)` para registrar premios manuales en `season_rank_awards`.
    *   **Ayuda del bot:** Se anadio el comando a los menus visibles de admin/staff.
*   **Notas/Advertencias:** La funcionalidad depende de que `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y la funcion SQL `award_manual_mission_rank_points(...)` existan y esten activas en el entorno desplegado.

### [Fecha: 14/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/admin.js`
*   **Resumen de Tareas:** Inclusion de perfiles web no vinculados en el reporte `!actividad` para auditoria y purga.
*   **Cambios Clave:**
    *   **[Bot - Registro de Actividad]:** Se actualizo la funcion `verifyAndLinkPlayer` en `src/supabase.js` para que registre `last_active_at` al momento de vincularse.
    *   **[Bot - Reporte de Actividad]:** Se elimino el filtro `.not('phone', 'is', null)` en `getActivityReport` para volver a incluir las cuentas creadas en la web que aun no estan enlazadas a WhatsApp. Se selecciono la columna `phone` en la consulta.
    *   **[Bot - Formateo de Actividad]:** Se modifico el bucle de impresion en `src/handlers/admin.js` para que detecte si un usuario no tiene telefono vinculado (`!p.phone`) y le asigne el estado `Sin WA`. Esto permite a los administradores diferenciar de inmediato las cuentas web inactivas de las vinculadas y realizar la auditoria/limpieza de forma segura.
*   **Notas/Advertencias:** Validacion de sintaxis de Node exitosa en ambos archivos modificados.

### [Fecha: 19/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/games.js`, `src/handlers/player.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Ajuste operativo de minijuegos del bot y nueva variante `x4` para `!dados`.
*   **Cambios Clave:**
    *   **`!dados x4`:** El comando ahora acepta `!dados <monto> x4` o `!dados x4 <monto>`. En este modo el jugador solo gana si la suma de los dados da exactamente `7`, y el premio neto sube a `x4`.
    *   **Compensación Simple:** `!dados`, `!cofre` y `!trampa` ahora comparten un helper que intenta revertir el cambio de oro si el incremento del contador diario falla después del cobro/pago.
    *   **Saldo Reportado:** Tras resolver la jugada, el bot relee el perfil y muestra el oro actualizado real, en vez de depender siempre del cálculo local previo al await.
*   **Notas/Advertencias:** El blindaje del bot mejora la consistencia, pero sigue siendo recomendable llevar estos minijuegos a una RPC transaccional única si se quiere eliminar por completo cualquier ventana entre oro y uso diario.
