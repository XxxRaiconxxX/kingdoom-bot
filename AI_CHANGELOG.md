# AI Collaboration Log & Project Context - Kingdoom Bot

Este archivo sirve como registro de actividad y contexto operativo para el repositorio `kingdoom-bot`.

## Historial de Cambios (Changelog)

### [Fecha: 03/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/adminStore.js`, `src/supabase.js`, `src/scheduler.js`, `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Soporte para LIDs de 14 dígitos en JIDs, cambio de la ventana por defecto a 7 días y adición de lógica de auto-desbloqueo en el scheduler.
*   **Cambios Clave:**
    *   **[LID - Soporte]:** Se cambió el umbral de longitud en `formatJid()` de 15 a 14. Esto permite que los identificadores de Line Identity (LIDs) de 14 dígitos se formateen correctamente con `@lid` en vez de `@c.us`, evitando el error `No LID for user` en la cola del scheduler.
    *   **[Días de Roleo - Defaults]:** Se corrigió la ventana por defecto a `7` días (en lugar de `9` días en `src/supabase.js`).
    *   **[Lógica - Auto-desbloqueo]:** Se añadió una rama en `processRoleplayAccessEnforcement()` para que el scheduler limpie automáticamente el bloqueo (`locked_at = null`) de los jugadores que se encuentren dentro del umbral de días permitido tras una reevaluación de inactividad de rol.
    *   **[Notificaciones]:** El scheduler ahora encola avisos automáticos de acceso restaurado (`newlyUnlocked`) cuando un jugador es desbloqueado por la reevaluación del scheduler.
    *   **[Configuración]:** `ROLEPLAY_ACTIVITY_GROUP_ID` en `src/index.js` ahora es configurable a través de variables de entorno, con fallback al JID canónico.
*   **Notas/Advertencias:** Validado con `node --check` para todos los archivos modificados.
### [Fecha: 03/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/supabase.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Fix urgente del gate de comandos por roleo para respetar gracia vigente y exenciones.
*   **Cambios Clave:**
    *   **[Bot - Roleplay Gate]:** el bloqueo de comandos ahora usa una evaluacion efectiva centralizada: exencion activa permite comandos, gracia vigente permite comandos aunque exista un `locked_at` viejo, y los locks manuales/automaticos solo bloquean cuando no hay gracia vigente.
    *   **[Consistencia]:** `index.js` dejo de decidir solo por `locked_at && !is_exempt` y reutiliza la misma semantica base que el enforcement de Supabase.
*   **Notas/Advertencias:** Validacion: `node --check src/index.js`, `node --check src/supabase.js` y prueba aislada del helper de lock pasaron correctamente.

### [Fecha: 01/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Auditoria y hardening del gate de comandos por roleo.
*   **Cambios Clave:**
    *   **[Bot - Staff/Admin]:** los comandos bloqueados por roleo ahora fuerzan el calculo de privilegios antes del gate, evitando que staff/admin dependan del estado `player_roleplay_access` para ejecutar herramientas recreativas/economicas.
    *   **[Trazabilidad]:** se reparo `ai-memory/kingdoom-memory.jsonl` para reemplazar saltos literales por lineas JSONL reales tras el rebase.
*   **Notas/Advertencias:** Validacion: `node --check src/index.js`, `node --check src/supabase.js`, `node --check src/scheduler.js`, `node --check src/handlers/admin.js` y parseo JSONL pasaron correctamente.

### [Fecha: 01/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/scheduler.js`, `src/supabase.js`, `src/handlers/admin.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Sistema operativo de roleo activo para bloquear economia/minijuegos cuando un jugador deja de rolear en el grupo oficial.
*   **Cambios Clave:**
    *   **[Roleo - Deteccion]:** `src/index.js` ahora detecta mensajes humanos validos en `120363024420812768@g.us`, filtra comandos y mensajes de bajo esfuerzo, y consolida escrituras para no tocar BD por cada linea.
    *   **[Roleo - Estado compartido]:** `src/supabase.js` suma helpers para sembrar `player_roleplay_access`, guardar actividad por telefono, bloquear/desbloquear por roleo, manejar gracia inicial y exenciones, y forzar overrides manuales.
    *   **[Bot - Enforcement]:** `src/scheduler.js` revisa cada 10 minutos quien ya vencio los 3 dias sin roleo, marca bloqueos y encola avisos DM al jugador.
    *   **[Bot - Gate]:** comandos recreativos/economicos (`!dados`, `!cofre`, `!trampa`, `!21`, `!oraculo`, mercado/subastas y transferencias de oro) ahora responden con bloqueo si el perfil activo esta locked por roleo.
    *   **[Staff/Admin]:** se agregaron overrides `!rolestado`, `!rolbloquear`, `!roldesbloquear`, `!rolgracia` y `!rolforzaractividad` en `src/handlers/admin.js`.
*   **Notas/Advertencias:** Esta capa depende de ejecutar primero `supabase_roleplay_access.sql` en el proyecto principal de Supabase. Validacion: `node --check src/index.js`, `node --check src/scheduler.js`, `node --check src/supabase.js` y `node --check src/handlers/admin.js` pasaron correctamente.

### [Fecha: 02/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Cambio de ventana de roleo de 3 a 9 dias.
*   **Cambios Clave:**
    *   **[Bot - Defaults]:** `ROLEPLAY_LOCK_AFTER_DAYS` y `ROLEPLAY_INITIAL_GRACE_DAYS` ahora usan `9` como valor por defecto si el entorno no define overrides.
    *   **[Consistencia]:** los mensajes dinamicos del bot y el scheduler pasan automaticamente a reflejar la nueva ventana al leer `getRoleplayLockWindowDays()`.
*   **Notas/Advertencias:** Para que la gracia inicial en Supabase tambien quede en 9 dias, hace falta reejecutar el SQL `supabase_roleplay_access.sql` del repo web.

### [Fecha: 30/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `.agents/agents/KingdoomFB/agent.json`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** AdiciÃ³n de configuraciÃ³n persistente para el agente KingdoomFB enfocado en marketing.
*   **Cambios Clave:**
    *   **[KingdoomFB]:** Se agregÃ³ el subagente `.agents/agents/KingdoomFB/agent.json` con su respectiva definiciÃ³n de sistema orientada a la redacciÃ³n y diseÃ±o de copies promocionales sin generaciÃ³n de imÃ¡genes.
*   **Notas/Advertencias:** Ninguna.
### [Fecha: 29/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `README.md`, `docs/architecture/SUPABASE_BOT_SPLIT_DIAGNOSTIC.md`, `supabase/`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Reorganizacion estructural del bloque SQL y del diagnostico de arquitectura del bot.
*   **Cambios Clave:**
    *   **[SQL agrupado]:** los SQL versionados del bot ahora viven en `supabase/` en vez de quedar sueltos en la raiz.
    *   **[Archivo huerfano corregido]:** el archivo raiz llamado `supabase` se identifico como el contenido real de `supabase_bot_bet_escrow.sql`, se renombro correctamente y se movio junto al resto del bloque SQL.
    *   **[Arquitectura]:** `SUPABASE_BOT_SPLIT_DIAGNOSTIC.md` se movio a `docs/architecture/` para separar diagnosticos del runtime del proyecto.
    *   **[README]:** se agrego una seccion corta de estructura para que la nueva organizacion sea visible a simple vista.
*   **Notas/Advertencias:** No se ejecuto `node --check` porque no hubo cambios funcionales en runtime del bot.

### [Fecha: 29/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `.gitignore`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Limpieza de trazas temporales del repo y blindaje para que no vuelvan al tracking.
*   **Cambios Clave:**
    *   **[Higiene - Temporal]:** se elimino `temp_diff.txt` del tracking por ser un diff manual de trabajo y no un artefacto del producto.
    *   **[Gitignore]:** se agregaron reglas para `temp_diff.txt`, `tmp_*.txt` y `.DS_Store`.
    *   **[Alcance]:** no se movio `test_blackjack.js` porque `AGENTS.md` lo referencia explicitamente como script raiz de validacion aislada.
*   **Notas/Advertencias:** No se ejecuto `node --check` porque no hubo cambios funcionales en runtime ni en handlers del bot.

### [Fecha: 25/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/admin.js`, `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Conexion del bot con el flujo de fichas recicladas definido en Kingdoom Sync.
*   **Cambios Clave:**
    *   **[Consulta staff]:** se agrego `!fichasrecicladas` para listar fichas archivadas con `recycleStatus = available`.
    *   **[Asignacion segura]:** se agrego `!asignarficha <ficha> @jugador` y la alternativa `!asignarficha <ficha> -> <perfil web>` para transferir una ficha reciclada completa a un jugador existente.
    *   **[RPC reutilizada]:** la asignacion usa `assign_recycled_character_sheet`, evitando que el bot modifique columnas sensibles manualmente.
    *   **[Permisos]:** ambos comandos quedan restringidos a staff/admin mediante `PRIVILEGED_COMMANDS`.
*   **Notas/Advertencias:** Requiere que el SQL `supabase_character_sheet_recycling.sql` este aplicado en el Supabase principal antes de usar el comando en produccion.

### [Fecha: 25/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Hardening del arranque de Supabase para despliegues con variables heredadas o aliases distintos.
*   **Cambios Clave:**
    *   **[Aliases de entorno]:** el bot ahora acepta `SUPABASE_URL`, `SUPABASE_PROJECT_URL` o `NEXT_PUBLIC_SUPABASE_URL` para la URL principal.
    *   **[Service key]:** tambien acepta `SUPABASE_SERVICE_KEY` o `SUPABASE_SERVICE_ROLE_KEY`, y sus equivalentes `BOT_*` para el proyecto dedicado del estado operativo.
    *   **[Fallo explicito]:** si aun falta configuracion, el error ahora indica exactamente que variable falta y que nombres acepta, en vez de explotar solo con `supabaseUrl is required`.
*   **Notas/Advertencias:** Esto corrige especialmente despliegues en Hugging Face donde quedaron nombres viejos de variables. Si el espacio sigue cayendo, toca revisar que la variable exista en Settings del espacio y no solo en local.

### [Fecha: 25/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/games.js`, `src/supabase.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Mejora cualitativa del `!oraculo` con mejor memoria conversacional, ficha mas rica y contexto documental mas relevante.
*   **Cambios Clave:**
    *   **[Memoria aislada]:** el historial del Oraculo ahora se separa por `chat + jugador`, evitando que varias personas en el mismo grupo mezclen sus conversaciones entre si.
    *   **[Contexto de ficha]:** el Oraculo ahora recibe tambien `profession`, `combatStyle` e `history` resumida de la ficha, ademas del bloque base ya existente.
    *   **[Documentos relevantes]:** `pickKnowledgeContext()` mejora el scoring con frases exactas, tokens unicos y bonus por categorias fuertes del reino; ademas `!oraculo` pasa de 2 a 4 documentos relevantes.
    *   **[Fragmentos utiles]:** en vez de tirar siempre el inicio bruto del documento, el Oraculo intenta extraer un fragmento cercano a la parte que coincide con la pregunta.
*   **Notas/Advertencias:** Se priorizo calidad y coherencia, no recorte agresivo de contexto. El costo de tokens puede subir un poco en preguntas complejas, pero la respuesta deberia ser mas precisa y menos contaminada entre jugadores.

### [Fecha: 25/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `.env.example`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Reduccion selectiva de egress del bot sin degradar la profundidad IA del Oraculo.
*   **Cambios Clave:**
    *   **[!misionstart]:** `getMissionByShortId()` intenta resolver el prefijo de mision desde Supabase con `ilike` y `limit(2)` antes de caer al escaneo anterior. Si el filtro por tipo de columna no es compatible, desactiva ese intento en memoria para evitar errores repetidos.
    *   **[!oraculo]:** `getKnowledgeDocuments()` mantiene `KNOWLEDGE_CONTENT_MODE=full` por defecto para preservar la capacidad completa del Oraculo y evitar perdida de contexto.
    *   **[Fallback operativo]:** `.env.example` documenta `KNOWLEDGE_CONTENT_MODE=summary` solo como modo de emergencia si se necesita bajar egress temporalmente.
*   **Notas/Advertencias:** Se conserva el ahorro de `!misionstart`, pero no se aplica recorte agresivo al corpus IA por decision de calidad: el Oraculo sigue leyendo contenido completo por defecto.

### [Fecha: 24/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/gmTracker.js`, `src/handlers/admin.js`, `src/index.js`, `src/supabase.js`, `supabase_bot_state_migration.sql`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** ParalelizaciÃ³n de misiones para mÃºltiples grupos/jugadores independientes y resoluciÃ³n de fallos en el tracker y normalizaciÃ³n de nÃºmeros de WhatsApp.
*   **Cambios Clave:**
    *   **[ParalelizaciÃ³n de Misiones]:** Se modificÃ³ la tabla de estado `bot_active_missions` agregando `instance_id` (UUID) como clave primaria en lugar de `short_id`, permitiendo mÃºltiples instancias de la misma misiÃ³n simultÃ¡neamente.
    *   **[NormalizaciÃ³n de WhatsApp JIDs]:** Se integrÃ³ `normalizePhone` para normalizar todos los participantes y comprobar IDs de forma uniforme, resolviendo fallos en dispositivos vinculados (linked devices).
    *   **[CorrecciÃ³n de Menciones]:** Se ajustaron los comandos `!misionesON` y `!misionoff` para formatear los JIDs correctamente para las menciones usando `formatJid()`.
    *   **[Comandos Administrativos]:** Se actualizÃ³ el menÃº y soporte para `!misionstart <ID> <@jugadores>`, `!misioneson`, y `!misionoff <ID> [@jugador]`.
*   **Notas/Advertencias:** Requiere aplicar la migraciÃ³n `supabase_bot_state_migration.sql` en Supabase para cambiar la clave primaria y estructura de la tabla `bot_active_missions`.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Se agrego confirmacion explicita del provider/modelo/key que responde exitosamente al bot.
*   **Cambios Clave:**
    *   **[Log de exito]:** Gemini, NVIDIA y Groq ahora imprimen una linea clara cuando responden bien.
    *   **[Trazabilidad operativa]:** El log incluye provider, modelo y fingerprint corto de la key usada, evitando tener que inferir desde los intentos previos.
*   **Notas/Advertencias:** El fingerprint mostrado es parcial y sirve solo para diagnostico operativo; no expone la clave completa.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `src/handlers/games.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Endurecimiento operativo de `!oraculo` para que NVIDIA/Groq tengan mas oportunidades reales antes de caer a Gemini.
*   **Cambios Clave:**
    *   **[Logs utiles]:** `askKingdoomAI(...)` ahora informa si un provider se omite por falta de claves y cuantas claves disponibles tiene antes de intentar cada carril.
    *   **[Budget del Oraculo]:** `handleOraculo(...)` pasa a usar `maxEstimatedInputTokens: 5200` y `maxOutputTokens: 700`, recortando el contexto gigante del reino para no chocar tan facil con limites TPM o requests demasiado pesadas.
    *   **[Diagnostico real]:** Con este cambio, los logs deberian mostrar con claridad si el bot salta NVIDIA/Groq por no tener keys, por cooldown o por fallos reales del proveedor antes de caer en Gemini.
*   **Notas/Advertencias:** Si aun despues de esto sigue respondiendo Gemini, el problema restante ya no sera el orden ni el tamanio del prompt, sino la disponibilidad/cuota real de las keys NVIDIA o Groq cargadas en el Space.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Correccion del fallback interno del orden de proveedores IA y mejora de trazabilidad en logs.
*   **Cambios Clave:**
    *   **[Orden real de fallback]:** `getProviderOrder()` deja de usar `nvidia,gemini` como default duro y pasa a `nvidia,groq,gemini`, alineado con la configuracion esperada.
    *   **[Diagnostico en produccion]:** `askKingdoomAI(...)` ahora imprime el orden efectivo de proveedores en logs para confirmar si Hugging Face esta usando NVIDIA, Groq o Gemini primero.
*   **Notas/Advertencias:** Si en Hugging Face existe una variable `AI_PROVIDER_ORDER` manual con otro valor, esa variable seguira teniendo prioridad sobre este fallback del codigo.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `.env.example`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Ajuste de defaults de Groq para evitar que `!oraculo` arranque con un modelo demasiado justo en TPM.
*   **Cambios Clave:**
    *   **[IA - Groq principal]:** El default operativo deja de usar `openai/gpt-oss-20b` como modelo principal.
    *   **[IA - Groq recomendado]:** Se pasa a `llama-3.3-70b-versatile` como `GROQ_MODEL` sugerido para un flujo mas estable en prompts largos.
    *   **[Fallback liviano]:** Se fija `llama-3.1-8b-instant` como `GROQ_FALLBACK_MODEL` por ser mas liviano y tolerante a cuota.
*   **Notas/Advertencias:** Si el entorno real de Hugging Face tiene variables `GROQ_MODEL` o `GROQ_FALLBACK_MODEL` ya definidas, esas seguiran mandando sobre los defaults del codigo hasta que se actualicen tambien alli.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `.env.example`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Se agrego soporte de Groq como proveedor adicional de IA para el bot.
*   **Cambios Clave:**
    *   **[IA - Groq]:** `askKingdoomAI(...)` ahora tambien puede usar `GROQ_API_KEY` con el endpoint oficial OpenAI-compatible de Groq en `https://api.groq.com/openai/v1/chat/completions`.
    *   **[Orden de proveedores]:** El default sugerido pasa a `nvidia,groq,gemini`, de modo que el bot pueda recorrer primero NVIDIA, luego Groq y finalmente Gemini.
    *   **[Modelos configurables]:** Se agregaron `GROQ_MODEL` y `GROQ_FALLBACK_MODEL`, con defaults iniciales `openai/gpt-oss-20b` y `llama-3.3-70b-versatile`.
    *   **[Resiliencia]:** El sistema de cooldown por clave/modelo y degradacion por cuota/acceso/saturacion ahora cubre tambien al proveedor Groq.
*   **Notas/Advertencias:** Los IDs de modelo de Groq pueden variar segun el catalogo habilitado en la cuenta; si uno no existe o no esta permitido para la key, el bot intentara el fallback siguiente.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `.env.example`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Se agrego un carril de fallback por proveedor para que el bot pueda usar claves de NVIDIA NIM ademas de Gemini.
*   **Cambios Clave:**
    *   **[IA - Multi proveedor]:** `askKingdoomAI(...)` ahora soporta orden configurable de proveedores mediante `AI_PROVIDER_ORDER`, con fallback entre `gemini` y `nvidia`.
    *   **[IA - NVIDIA]:** Se agrego soporte para `NVIDIA_API_KEY` usando el endpoint oficial compatible con OpenAI de NVIDIA en `https://integrate.api.nvidia.com/v1/chat/completions`.
    *   **[Modelos configurables]:** El entorno ahora puede definir `NVIDIA_MODEL` y `NVIDIA_FALLBACK_MODEL` para alternar entre familias como Meta o Qwen sin tocar codigo.
    *   **[Resiliencia]:** El mismo esquema de cooldown por clave/modelo ahora aplica tambien a NVIDIA para evitar reintentos ciegos cuando hay cuota agotada o saturacion.
    *   **[Default operativo]:** Se dejo `AI_PROVIDER_ORDER=nvidia,gemini` como prioridad sugerida, con `meta/llama-3.1-70b-instruct` como modelo principal y `qwen/qwen3-32b` como fallback de Build/NIM.
*   **Notas/Advertencias:** La disponibilidad real depende de que la clave NVIDIA tenga acceso al modelo elegido. Si un modelo concreto no esta habilitado para esa cuenta/proyecto, el fallback seguira intentando el siguiente modelo o proveedor.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/ai.js`, `src/handlers/games.js`, `src/handlers/player.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Correccion de `!dados x4` y endurecimiento del flujo IA del `!oraculo` ante claves invalidas, cuota agotada o saturacion del servicio.
*   **Cambios Clave:**
    *   **[Bot - Dados x4]:** El modo `x4` dejo de exigir suma exacta de `7`; ahora cada tirada gana con `7 o mas`, igual que el modo clasico.
    *   **[Bot - Mensaje de resultado]:** La carta del minijuego ahora describe correctamente la regla del modo `x4` como `ganas con suma de 7 o mas`.
    *   **[Ayuda - Heraldo]:** El menu `!ayuda` se actualizo para no seguir anunciando una condicion incorrecta.
    *   **[Bot - Oraculo resiliente]:** `askKingdoomAI(...)` ahora aplica cooldown temporal por clave/modelo cuando detecta `API key invalid`, `403`, `429` o `503`, evitando reintentos ciegos y respuestas eternamente lentas en cada consulta.
    *   **[Bot - Mensaje util de falla]:** `handleOraculo(...)` ya no responde solo con â€œguarda silencioâ€; ahora devuelve una razon util para cuota agotada, permisos revocados o saturacion del servicio.
*   **Notas/Advertencias:** El ajuste de `!oraculo` mejora la degradacion cuando Gemini falla, pero no reemplaza la necesidad de renovar o sanear las claves invalidas/cuoteadas del entorno.

### [Fecha: 24/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Nota de auditoria retroactiva para distinguir el ciclo operativo de Antigravity 2 en los cambios del 23/06 relacionados con distribucion del APK.
*   **Cambios Clave:**
    *   **[Auditoria - Atribucion operativa]:** Se deja asentado que la secuencia de trabajo del `23/06/2026` sobre el flujo APK del bot debe considerarse parte del ciclo de **Antigravity 2**, aunque la firma visible del changelog y varios commits no lo distingan explicitamente.
    *   **[Commits asociados]:** `11253a9` (`feat: automatic latest apk fetching from github releases`), `18465b3` (`fix(bot): remove lingering merge conflict markers in index.js`), `dcd11b7` (`fix(bot): update fallback URL to direct github release to avoid rate limiting`) y `04aeece` (`fix(bot): implement robust native fetch for apk downloads`).
    *   **[Alcance]:** Esta nota corrige la trazabilidad humana del relevo y no modifica la autoria git ni el contenido tecnico de los commits originales.
*   **Notas/Advertencias:** El commit `ba2e336` (borrado de `Kingdoom_5.0.1.apk`) forma parte del mismo tramo temporal, pero se considera un movimiento auxiliar de release y no el nucleo funcional del ajuste del bot.

### [Fecha: 27/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/scheduler.js`, `src/supabase.js`, `src/handlers/playerLifecycle.js`, `supabase_player_lifecycle.sql`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Implementacion del ciclo de salida del grupo principal con gracia de 14 dias, reactivacion basica y archivado automatico.
*   **Cambios Clave:**
    *   **[Bot - Listener de salida]:** Se agrego `group_leave` en `src/index.js` para detectar cuando un usuario sale del grupo principal y disparar el flujo de lifecycle.
    *   **[Bot - Gracia y retorno]:** `src/handlers/playerLifecycle.js` marca perfiles vinculados como `left_grace`, anuncia la salida en el grupo y rehidrata a `active` si el usuario vuelve mientras aun estaba en gracia.
    *   **[Bot - Supabase]:** `src/supabase.js` suma helpers para `markPhoneProfilesLeftGrace`, `reactivatePhoneProfilesFromGrace` y `archiveExpiredGraceProfiles`, con validacion explicita cuando el SQL aun no fue aplicado.
    *   **[Bot - Scheduler]:** Se agrego un cron cada 15 minutos para pasar a `archived` los perfiles cuya gracia haya vencido.
    *   **[SQL - Lifecycle]:** Se versiono `supabase_player_lifecycle.sql` con columnas nuevas en `players` y la tabla `player_lifecycle_log`.
*   **Notas/Advertencias:** El caso historico del numero `+51 968 476 010` no pudo recuperarse retroactivamente porque no habia listener activo al momento de la salida y no existe un `player` vinculado a ese telefono en la base actual del bot. Desde este cambio, los nuevos casos ya quedan cubiertos si el deploy se reinicia con el codigo actualizado.

### [Fecha: 23/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/welcome.js`, `src/index.js`, `releases/INSTRUCCIONES.txt`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Unificacion del flujo APK del bot para enviar siempre la version mas nueva disponible en `releases/`, validado ya sobre `Kingdoom_5.0.2.apk`.
*   **Cambios Clave:**
    *   **[Bot - APK dinamico]:** Se creo `getLatestApkRelease()` en `welcome.js` para detectar automaticamente el archivo `Kingdoom_X.Y.Z.apk` con la version mas alta dentro de `releases/`.
    *   **[Bot - Fuente unica]:** El comando `!apk` / `!app` y el envio automatico de bienvenida ahora reutilizan `sendLatestApk(...)`, eliminando la URL hardcodeada a una version fija.
    *   **[Operacion - Validacion real]:** Tras sincronizar con `origin/main`, se confirmo por ejecucion real que el resolvedor selecciona `Kingdoom_5.0.2.apk` como version activa actual.
    *   **[Documentacion - Releases]:** `releases/INSTRUCCIONES.txt` ahora explica el formato versionado esperado y deja claro que el bot enviara siempre la build mas alta disponible.
*   **Notas/Advertencias:** El despliegue seguira entregando `5.0.2` mientras ese archivo siga presente como version mas alta en `releases/`. Si en el futuro se suben APKs con nombres fuera del patron `Kingdoom_X.Y.Z.apk`, el selector no los tomara.

### [Fecha: 19/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** VerificaciÃ³n del split parcial y optimizaciÃ³n de lecturas (Fase 0) mediante cachÃ© para el grimorio/orÃ¡culo.
*   **Cambios Clave:**
    *   **[OptimizaciÃ³n - CachÃ©]:** Se implementÃ³ un cachÃ© local en memoria de 15 minutos (`KNOWLEDGE_CACHE_TTL_MS`) para `getKnowledgeDocuments()` en `src/supabase.js`. Esto reduce drÃ¡sticamente las lecturas repetidas a la tabla `knowledge_documents` cuando los usuarios consultan el `!oraculo` constantemente.
    *   **[OptimizaciÃ³n - InvalidaciÃ³n]:** Se aÃ±adiÃ³ limpieza automÃ¡tica de cachÃ© (`knowledgeCache = null`) dentro de `upsertKnowledgeDocument` para asegurar que las actualizaciones del staff impacten inmediatamente.
    *   **[VerificaciÃ³n - Split Parcial]:** Se validÃ³ exhaustivamente el cÃ³digo del bloque operativo (`cofre`, `trampa`, `dados`, `21`, `faltasgrupo`, `bot_active_missions`, `heraldo_daily`). Todos los accesos ya operan correctamente mediante `botStateSupabase` sobre la base dedicada, sin fugas al cliente principal. No se requiere migrar tablas de tesoros por restricciones de atomicidad.
*   **Notas/Advertencias:** El cÃ³digo estÃ¡ 100% listo para el split. El prÃ³ximo paso operativo debe ser inyectar las variables de entorno `BOT_SUPABASE_URL` y `BOT_SUPABASE_SERVICE_KEY` en producciÃ³n y monitorear.


### [Fecha: 19/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `.env.example`, `supabase_bot_state_migration.sql`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Implementacion del primer split parcial de Supabase para mover estado operativo caliente del bot al proyecto dedicado.
*   **Cambios Clave:**
    *   **[Arquitectura - Doble cliente]:** `src/supabase.js` ahora crea un cliente `botStateSupabase` separado, alimentado por `BOT_SUPABASE_URL` y `BOT_SUPABASE_SERVICE_KEY`, con fallback automatico al proyecto principal si todavia no se configuran.
    *   **[Operacion - Estado caliente]:** Se redirigieron a la base dedicada `bot_daily_claims` y `bot_active_missions`, cubriendo recompensa diaria, contadores de `!dados`/`!21`/`!cofre`/`!trampa`, faltas del grupo principal y persistencia del GM tracker.
    *   **[Economia - Compensacion]:** `claimDailyReward(...)` ya no depende del RPC viejo compartido; primero registra el claim en la base del bot y luego acredita oro en la base principal, con rollback del claim si falla el aumento de oro.
    *   **[Infra - SQL dedicado]:** Se agrego `supabase_bot_state_migration.sql` con las tablas e indices minimos para montar `bot_daily_claims` y `bot_active_missions` en el nuevo proyecto Supabase del bot.
*   **Notas/Advertencias:** `bot_treasure_events`, `bot_treasure_claims` y `claim_bot_treasure_reward` se mantienen por ahora en el Supabase principal porque todavia necesitan atomicidad directa con el oro del jugador. El siguiente corte recomendado es migrar variables de entorno reales del deploy y probar claims diarios, usos de minijuegos y GM tracker sobre el proyecto nuevo.

### [Fecha: 19/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `SUPABASE_BOT_SPLIT_DIAGNOSTIC.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Diagnostico tecnico para separar el estado operativo de `kingdoom-bot` a otro proyecto Supabase sin romper la economia compartida con `Kingdoom-sync`.
*   **Cambios Clave:**
    *   **[Arquitectura - Diagnostico]:** Se documento el acoplamiento actual del bot a Supabase, separando nucleo economico compartido, estado bot-especifico y contenido/lore.
    *   **[Arquitectura - Recomendacion]:** Se concluyo que la opcion sana no es mover todo el bot, sino aplicar un split parcial: mantener `players`, `market_*`, `character_sheets`, `player_inventory`, `realm_*` y RPCs core en el proyecto principal, y mover `bot_daily_claims`, `bot_treasure_*` y `bot_active_missions` a un proyecto Supabase secundario del bot.
    *   **[Operacion - Fases]:** El diagnostico incluye fases concretas de optimizacion previa, split parcial y reevaluacion posterior.
*   **Notas/Advertencias:** No se implemento aun el split. El documento queda como hoja de ruta para ejecutar una migracion parcial con menor riesgo.

### [Fecha: 19/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/supabase.js`, `src/handlers/admin.js`, `src/handlers/player.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Bloqueo operativo de minijuegos en el grupo principal con advertencia, multa escalada y consulta staff/admin de faltas.
*   **Cambios Clave:**
    *   **[Bot - Moderacion de grupo]:** Se bloqueo `!cofre`, `!trampa` y `!21` para usuarios normales dentro del grupo principal `595971938097-1618930274@g.us`, manteniendo exentos a admin y staff.
    *   **[Bot - Sancion progresiva]:** La primera falta diaria ahora deja una advertencia gratuita y las reincidencias aplican multa escalada compartida entre los tres comandos (`5k -> 10k -> 20k -> 40k -> ...`), descontando todo el saldo disponible si el jugador no alcanza.
    *   **[Bot - Persistencia ligera]:** Se reutilizo `bot_daily_claims` como bitacora diaria ligera para registrar advertencias y multas del grupo principal, con helpers nuevos en `supabase.js` para leer resumenes y registrar faltas blindadas.
    *   **[Bot - Staff/Admin]:** Se agrego `!faltasgrupo @jugador` para consultar desde WhatsApp el detalle del dia, el total de faltas y el oro descontado.
    *   **[Bot - UX]:** El bot responde visiblemente en el grupo, intenta avisar por privado al infractor y agrega una nota en `!ayuda` indicando que esos minijuegos deben jugarse por DM.
*   **Notas/Advertencias:** La bitacora de faltas usa `bot_daily_claims` como solucion MVP persistente. Si luego se necesitan perdones manuales, historiales mas ricos o dashboards dedicados, conviene migrar a una tabla especifica.

### [Fecha: 17/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/adminStore.js`, `src/scheduler.js`, `src/handlers/admin.js`, `src/handlers/welcome.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** CorrecciÃ³n de envÃ­os de mensajes privados a usuarios verificados desde Comunidades de WhatsApp (Soporte para nodos `@lid`).
*   **Cambios Clave:**
    *   **[Core - JID Helper]:** Se agregÃ³ una funciÃ³n heurÃ­stica `formatJid` en `adminStore.js` que evalÃºa la longitud del nÃºmero de telÃ©fono. Si tiene >= 15 dÃ­gitos, asume que es un Local ID encriptado de Comunidad y le aÃ±ade el sufijo `@lid`. De lo contrario, usa `@c.us`.
    *   **[Core - Notificaciones]:** Se implementÃ³ `formatJid` en `sendToAll` dentro de `scheduler.js`, permitiendo que el mensaje diario/semanal llegue a los IDs enmascarados que fallaban silenciosamente.
    *   **[Core - Admin]:** Se aplicÃ³ el formato dinÃ¡mico a los comandos `!registrar` y `!kick`.
    *   **[Core - Welcome]:** Se adaptÃ³ `normalizeWhatsappId` en `welcome.js` para retener explÃ­citamente el sufijo `@lid` si un jugador ya entra con ese sufijo desde un grupo de comunidad.
*   **Notas/Advertencias:** La regla de >= 15 dÃ­gitos funciona perfectamente para la regiÃ³n actual del juego (donde los nÃºmeros reales tienen un mÃ¡ximo de 12 a 13 dÃ­gitos). Si en el futuro entra un paÃ­s con una longitud de nÃºmero E.164 vÃ¡lida de 15 dÃ­gitos, la heurÃ­stica deberÃ¡ refinarse.

### [Fecha: 17/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/games.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** ImplementaciÃ³n de soporte para multiplicadores (`xN`) en los comandos `!cofre` y `!trampa`.
*   **Cambios Clave:**
    *   **[Bot - Base de datos]:** Se actualizÃ³ `incrementBotUsageCount`, `incrementCofreUsage` y `incrementTrampaUsage` para admitir operaciones en bloque mediante un nuevo parÃ¡metro `amount`.
    *   **[Bot - Juegos]:** `handleCofre` y `handleTrampa` ahora extraen un multiplicador con formato `x[N]`. Se agrupan las tiradas en un bucle interno, respetando los lÃ­mites de usos diarios, consolidando la respuesta enviada por WhatsApp y sumando o descontando el oro de forma atÃ³mica en un Ãºnico paso.
    *   **[Bot - ValidaciÃ³n Financiera]:** Se agregÃ³ un freno preventivo en `!trampa` que deniega el comando completo si el jugador no posee suficiente oro para costear el total combinado (`apuesta * N`).
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
    *   **CompensaciÃ³n Simple:** `!dados`, `!cofre` y `!trampa` ahora comparten un helper que intenta revertir el cambio de oro si el incremento del contador diario falla despuÃ©s del cobro/pago.
    *   **Saldo Reportado:** Tras resolver la jugada, el bot relee el perfil y muestra el oro actualizado real, en vez de depender siempre del cÃ¡lculo local previo al await.
*   **Notas/Advertencias:** El blindaje del bot mejora la consistencia, pero sigue siendo recomendable llevar estos minijuegos a una RPC transaccional Ãºnica si se quiere eliminar por completo cualquier ventana entre oro y uso diario.

### [Fecha: 19/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** src/handlers/games.js, src/supabase.js, AI_CHANGELOG.md
*   **Resumen de Tareas:** Extension del modo !dados x4 para resolver cuatro tiradas en cadena en un solo mensaje.
*   **Cambios Clave:**
    *   **!dados x4 multipase:** El modo x4 ahora ejecuta hasta 4 tiradas reales en la misma respuesta, igualando la ergonomia de !cofre y !trampa.
    *   **Consumo agrupado:** incrementDadosUsage(...) ahora acepta cantidad, de modo que !dados x4 consume multiples usos diarios en una sola operacion.
    *   **Saldo de riesgo:** El comando valida que el jugador pueda cubrir el peor caso de las 4 tiradas antes de ejecutar la cadena completa.
    *   **Resumen consolidado:** La respuesta ahora detalla cada tirada, cuenta victorias y muestra el balance neto total del bloque.
*   **Notas/Advertencias:** En el modo x4, si al jugador le quedan menos de 4 usos diarios, el comando corre solo las tiradas disponibles restantes en vez de rechazar el intento.

### [Fecha: 27/06/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Endurecimiento del lifecycle de perfiles para no reactivar ni rearchivar historicos fuera de gracia.
*   **Cambios Clave:**
    *   **Filtro de gracia:** `markPhoneProfilesLeftGrace(...)` ahora solo mueve a `left_grace` los perfiles que seguian `active`, evitando tocar perfiles ya `archived`, `recycled` o `purged` del mismo telefono.
    *   **Trazabilidad de match:** El helper devuelve tambien los perfiles vinculados detectados aunque no fueran elegibles, para futuras capas de mensajeria y auditoria.
    *   **Archivado limpio:** `archiveExpiredGraceProfiles(...)` ahora limpia `archive_due_at` al pasar a `archived` y marca `last_exit_reason = 'grace_expired'`, dejando el estado final sin fechas vencidas colgando.
*   **Notas/Advertencias:** El flujo ya no pisa historicos, pero sigue dependiendo de que las salidas reales del grupo entren por el evento `group_leave` del cliente de WhatsApp.
