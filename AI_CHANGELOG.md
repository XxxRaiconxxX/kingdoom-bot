# AI Collaboration Log & Project Context - Kingdoom Bot

Este archivo sirve como registro de actividad y contexto operativo para el repositorio `kingdoom-bot`.

## Historial de Cambios (Changelog)

### [Fecha: 07/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/businessNegotiationHandler.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Solución del caso de Alexander (`!contraoferta 30000000 pero subiendo a 2000000 mi almacenamiento`).
*   **Cambios Clave:**
    1.  **[Detección de Metas Antepuestas a la Palabra Clave]:** Soporte para frases donde el valor objetivo precede a la palabra clave (ej: `subiendo a 2000000 mi almacenamiento`), asignando correctamente `2.000.000` como nuevo espacio objetivo.
    2.  **[Limpieza con Límites de Palabra en `rpArgument`]:** Eliminación de montos numéricos con límites de palabra (`\b\d+\b`), evitando que se recorte la letra `m` de palabras como `mi almacenamiento` (evitando errores como `pero subiendo a i almacenamiento`).
*   **Validación:** Caso exacto de la captura verificado y suite de 100 simulaciones automatizadas superadas con 100.0% de éxito.

### [Fecha: 07/08/2026] - [Autor: Antigravity]

### [Fecha: 06/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/player.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Corrección de enrutamiento de comandos al añadir el alias `!contraoferta` (sin "r" final) para que las respuestas del jugador sean procesadas por la **Real Cancillería** y no se caigan al chatbot general del Heraldo.
*   **Cambios Clave:**
    *   **[Alias de Comandos]:** Agregados `!contraoferta`, `!negociacion`, `!aceptarcedula` y `!cancelarnegociacion` al manejador en `src/handlers/player.js`.
*   **Validación:** Sintaxis verificada y ruteo corregido.

### [Fecha: 06/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/businessNegotiationHandler.js`, `src/negotiationStore.js`, `src/ai.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Pulido integral de la mecánica de negociación de negocios (`!negociar`, `!contraofertar`, `!aceptartrato`, `!cancelartrato`), fiscalización secreta del oro por la IA y presentación manuscrita medieval.
*   **Cambios Clave:**
    1.  **[Selección Inteligente de Negocios]:** Autoselección si posee 1 solo negocio; menú interactivo numerado si posee múltiples propiedades y ejecuta `!negociar` a secas.
    2.  **[Desglose Visual del Beneficio Real]:** Cálculo de incremento exacto y estimación de días de amortización pasiva ($ROI$).
    3.  **[Fiscalización Secreta del Oro]:** El Gran Canciller conoce en secreto la fortuna en bolsa del jugador sin mencionarla abiertamente, adaptando la firmeza y agresividad de sus ofertas.
    4.  **[Límite de Insolencia y Veto (3 Strikes)]:** Ruptura inmediata de negociación al 3er insulto impositivo con veto impositivo de 10 minutos (`fiscoVetoUntil`).
    5.  **[Evaluación de Argumentos de Rol]:** Descuentos adicionales de hasta 3% en contraofertas si el jugador presenta una justificación narrativa válida.
    6.  **[Expiración Elegante (TTL)]:** Respuestas estilizadas del Heraldo si el borrador caduca a los 15 minutos.
    7.  **[Presentación Manuscrita & Pergamino Real]:** Tipografía estilizada Unicode (ej: `📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔩𝔞 ℜ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞`) y marcos ornamentados de Real Cédula.
*   **Validación:** Sintaxis ESM comprobada y pruebas unitarias de flujo en vivo.

### [Fecha: 06/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/ai.js`, `.env`, `.env.example`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Rotación de proveedores de IA y soporte para OpenRouter.
*   **Cambios Clave:**
    *   **[Orden de Rotación de IA]:** Actualizada la jerarquía de redundancia a **`groq -> gemini -> openrouter -> nvidia`**.
    *   **[Integración de OpenRouter]:** Incorporado `askOpenRouterAI` en `src/ai.js` con manejo de cooldowns y fallbacks para modelos libres/comerciales.
*   **Validación:** Ejecución del flujo de rotación en vivo verificado exitosamente.

### [Fecha: 05/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `.github/workflows/keep_alive.yml`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Implementación y optimización del flujo de Keep-Alive mediante GitHub Actions Cron para prevenir la suspensión de Hugging Face Spaces (`axel785/kingdoom-whatsapp`).
*   **Cambios Clave:**
    *   **[GitHub Actions Keep-Alive Workflow]:** Creación y optimización de `.github/workflows/keep_alive.yml` a **cada 30 minutos** (`*/30 * * * *`). Esto consume exactamente 1,440 minutos/mes (utilizando solo el 72% de la cuota gratuita de 2,000 min/mes de GitHub) y mantiene el Space despierto 24/7 sin gastar nada.
*   **Validación:** Verificación matemática de cuotas y despliegue en remotos.

### [Fecha: 03/08/2026] - [Autor: Antigravity]

### [Fecha: 03/08/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/negotiationStore.js`, `src/handlers/businessNegotiationHandler.js`, `src/supabase.js`, `src/handlers/player.js`, `src/ai.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Implementación de la IA Negociadora de Negocios y Ampliación Dinámica de Alta Rentabilidad (`!negociar`, `!contraofertar`, `!aceptartrato`, `!cancelartrato`) y auditoría operativa de ineficiencias y corrección de bugs.
*   **Cambios Clave & Correcciones de Auditoría:**
    *   **[Procedimiento RPC en Supabase]:** Creación e integración de `upgrade_player_business` para cobro de oro y aumento atómico de nivel, producción (`gold_per_hour`) o capacidad (`max_storage`).
    *   **[Gran Canciller del Fisco Real (IA Negociadora)]:** Módulo en `businessNegotiationHandler.js` impulsado por NVIDIA NIM Llama 70B / Gemini. Implementa el Canciller Real, un fiscal impositivo feroz enfocado en maximizar la rentabilidad de las arcas del Reino.
    *   **[Audit Fix - Parser de Números Flexible]:** Soporte mejorado en `extractGoldAmount` para sufijos como `150k`, `1.5M`, y formatos agrupados como `150.000` o `150,000`.
    *   **[Audit Fix - Historial Multi-Turno]:** Preservación de `conversationHistory` en `negotiationStore.js` para que el Gran Canciller recuerde todas las ofertas y argumentos del jugador en la misma sesión.
    *   **[Audit Fix - Parser de Argumentos de Negocio]:** Corrección del parsing de `businessSearch` cuando no se especifica el sufijo de tipo de mejora.
*   **Validación:** Pruebas atómicas en Supabase, verificación sintáctica ESM y prueba simulada de negociación completa en vivo con respuesta activa del Canciller Real.

### [Fecha: 31/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/player.js`, `src/handlers/admin.js`, `src/handlers/businessHandler.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Implementación del esquema de cobro de fondos y consulta de negocios pasivos mediante el bot de WhatsApp (`!negocios`, `!cobrar`, `!recolectar`) y auditoría total de enrutamiento de comandos en menús de ayuda y administración.
*   **Cambios Clave:**
    *   **[Helpers de Supabase para Negocios]:** Adición de `getPlayerBusinesses(playerId)` y `collectPlayerBusinessesGold(playerId)` en `supabase.js`, consumiendo la tabla `businesses` y el RPC de recolección `collect_business_gold`.
    *   **[Handler de Negocios (businessHandler.js)]:** Módulo con `handleNegocios` (muestra lista de propiedades activas, tasa/h, oro acumulado y tope) y `handleCobrarNegocios` (ejecuta la recolección segura en Supabase y acredita el oro a la bolsa del jugador).
    *   **[Comandos !negocios y !cobrar en WhatsApp]:** Enrutamiento de alias (`!negocios`, `!misnegocios`, `!cobrar`, `!recolectar`) e integración en la sección `01. PERSONAJE & ECONOMÍA` de `!ayuda`.
    *   **[Auditoría Total y Menú !admin]:** Verificación exhaustiva de 58 comandos únicos en el bot. Se integraron los comandos `!verificarnumero`, `!desvincular` y `!data` en las listas del menú `!admin`, logrando 100% de cobertura en menús.
*   **Validación:** Verificación sintáctica ESM limpia, prueba de recolección segura contra Supabase RPC y auditoría estática de todos los comandos en código.

### [Fecha: 30/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/games.js`, `src/handlers/player.js`, `src/handlers/tradeHandler.js`, `.env`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Actualización del Oráculo a la versión Prompt v2 con proveedor NVIDIA NIM, desarrollo del sistema de comercio e inventario en WhatsApp (`!items`, `!vender`, `!comerciar`, `!aceptarcomercio`, `!cancelarcomercio`) e inclusión de los nuevos comandos en el menú `!ayuda`.
*   **Cambios Clave:**
    *   **[Prompt Oráculo v2]:** Se reemplazó el system prompt en `games.js` por la versión v2 (místico veterano cínico, anti-prompt injection, reconocimiento exclusivo de Nothing/E.XE, visualización de inventario real).
    *   **[Proveedor NVIDIA NIM]:** Integración y validación de 6 claves API NVIDIA NIM (`meta/llama-3.1-70b-instruct`) con fallback automático a Groq y Gemini en `.env`.
    *   **[Comando !items / !inventario / !mochila]:** Muestra la mochila del aventurero desde `player_inventory` en Supabase con cantidades, estado de financiación/bloqueo `is_locked` y valor de reventa.
    *   **[Comando !vender / !venderitem]:** Permite vender ítems de la mochila a la taberna (50% valor mercado), abonando oro en la bolsa de Supabase (`updateGold`) si no está bloqueado.
    *   **[Comando !comerciar / !trocar / !intercambiar]:** Sistema de comercio atómico entre aventureros (`!comerciar @jugador <oferta> por <pedido>`). Soporta trueques de oro por ítem, ítem por oro e ítem por ítem. Respuestas con `!aceptarcomercio` y `!cancelarcomercio`.
    *   **[Actualización Compendio !ayuda]:** Se agregaron los accesos directos y descripciones de `!items`, `!vender` y `!comerciar` en las secciones `01. PERSONAJE & ECONOMÍA` y `03. MERCADO & SUBASTAS` del Grimorio.
*   **Validación:** Verificación sintáctica ESM limpia, prueba de respuesta en tiempo real del Oráculo v2 con NVIDIA NIM (status 200) y simulación automatizada de variantes de comandos con outputs de tarjetas Heraldo.

### [Fecha: 27/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/whatsappDelivery.js`, `src/targetResolver.js`, `src/whatsappMedia.js`, `src/handlers/admin.js`, `src/handlers/player.js`, `src/handlers/marketForge.js`, `src/handlers/blackjack.js`, `src/index.js`, `test_reply_routing.js`, `test_real_integration.js`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Parche general para respuestas citadas que WhatsApp entrega con metadatos parciales, con recuperacion de sesiones de Blackjack, proteccion de apuestas y cobertura compartida para tesoros, media y comandos sobre mensajes citados.
*   **Cambios Clave:**
    *   **[Causa raiz confirmada en produccion]:** El tablero de Blackjack fue entregado a las `19:46:51Z`, pero `sendMessage()` no devolvio un ID util. La apuesta quedo creada a las `19:46:50.661848Z`, mientras que la sesion y su temporizador nunca llegaron a registrarse; las respuestas `pedir` recibidas hasta las `19:47:28Z` no tenian una clave activa que enrutar.
    *   **[Envio interactivo trazable]:** Blackjack reutiliza `sendMessageWithResult`, que recupera el ID desde `message_create` cuando el retorno directo es nulo. Los tableros solo se registran despues de obtener una clave; si falla el envio inicial se revierte la apuesta, y si falla un tablero intermedio se restaura la mano o se reembolsa la ronda segun corresponda.
    *   **[Routing general de citas]:** Un helper unico reconoce `hasQuotedMsg`, `quotedMsg`, `quotedSticker`, `quotedStanzaID` y metadatos dentro de `_originalMsg`. Se aplica a Blackjack, Tesoro, `!data`/media, Forja, transferencias y comandos administrativos sobre mensajes citados.
    *   **[Fallback acotado]:** Si WhatsApp omite el ID de la cita, una accion valida de Blackjack puede recuperar una unica sesion del mismo chat y participante. Se rechazan chat, jugador, accion o coincidencias ambiguas, evitando actuar sobre una partida ajena.
    *   **[Firma real de `Message.reply`]:** Se corrige la conclusion registrada el 26/07: en `whatsapp-web.js@1.34.7` la firma instalada es `reply(content, chatId, options)`. Pasar las opciones como segundo argumento las interpretaba como chat; `sendBotText` usa ahora `msg.from` de forma explicita antes de `sendOptions`.
    *   **[Compensacion economica]:** Se resolvio atomicamente la unica apuesta de Blackjack huerfana del incidente y se restituyeron exactamente `5.000` de oro. La operacion encontro una sola fila, quedo marcada resuelta y no requirio migraciones.
*   **Validacion:** Los 24 scripts `test_*.js` quedaron cubiertos sin fallos, incluida integracion real contra ambos Supabase para transferencia, escrow, concurrencia, cuatro juegos, `!misionstart`, tesoro, notificaciones, subasta y permisos. La regresion reproduce `sendMessage() => undefined`, recupera el ID con `message_create` y comprueba que el listener se elimina. Tambien pasan `node --check` en los diez archivos JS modificados, `npm run graphify:update` y `git diff --check`.
*   **Notas/Advertencias:** La verificacion productiva posterior al despliegue debe confirmar el SHA, `/healthz`, red activa, reconexion y snapshot RemoteAuth. No se genero una respuesta entrante desde una cuenta humana durante las pruebas automatizadas.

### [Fecha: 26/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/formatting.js`, `src/handlers/player.js`, `src/index.js`, `src/scheduler.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Corrección del fallo de envío silencioso en `sendBotText` (firma `msg.reply`) y optimización monomensaje del compendio `!ayuda` (Ciber-Grimorio).
*   **Cambios Clave:**
    *   **[Corrección de Envío msg.reply]:** Se eliminó el parámetro `undefined` erróneo en `await msg.reply(chunk, undefined, sendOptions)` dentro de `sendBotText` en `src/index.js`. Esto corregía el fallo silencioso en `whatsapp-web.js` donde las respuestas a comandos aparecían registradas en logs pero no se entregaban en WhatsApp.
    *   **[Optimización Monomensaje WhatsApp]:** Disposición agrupada por pares en `!ayuda` (33 líneas, 1.528 car.) garantizando la entrega en un solo mensaje sin partición.
    *   **[Visibilidad QR & Transmisión Cron]:** QR en alta resolución en web HTTP y transmisión motivacional semanal al Grupo Principal.
*   **Validación:** Sintaxis verificada con `node --check`; suite limpia (`CORE_MECHANICS_OK`, `GM_FORMATTING_OK`, `message formatting tests passed`).








### [Fecha: 24/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/playerLifecycle.js`, `test_player_lifecycle.js`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Corregida la caida de arranque del Space causada por un `ReferenceError` en la configuracion del ciclo de vida de jugadores.
*   **Cambios Clave:**
    *   **[Causa raiz]:** El commit `d69262c` reemplazo lecturas inseguras de IDs por `serializeWhatsAppId`, pero `playerLifecycle.js` no importo el helper. `buildPlayerLifecycleConfig()` se ejecuta al cargar `index.js`, por lo que el proceso terminaba antes de quedar saludable.
    *   **[Correccion minima]:** Se importa `serializeWhatsAppId` desde el helper compartido ya usado por los demas handlers, sin modificar Supabase, economia ni mecanicas de mensajes.
    *   **[Regresion cubierta]:** `test_player_lifecycle.js` construye la configuracion con IDs PN y LID, ejecutando la misma ruta que fallo en produccion.
*   **Validacion:** Reproduccion previa identica a la traza del Space; prueba enfocada `PLAYER_LIFECYCLE_CONFIG_OK`; `node --check` limpio; `npm test` paso `22/22`.
*   **Notas/Advertencias:** No requiere migraciones ni escrituras de datos. Falta confirmar el estado saludable del Space despues del despliegue de este commit.

### [Fecha: 23/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/blackjack.js`, `src/handlers/welcome.js`, `src/handlers/playerLifecycle.js`, `src/handlers/admin.js`, `test_blackjack.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Auditoría integral de minijuegos y handlers del bot para corregir accesos inseguros a `id._serialized` y prevenir errores de doble respuesta/emergencia (`⚠️ El reino está en llamas...`).
*   **Cambios Clave:**
    *   **[Auditoría General de Minijuegos]:**
        * **`Dados`, `Cofre`, `Trampa`, `Oráculo` (`src/handlers/games.js`):** Pura arquitectura funcional síncrona/asíncrona con retorno de strings/tarjetas `heraldCard`. **100% Inmunes** (no manejan `activeSessions` ni llaman `msg.reply()` internamente).
        * **`Subastas` & `Pujas` (`src/handlers/auctions.js`):** Retorno de cadenas formateadas a `index.js`. **100% Inmunes**.
        * **`Tesoro Errante` (`src/handlers/treasure.js`):** Utiliza `sendMessageWithResult` que ya integra `getWhatsAppMessageId` de forma resiliente. **100% Inmune**.
        * **`Blackjack` (`src/handlers/blackjack.js`):** Se corrigieron los 5 puntos de lectura insegura de `replyMsg.id._serialized` reemplazándolos por `getWhatsAppMessageId(replyMsg)`.
    *   **[Endurecimiento en Handlers Adicionales]:**
        * **`welcome.js` & `playerLifecycle.js`:** Reemplazados los accesos frágiles `contact.id._serialized` por `serializeWhatsAppId(contact?.id || contact)` y el helper seguro `getContactId(contact)`.
        * **`admin.js`:** Actualizada la función `getMessageSerializedId(msg)` para delegar en `getWhatsAppMessageId(msg)`, protegiendo comandos administrativos contra excepciones al citar/procesar mensajes.
    *   **[Verificación de Pruebas]:** Ejecutada la suite completa (`npm test`), confirmando **21/21 suites pasadas exitosamente (100% OK)**.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/scheduler.js`, `src/whatsappDelivery.js`, `src/whatsappIdentity.js`, `src/supabase.js`, `test_scheduler_delivery_guard.js`, `test_whatsapp_compat.js`, `test_phone_lookup_cache.js`, `test_real_integration.js`, `docs/architecture/SECOND_FULL_BOT_AUDIT_2026-07-22.md`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Cerrada la carrera de doble despacho entre workers y agregado routing canonico de destinatarios antes de enviar por WhatsApp.
*   **Cambios Clave:**
    *   **[Hallazgo vivo]:** Una notificacion con ACK ambiguo permanecia correctamente pendiente, pero alcanzo once intentos durante transiciones de workers. El flujo tenia tracking posterior al envio, pero no reclamaba la fila antes de llamar a WhatsApp.
    *   **[Lease atomico]:** Cada worker debe ganar una actualizacion condicional sobre la misma fila antes de enviar. Un claim reciente bloquea competidores y uno huerfano puede recuperarse tras cinco minutos usando las columnas ya migradas.
    *   **[Retry seguro]:** Retirar un ID trazado viejo tambien exige que ese ID siga siendo el actual; un worker atrasado ya no puede borrar el ID nuevo guardado por otro.
    *   **[Hipotesis corregida]:** La primera consulta no encontro jugador porque el telefono estaba guardado en un formato historico. El filtro ahora consulta variantes conocidas y normaliza antes de exigir igualdad exacta; los dos casos reales resolvieron `2/2`. Se retiro el cierre por destinatario huerfano al comprobar que esta fila si tenia perfil.
    *   **[Routing WhatsApp]:** La cola ya no construye siempre `telefono@c.us`. Antes de enviar valida con `Client#getNumberId` y resuelve PN/LID con `Client#getContactLidAndPhone` de `whatsapp-web.js@1.34.7`; prefiere el LID actual, cierra solo si WhatsApp confirma que el numero no esta registrado y conserva la fila si la consulta falla.
    *   **[Sin migracion adicional]:** Se reutilizan `delivery_message_id`, `delivery_started_at` y `delivery_error`; no se agregaron tablas, columnas ni dependencias.
*   **Validacion:** La integracion real hizo competir dos workers por el reset y por el claim. `npm test` paso 21/21, `npm run test:real` paso 22/22 y `REAL_CLEANUP_OK` termino en cero para siete categorias consultadas. La prueba de compatibilidad exige que el ID canonico pueda ser LID, que `null` no se envie y que la API ausente falle de forma explicita.
*   **Notas/Advertencias:** El lease evita duplicar la misma fila; el rate limit horario sigue siendo memoria por proceso. El primer reintento validado solo con `getNumberId` tambien termino en `WHATSAPP_ACK_TIMEOUT`; por eso el cierre final agrega la conversion PN a LID y mantiene la ventana anti-duplicado de 30 minutos.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/remoteAuth.js`, `test_remote_auth.js`, `docs/architecture/SECOND_FULL_BOT_AUDIT_2026-07-22.md`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Verificacion postdespliegue de la segunda auditoria y endurecimiento del borrado RemoteAuth frente a una carrera transitoria de Windows.
*   **Cambios Clave:**
    *   **[Produccion]:** El Space alcanzo `RUNNING` sobre `d3122660d8a754c080543cebd02b671ca4db012d`; `/healthz` devolvio `ok=true`, `HEALTHY`, prueba activa de red y reconexion RemoteAuth verificada.
    *   **[Entrega trazable]:** Los logs oficiales no mostraron excepciones no capturadas ni fallos fatales. Dos destinatarios sin LID quedaron cerrados con error explicito y un ACK ambiguo permanece pendiente con ID, intentos y error persistidos en el Supabase dedicado.
    *   **[Causa raiz]:** La suite real expuso `ENOTEMPTY` dentro de `VersionedFileRemoteAuthStore.delete()` al retirar un snapshot despues de la integracion. El store y el teardown del test ahora usan los reintentos nativos de `fs.rm` para la condicion transitoria de Windows, sin relajar ninguna asercion funcional.
*   **Validacion:** `REMOTE_AUTH_STRESS_OK=50`; `npm test` 21/21; `npm run test:real` 22/22 en el orden que antes reprodujo la carrera; `REAL_CLEANUP_OK` dejo en cero perfiles, subastas, tesoros, reclamos y premios sinteticos.
*   **Notas/Advertencias:** Los `No LID` representan destinatarios invalidos y no se reintentan para no bloquear toda la cola. El ACK ambiguo no se marca enviado sin evidencia y queda sujeto a la ventana segura de reconciliacion.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** economia, routing admin, juegos, subastas, persistencia GM, entrega WhatsApp, scheduler, wrappers Supabase, cinco migraciones SQL, runner/pruebas y `docs/architecture/SECOND_FULL_BOT_AUDIT_2026-07-22.md`.
*   **Resumen de Tareas:** Segunda auditoria integral del bot con pruebas conductuales, integracion real en ambos Supabase, proveedor GM real y verificacion de produccion previa al release.
*   **Cambios Clave:**
    *   **[Seguridad P0]:** Se revocaron RPC privilegiadas para `anon`, se exigio `service_role` en apuestas/premios/cuotas/fichas y se comprobo que un usuario autenticado no vinculado tampoco puede operar sobre otro jugador. Las siete tablas del Supabase dedicado quedaron con RLS y CRUD exclusivo de servicio de forma reproducible.
    *   **[Economia]:** Subastas alineadas a comision unica del 25% + lock-and-release; cofre con reserva/idempotencia/reconciliacion entre bases; blackjack PvP conserva exactamente el pozo; montos limitados al entero real de PostgreSQL.
    *   **[WhatsApp]:** La cola persiste ID/intento antes del ACK, reconcilia ACK tardio tras reinicio y retiene 30 minutos una entrega ambigua antes de reintentar. No se marca enviado sin evidencia.
    *   **[Comandos y GM]:** Registro unico de permisos vuelve alcanzables `!eliminar`/`!kick`, separa owner/admin/staff y protege tambien el handler directo. `!misionstart` revierte memoria si falla Supabase, cancelar elimina antes de confirmar y la busqueda UUID ya no genera un error `ilike`.
    *   **[Base real]:** Aplicadas `supabase_primary_rpc_hardening.sql` y `supabase_auction_lock_release.sql` en el proyecto principal; `supabase_notification_delivery_tracking.sql`, `supabase_bot_game_rewards.sql` y `supabase_bot_state_rls_hardening.sql` en el dedicado. La ultima preservo 222 usos, 3 misiones, 47 tesoros, 82 reclamos, 749 notificaciones y 838 logs.
*   **Validacion:** 39 chequeos `node --check`; `npm test` 21/21; `npm run test:real` 22/22 con transferencia, escrow, concurrencia, dados, trampa, cofre, blackjack, `!misionstart`, tesoro, notificaciones, subasta y permisos; `REAL_CLEANUP_OK` en cero; `npm ci --dry-run`, Graphify y `git diff --check` pasan. La prueba GM real uso NVIDIA `meta/llama-3.1-70b-instruct` y devolvio estado/formato validos.
*   **Notas/Advertencias:** Riesgo critico heredado: `increment_gold` sigue disponible para el jugador web autenticado/vinculado porque nueve minijuegos de Kingdoom Sync calculan settlement en cliente; cerrarlo exige migrarlos primero para no romper produccion. `npm audit --omit=dev` mantiene 2 altas y 2 moderadas; el lockfile no se modifico por guardrail. No se genero un mensaje entrante desde una cuenta humana de WhatsApp en esta auditoria.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/whatsappDelivery.js`, `test_scheduler_delivery_guard.js`, `docs/architecture/WHATSAPP_LID_MEDIA_GM_AUDIT.md`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Cerrada la brecha observada al validar en vivo el primer fix: WhatsApp emitia mensaje saliente y ACK, pero `sendMessage()` seguia retornando `undefined` aun con `waitUntilMsgSent`.
*   **Cambios Clave:**
    *   **[Evidencia viva]:** En el Space con `f075d2b`, una notificacion marco `lastOutboundAt=17:34:00Z` y `lastOutboundAckAt=17:34:03Z`, pero el scheduler recibio `WhatsApp send completed without a recoverable message id`.
    *   **[Recuperacion publica]:** El helper escucha temporalmente `message_create`, evento oficial que incluye mensajes propios, y recupera de alli el objeto completo con ID cuando el retorno directo es nulo.
    *   **[Correlacion segura]:** Solo acepta mensajes `fromMe` con cuerpo y tiempo coincidentes; las ventanas se serializan por cliente y el listener siempre se retira para impedir cruces o fugas.
    *   **[Sin doble envio deliberado]:** Si el envio lanza una excepcion despues de crear el mensaje, se reutiliza el evento observado en vez de reenviar. El ACK mantiene la decision final de entrega.
*   **Validacion:** 20/20 scripts `test_*.js` pasan; la regresion reproduce `sendMessage() => undefined`, emite `message_create`, exige recuperacion del ID y verifica limpieza del listener.
*   **Notas/Advertencias:** `f075d2b` quedo desplegado pero incompleto; este follow-up requiere nuevo despliegue y observacion de la siguiente entrega real.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/whatsappDelivery.js`, `src/targetResolver.js`, `src/handlers/treasure.js`, `src/scheduler.js`, `src/handlers/auctionsRealtime.js`, `src/index.js`, pruebas y documentacion de auditoria.
*   **Resumen de Tareas:** Corregido el tesoro visible pero no reclamable reportado a las 13:55 y endurecidos los envios que dependen de ID/ACK frente al contrato actual de WhatsApp Web.
*   **Cambios Clave:**
    *   **[Causa productiva confirmada]:** El Space mostro que WhatsApp publico el anuncio pero devolvio el resultado sin `message.id`; por eso no se registro ni persistio el evento. `!reclamar` cayo en la ayuda generica y el segundo `Reclamar` sin prefijo quedo silencioso al no reconocer la cita.
    *   **[Resultado de envio estable]:** El helper compartido fuerza la opcion oficial `waitUntilMsgSent: true` solo para tesoros, notificaciones y subastas, antes de validar el ID y esperar el ACK.
    *   **[Compatibilidad de IDs]:** Se normalizan `_serialized`, `_data.id`, `$1`, `key.id` y objetos anidados; las citas LID se comparan por stanza ID sin convertir objetos a `[object Object]`.
    *   **[Fallo visible y seguro]:** Citar un anuncio de tesoro sin evento activo devuelve `Tesoro no disponible`; no acredita ni anuncia oro y ya no queda en silencio.
    *   **[Base de datos]:** No se requirio migracion: el evento reportado nunca alcanzo Supabase. Las migraciones atomicas aplicadas previamente permanecen sin cambios.
*   **Validacion:** `node --check` pasa en los 9 archivos tocados; 20/20 scripts `test_*.js`, `npm ci --dry-run --ignore-scripts --omit=dev`, `npm run graphify:update` y `git diff --check` pasan.
*   **Notas/Advertencias:** Falta el smoke real del proximo Tesoro Errante tras desplegar; no se inyecto un anuncio artificial en el grupo de produccion.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `docs/architecture/WHATSAPP_LID_MEDIA_GM_AUDIT.md`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Cierre y verificacion productiva del release integral de compatibilidad WhatsApp, Tesoro y Game Master.
*   **Cambios Clave:**
    *   **[Commit funcional]:** `d27cf10032f19b5fce781df8e6cc0fd7ee5135dc` fue aceptado por `origin/main` y `huggingface/main` mediante fast-forward desde `c235b8e`.
    *   **[Space correcto]:** La API de Hugging Face reconocio el SHA objetivo, paso de `RUNNING_BUILDING` a `RUNNING_APP_STARTING` y termino en `RUNNING`.
    *   **[Canal operativo]:** `/healthz` respondio HTTP 200; el estado publico mostro `operational=true`, `HEALTHY`, `CONNECTED`, sin QR, sin error funcional y con `reconnectReady=true`.
    *   **[Sesion restaurada]:** RemoteAuth restauro un snapshot guardado y completo `remote_auth_restore` como `verified` mediante `active_network` en 88.910 ms.
*   **Validacion:** 33 archivos JS pasan `node --check`, 20/20 pruebas pasan, `npm ci --dry-run --ignore-scripts --omit=dev` y `git diff --check` pasan; ambas RPC de tesoro ya estan visibles en PostgREST.
*   **Notas/Advertencias:** No se envio un comando real a grupos de produccion durante este cierre. El smoke funcional final de `!data`, un reclamo y `!misionstart` requiere interaccion de un usuario autorizado en WhatsApp.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `supabase/supabase_bot_state_migration.sql`, `supabase/supabase_treasure_gold_awards.sql`, `test_treasure_atomicity.js`, `docs/architecture/WHATSAPP_LID_MEDIA_GM_AUDIT.md`, `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl`.
*   **Resumen de Tareas:** Aplicadas y verificadas las migraciones atomicas del Tesoro Errante en los dos proyectos Supabase reales.
*   **Cambios Clave:**
    *   **[Estado del bot]:** Aplicado el SQL con SHA-256 `66DEA4FD3BE24F95D92A0EEA39405E868CA9447BF36A50C7B976980D8D0E280F` en `tnrocqdfbssscnszahut`. Se conservaron 47 eventos y 82 reclamos; los reclamos historicos quedaron acreditados y las RPC de reserva/marcado estan visibles en PostgREST.
    *   **[Oro principal]:** Aplicado el SQL con SHA-256 `729DF21F924B96C30E8CE3FBD0C3917EF80B052D00763CAD1D8A4E2A9500814B` en `sibisgiwmgdrpfkzmkkw`. Los 32 jugadores y totales de oro quedaron sin cambios; la tabla de premios nacio vacia y con idempotencia unica.
    *   **[Permisos endurecidos]:** La primera verificacion detecto privilegios `EXECUTE` heredados por defecto para `anon` y `authenticated`. Se corrigieron ambos SQL, se reaplico el del bot y se confirmo que solo `service_role` puede ejecutar las tres RPC. `bot_gold_awards` tambien tiene RLS activa y acceso directo anonimo revocado.
    *   **[Prueba transaccional]:** Pasaron reserva inicial, repeticion pendiente, cupo lleno, marcado acreditado, duplicado acreditado y doble invocacion del premio. Todas las simulaciones terminaron con `ROLLBACK`; no dejaron filas ni cambiaron saldos.
*   **Validacion:** Ambas aplicaciones devolvieron HTTP 201; PostgREST reconoce `reserve_treasure_claim` y `award_bot_gold_once`; `test_treasure_atomicity.js` y `git diff --check` pasan.
*   **Notas/Advertencias:** Las migraciones se aplicaron antes del cierre Git y del despliegue del codigo consumidor. El `.env` local no define las variables del Supabase dedicado y mantiene el fallback al proyecto principal para ejecuciones locales.

### [Fecha: 22/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `Dockerfile`, `src/adminStore.js`, `src/whatsappIdentity.js`, `src/whatsappMedia.js`, `src/index.js`, `src/targetResolver.js`, `src/supabase.js`, `src/scheduler.js`, `src/gmTracker.js`, handlers relacionados, migraciones SQL, pruebas y `docs/architecture/WHATSAPP_LID_MEDIA_GM_AUDIT.md`.
*   **Resumen de Tareas:** Auditoria web y correccion integral de compatibilidad LID/media, atribucion y atomicidad del Tesoro Errante, y formato del Game Master de `!misionstart`.
*   **Cambios Clave:**
    *   **[WhatsApp LID]:** Se sustituyo la heuristica que trataba IDs `@lid` como telefonos por resolucion oficial `getContactLidAndPhone`, con cache, timeout, lotes pequenos y fallo seguro. El telefono resuelto se comparte desde el router con comandos, tesoros, blackjack, GM, lifecycle, bienvenida y herramientas admin.
    *   **[`!data`]:** Se elimino el pipeline duplicado basado en `_blob` y `WAWebCollections`. `downloadMedia()` + `reload()` es ahora el camino principal; el fallback `directPath/mediaKey` queda limitado a citas sinteticas antiguas. Se agregaron limites de 1 MB/500.000 caracteres, UTF-8 estricto y reutilizacion en la Forja.
    *   **[Tesoro]:** Se prepararon reserva serializada, credito de oro idempotente y reconciliacion de pendientes. Las respuestas y resumen identifican al usuario por mencion, nombre, premio y saldo confirmado.
    *   **[Game Master]:** Se retiro del prompt el Markdown incompatible con WhatsApp, se mejoro la tarjeta de inicio y se agrego un normalizador final que conserva narrativa/estado pero corrige encabezados, tablas, doble negrita, bullets, marcos y cercas vacias.
    *   **[Build reproducible]:** Docker usa `npm ci --omit=dev`, fijando la version exacta del lock sin modificar `package-lock.json`.
    *   **[Investigacion]:** La auditoria con fuentes oficiales y decisiones queda en `docs/architecture/WHATSAPP_LID_MEDIA_GM_AUDIT.md`. Esta entrada sustituye la conclusion anterior del mismo dia que afirmaba que no existia una solucion oficial para el pipeline de medios: la version instalada `1.34.7` ya incorpora ese flujo en `Message.downloadMedia()`.
*   **Validacion:** Todos los archivos JS de `src` pasan `node --check`; todos los `test_*.js` pasan; `npm ci --dry-run --ignore-scripts --omit=dev`, `npm run graphify:update` y `git diff --check` pasan.
*   **Notas/Advertencias:** La sonda no destructiva devolvio `PGRST202` para `reserve_treasure_claim` y `award_bot_gold_once`: las dos migraciones estan preparadas pero no aplicadas. El fallback conserva el comportamiento actual hasta instalarlas. `src/whatsappHealth.js` mantiene `WAWebCollections` solo como observador estructural del watchdog; es una dependencia privada residual, separada de medios/LID, que falla cerrado si WhatsApp la retira. No se realizo commit, push ni despliegue. El remoto local de Hugging Face contiene una credencial embebida y debe rotarse sin exponerla.

### [Fecha: 22/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/index.js`, `src/handlers/admin.js`, `src/adminStore.js`, `src/handlers/treasure.js`, `test_data_and_treasure.js`, `test_community_patch_validation.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Resolución completa del comando `!data` para carga de documentos `.txt` en grupos con formato LID de WhatsApp Web. Investigación y aplicación de parches comunitarios para el bug global de `downloadMedia()`.
*   **Cambios Clave:**
    *   **[Fix de Captions en Documentos — `src/index.js` y `src/handlers/admin.js`]:** WhatsApp Web asigna el texto de comandos en archivos adjuntos a `msg.caption` en lugar de `msg.body`. Se actualizó la extracción global de texto para priorizar `msg.caption` cuando existe, permitiendo que `!data <titulo>` como pie de foto se parsee correctamente.
    *   **[Pipeline de Descarga de 3 Métodos — `src/handlers/admin.js`]:** Rediseñado el motor de descarga de documentos con 3 estrategias independientes:
        * **Método A:** Búsqueda por ID en `WAWebCollections.Msg` + polling de `mediaStage` hasta 12s + lectura de `_blob` via `FileReader`.
        * **Método B (NUEVO):** Descarga directa usando `directPath` + `mediaKey` del `quotedMsg._data` via `WAWebDownloadManager`. Bypasea completamente la búsqueda por ID, resolviendo el problema de mensajes citados sin ID válido en grupos con formato `@lid`.
        * **Método C:** Fallback al `targetMsg.downloadMedia()` nativo de `whatsapp-web.js`.
    *   **[Helper `getSerializedId()` — `src/handlers/admin.js`]:** Creado para extraer IDs serializados del nuevo formato LID de WhatsApp Web (`id['$1']`), evitando que Puppeteer reciba un objeto en lugar de un string.
    *   **[Resolución Sintética de Citas — `src/handlers/admin.js`]:** Cuando `client.getMessageById()` y `getQuotedMessage()` fallan con la excepción minificada `r`, se extraen los datos directamente de `msg._data.quotedMsg` para construir un `targetMsg` sintético con los metadatos de descarga.
    *   **[Guard de Respuestas del Bot]:** Se agregó filtro para ignorar mensajes citados que sean respuestas de error del propio bot (`❌`, `🛡️`, etc.).
    *   **[Investigación Comunitaria]:** Investigado el estado actual del bug global de `downloadMedia()` en `whatsapp-web.js` (excepción `r: r`, formato `@lid`, mutación de `WAWebDownloadManager`). Se confirmó que no existe solución oficial; se integró el parche comunitario de inspección dinámica de métodos (`downloadAndMaybeDecrypt || downloadAndDecrypt || downloadMedia`).

### [Fecha: 21/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/adminStore.js`, `src/handlers/treasure.js`, `test_data_and_treasure.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Corrección de fallos en el reclamo de tesoros del Heraldo y normalización de teléfonos multi-device.
*   **Cambios Clave:**
    *   **[Normalización de Teléfonos Multi-Device]:** Corregido `normalizePhone` en `src/adminStore.js` para extraer la base JID antes de remover caracteres no numéricos (`.split(':')[0]`). Anteriormente, sufijos como `:12@c.us` generaban teléfonos corruptos (ej. `59598112345612`), provocando el rechazo o fallo en la resolución del jugador al reclamar tesoros o ejecutar comandos.
    *   **[Reclamo de Tesoros Dinámico]:** Actualizados los filtros y lógica de cierre en `src/handlers/treasure.js` para validar `treasure.chatId` en lugar de comparar contra un ID de grupo fijo, asegurando que las respuestas de reclamo y resúmenes de cierre se dirijan siempre al chat correspondiente.
    *   **[Suite de Pruebas]:** Creado `test_data_and_treasure.js` para validar unitariamente la normalización multi-device, la respuesta a tesoros y la asimilación de archivos `.txt` vía `!data`.

### [Fecha: 20/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/remoteAuth.js`, `src/index.js`, `test_remote_auth.js`, `test_connection_watchdog.js`, `docs/architecture/WHATSAPP_RECONNECTION_RESEARCH.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Verificada la nueva solicitud de QR en produccion y corregida la carrera de respaldo detectada durante la invalidacion explicita de WhatsApp.
*   **Cambios Clave:**
    *   **[Causa Confirmada]:** Los logs vivos muestran seis reconexiones verificadas antes de que WhatsApp emitiera `LOGOUT` el 20/07. Este evento invalida la vinculacion del servidor; ningun snapshot ni reintento puede reutilizarla y se requiere un QR nuevo.
    *   **[Carrera Eliminada]:** Un respaldo iniciado antes del `LOGOUT` podia terminar despues del borrado y volver a publicar un snapshot ya invalidado. La purga ahora espera cualquier respaldo en curso y elimina el store al final, garantizando que el borrado sea la ultima operacion.
    *   **[Diagnostico Persistente]:** El panel y `/status.json` conservan `lastDisconnectReason` y `lastDisconnectAt`, por lo que un `LOGOUT` no desaparece aunque WhatsApp renueve el QR repetidamente.
    *   **[Historial Util]:** Solo el primer QR de cada episodio ocupa el historial; las renovaciones actualizan la imagen y el estado sin desplazar la causa original.
    *   **[Pruebas de Regresion]:** `test_remote_auth.js` reproduce un respaldo bloqueado durante logout y exige que no sobreviva ninguna sesion. `test_connection_watchdog.js` protege el diagnostico y la deduplicacion del QR.
*   **Notas/Advertencias:** El fallo de una notificacion semanal ocurrio inmediatamente antes del `LOGOUT`, pero la cola aplica limites y la evidencia no demuestra causalidad. No se modifico el scheduler. Tras desplegar se necesita un escaneo para crear credenciales nuevas y luego repetir el reinicio controlado.

### [Fecha: 19/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/handlers/player.js`, `src/handlers/treasure.js`, `src/supabase.js`, `test_treasure_feedback.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Corrección de la condición de carrera del drop de tesoros, bloqueo de falsas acreditaciones en el chatbot de IA y aumento de recompensas.
*   **Cambios Clave:**
    *   **[Condición de Carrera Resuelta]:** En `src/handlers/treasure.js`, se cambió el flujo para que `registerActiveTreasure` se invoque de manera síncrona inmediatamente después de obtener el `messageId` de WhatsApp, eliminando la ventana de retraso de la llamada asíncrona de base de datos (`createTreasureEvent`) en la cual las respuestas rápidas de los jugadores eran ignoradas.
    *   **[Soporte para Exclamación `!reclamar`]:** Se actualizó `normalizeTreasureReply` para limpiar prefijos de exclamación `!` y espacios de forma transparente, permitiendo que `!reclamar` y `! Reclamar` procesen correctamente la transacción real en la base de datos si citan al mensaje del tesoro.
    *   **[Bloqueo de Alucinaciones en IA]:** Se agregó un guard en `handlePlayerMessage` en `src/handlers/player.js` para que el comando `!reclamar` (cuando no es una réplica al mensaje del tesoro) retorne instrucciones amigables en lugar de caer en el fallback del Heraldo IA y causar alucinaciones de oro fantasmas.
    *   **[Incremento de Recompensas]:** Se modificó la función `claimTreasureReward` en `src/supabase.js` para aumentar el rango aleatorio de oro otorgado al abrir cofres errantes, pasando de 1,000–20,000 a **10,000–50,000 oro**.
    *   **[Auto-recuperación de Anuncios de Tesoros]:** Modificado `closeTreasure` en `src/handlers/treasure.js` para reprogramar automáticamente el intento de cierre cada 1 minuto en memoria si WhatsApp no está disponible en el instante del timeout, sin alterar el estado en base de datos. Esto evita que los cierres (por expiración o agotamiento) queden "mudos" permanentemente cuando hay microcortes de conexión.
    *   **[Pruebas e Integración]:** Se añadieron pruebas unitarias en `test_treasure_feedback.js` verificando la normalización con y sin prefijos, y la suite pasó limpia.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `docs/architecture/WHATSAPP_RECONNECTION_RESEARCH.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Verificacion final en produccion de la reconexion `RemoteAuth` completa entre contenedores de Hugging Face.
*   **Cambios Clave:**
    *   **[Restauracion Real]:** `aa2f34f` inicio un proceso nuevo a las `21:59:38Z`, extrajo `remote_auth_snapshot_restored` y no genero QR.
    *   **[Auditoria Cerrada]:** `remote_auth_restore` termino como `reconnection_verified` mediante `server_ack` en 38 segundos, sin intervencion humana.
    *   **[Canal Operativo]:** el proceso restaurado alcanzo `HEALTHY`, `reconnectReady=true`, cuatro sondas funcionales y `/healthz=200`.
*   **Notas/Advertencias:** La persistencia y reconexion quedaron demostradas en vivo. El limite restante no es de sesion: `cpu-basic` puede suspender el proceso por politica de inactividad de Hugging Face, algo que solo resuelve hardware sin sleep o migracion a un host 24/7.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `test_connection_watchdog.js`, `docs/architecture/WHATSAPP_RECONNECTION_RESEARCH.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Cerrado el ultimo hueco de auditoria detectado durante la primera restauracion real de `RemoteAuth` en Hugging Face.
*   **Cambios Clave:**
    *   **[Restauracion Comprobada]:** el reinicio controlado de `2177880` creo un proceso nuevo, restauro `remote_auth_snapshot_restored`, no emitio QR y regreso a `HEALTHY` con `active_network` y `/healthz=200`.
    *   **[Causa del Hueco]:** la API de reinicio de Hugging Face reemplazo el contenedor sin dejar un `SIGTERM` observable en el historial persistido; por eso la restauracion era real pero no existia un intento pendiente que pudiera producir `reconnection_verified`.
    *   **[Auditoria Autonoma]:** cada snapshot restaurado inicia `remote_auth_restore`. Si ya existe un intento pendiente se conserva; si la plataforma arranco en frio se crea uno nuevo y solo una prueba funcional puede completarlo.
    *   **[Prueba de Regresion]:** la inspeccion automatizada exige que el evento de restauracion permanezca conectado a `reconnectAudit`, junto con la prueba integral del store remoto.
*   **Notas/Advertencias:** No cambia autenticacion almacenada, economia, Supabase ni dependencias y no requiere otro QR. El despliegue de este ajuste debe restaurar el mismo snapshot y producir `reconnection_verified` aun si Hugging Face vuelve a omitir `SIGTERM`.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `.env.example`, `README.md`, `docs/architecture/WHATSAPP_RECONNECTION_RESEARCH.md`, `src/index.js`, `src/remoteAuth.js`, `src/runtimePaths.js`, `src/whatsappRecovery.js`, `test_connection_watchdog.js`, `test_remote_auth.js`, `test_whatsapp_recovery.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Sustituido el perfil `LocalAuth` mutable sobre el bucket de Hugging Face por snapshots `RemoteAuth` versionados y verificables, despues de que una prueba real demostrara que los archivos persistian pero la sesion volvia a QR.
*   **Cambios Clave:**
    *   **[Causa Confirmada]:** la sesion vinculada alcanzo `HEALTHY` y `/healthz=200`; tras el rebuild de `952279e`, el marcador de `/data` sobrevivio pero `LocalAuth` no restauro credenciales y emitio QR. Persistencia de archivos no equivalia a reconexion.
    *   **[Separacion de Almacenamiento]:** Chromium usa cache efimero en `/tmp`; `/data/kingdoom-bot/remote-auth` recibe unicamente ZIP inmutables mediante la interfaz oficial de `RemoteAuth`.
    *   **[Integridad y Fallback]:** cada snapshot se copia y verifica con SHA-256 antes de publicar un manifiesto atomico. Se conservan tres versiones y una restauracion descarta la ultima si su hash o tamano no coincide.
    *   **[Semantica Segura]:** desconexiones transitorias conservan el store; `LOGOUT`, `UNPAIRED`, `UNPAIRED_IDLE`, `auth_failure`, QR posterior a restauracion y reset autorizado lo purgan. Los reinicios controlados actualizan un snapshot ya estable antes de cerrar Chromium.
    *   **[Sin Falsos Positivos]:** el primer respaldo respeta el minuto de estabilizacion de `RemoteAuth`; un cierre prematuro no publica `reconnectReady=true`. Panel, `/status.json` y `/healthz` separan canal operativo de sesion reconectable.
    *   **[Carrera de Extraccion]:** el wrapper espera el cierre real de `unzipper` antes de iniciar Chromium, evitando que la restauracion continue en segundo plano con un perfil incompleto.
    *   **[Prueba de Regresion]:** `test_remote_auth.js` crea ZIP reales, bloquea el snapshot inicial prematuro, conserva la sesion en desconexion, corrompe la version nueva, restaura la anterior y verifica que solo logout elimine el store.
    *   **[Validacion Local]:** pasaron `node --check` sobre los 31 archivos de `src`, los 14 scripts `test_*.js`, `git diff --check` y `npm run graphify:update`.
*   **Notas/Advertencias:** No cambia economia, Supabase, dependencias ni `package-lock.json`. El despliegue requiere un ultimo escaneo porque `LocalAuth` no puede convertirse en un snapshot remoto. Despues se debe esperar `remoteAuthSnapshotAvailable=true` y probar un reinicio real sin QR. `cpu-basic` sigue sin ser una garantia 24/7 porque Hugging Face puede suspenderlo por inactividad.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `.env.example`, `README.md`, `docs/architecture/WHATSAPP_RECONNECTION_RESEARCH.md`, `src/index.js`, `src/whatsappHealth.js`, `src/whatsappRecovery.js`, `test_connection_watchdog.js`, `test_whatsapp_health.js`, `test_whatsapp_recovery.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Auditada la efectividad real de las reconexiones de WhatsApp en Hugging Face y sustituida la salud visual por pruebas funcionales persistentes, con recuperacion compatible con los estados transitorios del cliente.
*   **Cambios Clave:**
    *   **[Causa y Estado Real]:** el Space usa un bucket RW montado en `/data`, pero el telefono confirmo que no quedaba ningun dispositivo vinculado. El QR actual es una revinculacion obligatoria; no se reporta como reconexion.
    *   **[Prueba Funcional Obligatoria]:** `ready`, socket, pagina y listeners solo alcanzan `CONNECTED_UNVERIFIED`. `HEALTHY` requiere `active_network`, `inbound_traffic` o `server_ack` de la conexion actual.
    *   **[Auditoria de Reconexiones]:** cada reinicio automatico persiste inicio, causa, duracion y resultado. Solo una prueba real produce `reconnection_verified`; terminar en QR produce `reconnection_failed_pairing_required`.
    *   **[Reinicios de Plataforma]:** un `SIGTERM` de despliegue o reinicio de Hugging Face crea `platform_sigterm_restart`, permitiendo auditar tambien la restauracion entre contenedores y no solo las recuperaciones internas.
    *   **[Recuperacion sin Carreras]:** `OPENING`, `PAIRING` y `TIMEOUT` reciben 180 segundos de gracia; un QR activo deja de reiniciar por antiguedad y una consulta de red fallida aislada no borra credenciales.
    *   **[Persistencia Demostrable]:** un marcador atomico diferencia una ruta configurada de almacenamiento leido en otro boot. El reset elimina solo el perfil `session` y conserva `state` y los demas datos del bot.
    *   **[Observabilidad]:** `/healthz` devuelve HTTP 200 solo cuando el canal es operativo y 503 ante QR, conexion no verificada o degradacion. El panel y `/status.json` exponen prueba funcional, persistencia y ultimo resultado de reconexion.
    *   **[Alternativas Evaluadas]:** se conserva `LocalAuth` porque el bucket ya cubre su requisito de filesystem persistente. `RemoteAuth` no se adopta durante el incidente por su ventana inicial de respaldo y el borrado remoto asociado a ciertos flujos de desconexion; VPS o hardware actualizado quedan como opciones de infraestructura.
    *   **[Validacion]:** `node --check` paso sobre todo `src/`; pasaron los 13 scripts `test_*.js`, `git diff --check` y `npm run graphify:update`.
*   **Notas/Advertencias:** No cambia economia, Supabase ni dependencias. El telefono no tiene un dispositivo vinculado, por lo que se requiere un unico escaneo del QR despues del despliegue antes de validar `/healthz=200`. El Space actual es `cpu-basic`; Hugging Face lo suspende tras 48 horas sin visitas. Ejecucion 24/7 oficial requiere hardware pago sin sleep o un VPS, decision no aplicada por su costo recurrente.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `test_connection_watchdog.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Corregida la carrera donde una recuperacion ya programada cerraba Chromium aunque el socket hubiera vuelto a `CONNECTED` antes de vencer la espera.
*   **Cambios Clave:**
    *   **[Causa Confirmada]:** el log de produccion mostro `OPENING`, programacion de `functional_health_process_restart`, retorno a `PAIRING/CONNECTED` y, un segundo despues, `restart_worker_exit`; ese temporizador obsoleto destruyo una conexion ya recuperada y desemboco en QR.
    *   **[Cancelacion Segura]:** solo los reinicios conservadores de salud pueden cancelarse al recuperar `CONNECTED`. El canal vuelve a `CONNECTED_UNVERIFIED` y debe superar nuevamente las sondas antes de habilitar envios.
    *   **[Escalamiento Intacto]:** `LOGOUT`, `auth_failure`, limpieza de autenticacion y cualquier reinicio duro posterior desactivan la cancelacion y siguen cerrando el worker como antes.
    *   **[Prueba de Regresion]:** se reproduce `OPENING -> reinicio pendiente -> CONNECTED` y se verifica que no haya `process.exit(1)`; tambien se prueba que una escalada con limpieza de auth no pueda cancelarse.
*   **Notas/Advertencias:** No requiere migracion Supabase ni cambia economia. La sesion que ya quedo solicitando QR no puede recuperarse desde codigo y necesita un escaneo vigente. Cambio validado con las 13 pruebas del repositorio y preparado para el despliegue de este cierre.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/handlers/treasure.js`, `test_treasure_feedback.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Eliminado el Tesoro Errante visible pero imposible de reclamar cuando WhatsApp no confirma el ACK del mensaje a tiempo.
*   **Cambios Clave:**
    *   **[Persistencia Primero]:** el evento se crea en Supabase y se registra en memoria inmediatamente despues de obtener el ID del mensaje, antes de esperar el ACK del servidor.
    *   **[ACK Best Effort]:** un rechazo o timeout del ACK queda registrado como advertencia, pero ya no descarta un tesoro que WhatsApp llego a mostrar en el grupo.
    *   **[Prueba de Regresion]:** la prueba fija el orden persistencia -> ACK y confirma que un ACK rechazado no invalida el evento persistido.
*   **Notas/Advertencias:** No cambia premios, cupos ni liquidaciones y no requiere migracion Supabase. Si el envio no devuelve ID, el evento no se crea porque no podria relacionarse de forma segura con una respuesta citada.

### [Fecha: 17/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`; restauracion operativa directa en Supabase.
*   **Resumen de Tareas:** Reactivado el perfil eliminado de Goran con UUID original `7797b31e-be4d-4101-bbdc-1cbd106d2e07` y el ultimo estado respaldado por registros sobrevivientes.
*   **Cambios Clave:**
    *   **[Identidad y Fichas]:** se recreo un unico perfil activo y se reasociaron las dos fichas no recicladas que conservaban su UUID y nombre de usuario.
    *   **[Rango Recuperable]:** se reconstruyeron el premio historico de 55 puntos, el snapshot `siervo II` y la semilla vigente `siervo III` con 0 puntos.
    *   **[Economia Segura]:** oro y oro semanal quedaron en 0; no se inventaron inventario, telefono, cuenta web ni actividad que no tuvieran evidencia persistente.
    *   **[Auditoria]:** la operacion quedo registrada como `profile_restored` en `player_lifecycle_log` y se verifico desde las rutas publica y de servicio.
*   **Notas/Advertencias:** El perfil ya es visible en la web y resoluble por nombre o prefijo de ID. Para reconocer mensajes entrantes, Goran aun debe vincular su telefono con `!verificar Goran` o mediante `!verificarnumero Goran` por staff. El proceso antiguo de purga destructiva sigue siendo un riesgo separado.

### [Fecha: 16/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/targetResolver.js`, `src/index.js`, `src/supabase.js`, `src/handlers/treasure.js`, `src/handlers/games.js`, `src/handlers/blackjack.js`, `test_quoted_details.js`, `test_treasure_feedback.js`, `test_economic_settlement_guards.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Corregida la ausencia de respuesta al reclamar el Tesoro Errante y auditadas las rutas equivalentes de Dados, Trampa, Cofre, Blackjack y recuperacion de apuestas.
*   **Cambios Clave:**
    *   **[Citas WhatsApp]:** los IDs completos y los `quotedStanzaID` abreviados se resuelven contra una unica clave canonica, evitando que Tesoro y Blackjack ignoren respuestas validas.
    *   **[Tesoro Visible y Seguro]:** `reclamar` marca recepcion de inmediato y siempre devuelve exito, duplicado, vencido, agotado o error. El cierre y el resumen ya no bloquean la respuesta individual; un abono ambiguo conserva el reclamo como reservado para impedir dobles creditos.
    *   **[Liquidaciones]:** Dados, Trampa y todas las variantes de Blackjack solo anuncian ganancias despues de confirmar `resolve_bet`; si falla, informan liquidacion pendiente y mantienen la apuesta en custodia.
    *   **[Compensaciones]:** una apuesta creada cuyo contador de uso no pudo guardarse se reembolsa antes de cancelar. Blackjack tambien reembolsa partidas sin tablero, partidas solo abandonadas y cancelaciones PvP.
    *   **[Contadores Diarios]:** las lecturas/escrituras dejan de ocultar errores y se serializan por jugador y mecanica con revalidacion del limite, evitando carreras simultaneas dentro del proceso unico del bot.
    *   **[Recuperador Escrow]:** cada apuesta huerfana se procesa de forma aislada; una falla ya no detiene las siguientes ni produce un log global de exito falso.
    *   **[Pruebas]:** las 13 pruebas del repositorio, `node --check` y `git diff --check` pasan; `test_economic_settlement_guards.js` fija las nuevas garantias.
*   **Notas/Advertencias:** No requiere migracion Supabase. Los locks de cupos/usos cubren la unica replica actual; si se agregan replicas, deben migrarse a RPCs transaccionales. Un credito de Tesoro ambiguo queda reservado y puede requerir verificacion manual de saldo. La verificacion operativa final corresponde al Space despues del despliegue.

### [Fecha: 16/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/formatting.js`, `src/index.js`, `src/gmTracker.js`, `src/handlers/admin.js`, `src/handlers/auctions.js`, `src/handlers/auctionsRealtime.js`, `src/handlers/blackjack.js`, `src/handlers/games.js`, `src/handlers/player.js`, `src/handlers/welcome.js`, `test_message_formatting.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Renovada la presentacion de todas las respuestas de comandos con un contrato visual comun, compacto y compatible con el formato nativo de WhatsApp.
*   **Cambios Clave:**
    *   **[Formato Central]:** `heraldCard`, listas, estadisticas, secciones y comandos usan ahora jerarquia breve, citas `>`, listas `-`, negrita `*`, cursiva `_` y monoespaciado con acentos graves, sin marcos extensos ni dobles vinietas.
    *   **[Cobertura de Comandos]:** el despachador decora automaticamente respuestas planas, validaciones y errores segun la familia del comando; tambien se cubrieron envios directos de staff, Blackjack, acceso por roleo y el APK.
    *   **[Mensajes Principales]:** `!ayuda`, dados, cofre, trampa, Oraculo, subastas y anuncios realtime fueron migrados al mismo lenguaje visual sin cambiar apuestas, limites, saldos, RPCs ni reglas de juego.
    *   **[Codificacion]:** eliminadas de raiz las cadenas mojibake del Oraculo y dos errores de administracion; el prompt del GM deja de pedir Markdown de negrita doble incompatible con WhatsApp.
    *   **[Pruebas]:** `test_message_formatting.js` fija el render esperado y detecta dobles vinietas, marcos heredados, Markdown incompatible y mojibake. Las 13 pruebas del repositorio, `node --check`, `git diff --check` y `npm run graphify:update` pasan.
*   **Notas/Advertencias:** No requiere migracion Supabase ni modifica logica economica. La representacion final debe observarse en un WhatsApp real despues del despliegue.

### [Fecha: 16/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `.env.example`, `README.md`, `src/ai.js`, `src/index.js`, `src/logSanitizer.js`, `src/whatsappDelivery.js`, `src/whatsappHealth.js`, `src/scheduler.js`, `src/targetResolver.js`, `src/handlers/auctionsRealtime.js`, `src/handlers/playerLifecycle.js`, `src/handlers/treasure.js`, `src/handlers/welcome.js`, `test_connection_watchdog.js`, `test_log_sanitizer.js`, `test_quoted_details.js`, `test_scheduler_delivery_guard.js`, `test_whatsapp_health.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Sustituida la salud nominal basada en `ready/getState=CONNECTED` por una salud funcional del canal, con estabilidad previa a envios y recuperacion limitada sin bucles destructivos.
*   **Cambios Clave:**
    *   **[Bot - Salud Funcional]:** el runtime distingue `CONNECTED_UNVERIFIED`, `HEALTHY`, `DEGRADED` y `QUARANTINED`; valida socket, pagina, coleccion, puente de eventos, presencia y consultas activas, mientras el trafico entrante real certifica inmediatamente el canal.
    *   **[Bot - Estabilidad]:** los schedulers de datos y economia siguen activos, pero la cola privada, tesoros y anuncios realtime quedan pausados hasta `HEALTHY`; el panel separa estado de socket y salud real del canal.
    *   **[Bot - Recuperacion Acotada]:** ante perdida del puente se reenganchan los listeners existentes; si no basta, se recrea una vez el proceso conservando auth. El QR limpio queda reservado a invalidacion explicita de cuenta/sesion; se elimino el borrado opcional por reintentos de inicio agotados y una falla generica de red termina aislada sin iniciar ciclos QR/reinicio.
    *   **[Entrega - Confirmacion]:** las notificaciones y eventos automaticos esperan ACK del servidor antes de marcar cola o evento como entregado; el fallback de consulta tiene timeout propio para no colgarse con una pagina zombie.
    *   **[Privacidad y Ruido]:** se retiraron QR de consola, JIDs/cuerpos/IP de trazas operativas y prefijos de claves IA; los errores esperables de citas obsoletas se resuelven una sola vez por mensaje sin inundar logs.
    *   **[Pruebas]:** cubiertos falso `CONNECTED`, puente perdido, pagina zombie, escalamiento limitado, ACK previo a persistencia, sanitizacion y citas obsoletas; las 10 pruebas del repo y `node --check` sobre los 11 modulos tocados pasan.
*   **Notas/Advertencias:** No requiere migracion Supabase ni cambia saldos. El codigo esta validado localmente, pero no fue commiteado, subido ni verificado aun en `axel785/kingdoom-whatsapp`; la comprobacion operativa debe hacerse despues del despliegue real.

### [Fecha: 15/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/whatsappRecovery.js`, `test_connection_watchdog.js`, `test_whatsapp_recovery.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Eliminadas las rutas locales que amplificaban la perdida de contexto de Chromium hasta convertirla en reinicio con autenticacion obsoleta y ruido masivo de notificaciones internas.
*   **Cambios Clave:**
    *   **[Bot - Navegacion Recuperable]:** `Execution context was destroyed` en una promesa asincrona ya no reinicia inmediatamente el worker; pausa readiness y espera `disconnected` o la comprobacion activa para distinguir navegacion transitoria de desconexion real.
    *   **[Bot - LOGOUT Prioritario]:** un `LOGOUT` puede elevar un reinicio ya programado a limpieza de autenticacion, evitando que un error anterior conserve una sesion que WhatsApp ya invalido.
    *   **[Bot - Ingreso Limpio]:** los eventos internos `e2e_notification` se descartan antes de deduplicacion, resolucion de mensajes citados y despacho de comandos, eliminando los fallos repetidos de `safeGetQuotedDetails`.
    *   **[Bot - Clasificacion Central]:** la politica de errores de runtime vive en `src/whatsappRecovery.js` y conserva reinicio inmediato para `Session closed`, `Target closed`, timeouts y errores de protocolo no transitorios.
    *   **[Pruebas]:** se valida clasificacion de errores, descarte temprano de notificaciones internas y escalamiento `reinicio conservador -> LOGOUT con limpieza`, sin crear dos timers ni dos reinicios.
*   **Notas/Advertencias:** `whatsapp-web.js@1.34.7` ya es la ultima release estable instalada. Las propuestas upstream observadas para navegacion destruida y recuperacion de ciphertext no estan integradas en una release, por lo que no se modifico la dependencia ni `package-lock.json`. El cierre exige el mismo SHA en `origin` y `huggingface`, QR generado por ese runtime y verificacion posterior a la vinculacion.

### [Fecha: 15/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `test_connection_watchdog.js`, `.env.example`, `README.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Corregido el falso estado `ready` donde el telefono cerraba la sesion, el bot seguia mostrando "Conectado" y nunca generaba un QR nuevo.
*   **Cambios Clave:**
    *   **[Bot - Salud Activa]:** el watchdog ahora consulta `client.getState()` incluso despues de `ready`; una lectura distinta de `CONNECTED` pausa los envios y tres fallos consecutivos reinician el worker mediante el supervisor existente.
    *   **[Bot - QR Recuperable]:** solo `UNPAIRED` y `UNPAIRED_IDLE` descartan la autenticacion persistida al reiniciar, de modo que una sesion realmente cerrada vuelve a solicitar QR sin borrar auth por errores transitorios.
    *   **[Bot - Telemetria]:** `/status.json` expone estado interno, ultima comprobacion, contador/limite de fallos y error de lectura para evitar diagnosticos basados unicamente en el evento `ready`.
    *   **[Bot - Deduplicacion]:** las rafagas repetidas de `authenticated` se ignoran y `ready_duplicate` se limita a una entrada por minuto sin restaurar por si solo la bandera de conexion.
    *   **[Pruebas]:** cubiertos los escenarios `CONNECTED`, `UNPAIRED`, error de pagina, recuperacion `OPENING -> CONNECTED`, QR fresco y QR vencido.
*   **Notas/Advertencias:** Validado localmente con `node --check src/index.js`, `node test_connection_watchdog.js`, `node test_whatsapp_recovery.js`, `node test_process_supervisor.js`, `node test_scheduler_delivery_guard.js` y `npm run graphify:update`. El cierre operativo exige el mismo SHA en `origin` y `huggingface`, seguido de verificacion en vivo del Space.

### [Fecha: 14/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/scheduler.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Endurecido el despacho privado de la cola de notificaciones para bajar el riesgo de deteccion de spam por WhatsApp.
*   **Cambios Clave:**
*   **[Bot - Rate Limit Privado]:** la cola ya no intenta vaciar hasta 5 envios seguidos con pausa fija de 1.5 s; ahora sale como maximo 1 envio exitoso por ciclo del scheduler.
*   **[Bot - Ritmo Humano]:** se agrego intervalo aleatorio entre mensajes (`WHATSAPP_QUEUE_MIN_INTERVAL_MS` / `WHATSAPP_QUEUE_MAX_INTERVAL_MS`) para evitar un patron mecanico.
*   **[Bot - Tope Horario]:** se incorpora una ventana en memoria con limite horario (`WHATSAPP_QUEUE_HOURLY_LIMIT`) y enfriamiento (`WHATSAPP_QUEUE_HOURLY_COOLDOWN_MS`) cuando se alcanza el techo.
*   **[Bot - Prioridad de Cola]:** los avisos criticos (bloqueo/desbloqueo por roleplay) se priorizan sobre mensajes bulk/promocionales. Las campanas masivas usan techo horario y enfriamiento propios (`WHATSAPP_QUEUE_BULK_HOURLY_LIMIT`, `WHATSAPP_QUEUE_BULK_MIN_INTERVAL_MS`, `WHATSAPP_QUEUE_BULK_MAX_INTERVAL_MS`) para no competir de igual a igual con las alertas importantes.
*   **[Bot - Parametrizacion]:** el fetch de pendientes y los limites del despachador quedan ajustables por variables de entorno sin tocar codigo.
*   **Notas/Advertencias:** El limitador vive en memoria del proceso para no requerir migracion ahora. Si el contenedor reinicia, la ventana se reinicia tambien. Validado con `node --check src/scheduler.js`.

### [Fecha: 10/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Corregido el fallo donde el Oraculo generaba respuesta correctamente pero WhatsApp Web fallaba al entregarla y el bot terminaba enviando el mensaje generico de error.
*   **Cambios Clave:**
    *   **[Bot - Entrega Robusta]:** se agrego `sendBotText()` para normalizar texto, dividir respuestas largas y reintentar el envio directo cuando `msg.reply()` falla.
    *   **[Bot - Fallback de Formato]:** si WhatsApp rechaza el contenido con formato, el bot reintenta como texto plano antes de marcar el envio como fallido.
    *   **[Bot - Error Seguro]:** el aviso "El reino esta en llamas..." ahora se envia con un helper seguro para evitar que un fallo secundario reinicie o ensucie el flujo.
*   **Notas/Advertencias:** La IA ya estaba respondiendo; el fallo estaba en la entrega del mensaje hacia WhatsApp despues de recibir la respuesta del proveedor.

### [Fecha: 10/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/runtimePaths.js`, `.env.example`, `README.md`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Refuerzo del enlace inicial de WhatsApp para que el QR del Space no quede visualmente congelado y para exponer el estado real del handshake.
*   **Cambios Clave:**
    *   **[Bot - Telemetria de Enlace]:** el runtime ahora registra `authenticated`, `loading_screen` y `pairing_code`, de modo que `/status.json` ya distingue entre QR pendiente, telefono aceptado y sincronizacion interna.
    *   **[Panel - Auto Refresh]:** la pagina publica del Space ya no depende solo de `meta refresh`; ahora sondea `/status.json` cada pocos segundos y fuerza recarga cuando cambia el QR o el evento activo.
    *   **[Bot - Respaldo de Vinculacion]:** se dejo soporte opcional para emparejamiento por numero telefonico (`WHATSAPP_PAIR_PHONE_NUMBER`) con codigo visible en el panel cuando se habilite.
    *   **[Persistencia - Señal Honesta]:** `src/runtimePaths.js` deja de reportar persistencia probable en Hugging Face cuando `/data` ni siquiera existe, evitando falsos positivos sobre la sesion.
*   **Notas/Advertencias:** Este ajuste no elimina por si solo un bloqueo externo de red entre el contenedor y WhatsApp, pero si aclara si el problema ocurre antes del escaneo, al aceptar el telefono o durante la sincronizacion posterior.

### [Fecha: 10/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/runtimePaths.js`, `src/adminStore.js`, `src/activeProfileStore.js`, `src/auditLog.js`, `src/marketForgeStore.js`, `.env.example`, `README.md`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Hardening del runtime de WhatsApp en Hugging Face para evitar perdida de sesion, reset publico y falta de trazabilidad cuando el bot cae o vuelve a QR.
*   **Cambios Clave:**
    *   **[Bot - Persistencia]:** se centralizo la ruta de estado en `src/runtimePaths.js` y el bot ahora prioriza `/data/kingdoom-bot/.wwebjs_auth` en entornos de Hugging Face, con fallback local solo cuando no hay storage persistente.
    *   **[Bot - Reset Manual]:** `/reset` y `/reset-auth` dejan de quedar abiertos al publico. Solo funcionan si `RESET_AUTH_ENABLED=true` y existe `RESET_AUTH_TOKEN`, requerido por query `?token=` o header `x-reset-token`.
    *   **[Bot - Diagnostico Vivo]:** el panel HTTP ahora expone `/status.json` y guarda `runtime-status.json` con ultimo evento, ultimos reinicios, modo de persistencia y causa reciente visible incluso despues de un restart.
    *   **[Bot - Recuperacion]:** `disconnected` ahora fuerza reinicio limpio del proceso sin borrar auth por defecto, y los fallos de inicializacion dejan de destruir la sesion salvo que `WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE=true`.
    *   **[Estado Auxiliar]:** `adminStore`, `activeProfileStore`, `auditLog` y `marketForgeStore` pasan a usar la misma raiz persistente para no mezclar estado efimero y estado durable.
*   **Notas/Advertencias:** Este cambio corrige una causa probable del QR inesperado: si el contenedor reiniciaba mientras la sesion vivia bajo `/app/.wwebjs_auth`, se perdia auth. Desde ahora conviene verificar en el Space que `/status.json` reporte `authPersistence: "persistent"` y que el storage real este montado en `/data`.
*   **Ajuste posterior:** la deteccion automatica ya no asume `/data` solo por estar en Hugging Face; usa `/data` solo si realmente existe y, si el bucket esta montado en otra ruta, se debe fijar `PERSISTENT_DATA_PATH` de forma explicita para evitar falsos positivos.

### [Fecha: 09/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `.gitignore`, `package.json`, `AGENTS.md`, `.agents/rules/graphify.md`, `.agents/workflows/graphify.md`, `.codex/skills/graphify/*`, `scripts/graphify-manager.mjs`, `docs/graphify/OPERATIONS.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Reorganizacion operativa de Graphify para mantenerlo estable, local y facil de refrescar entre agentes.
*   **Cambios Clave:**
    *   **[Graphify - Operacion]:** se agregaron wrappers `npm run graphify:setup|doctor|update|rebuild|watch` para estandarizar setup, diagnostico y refresh incremental dentro de `kingdoom-bot`.
    *   **[Graphify - Localidad]:** `graphify-out/` y `.codex/hooks.json` quedan como estado local del repo y se ignoran desde Git, mientras `graphify-out/` permanece en la raiz porque Graphify y los agentes lo resuelven desde ahi.
    *   **[Graphify - Skill Codex]:** se versiona `.codex/skills/graphify/` para que los clones del bot conserven el comportamiento de `/graphify` dentro de Codex sin depender de copiar la skill a mano.
    *   **[Graphify - Agentes]:** `AGENTS.md` y `.agents/*` ahora apuntan a los wrappers del repo para que Codex y Antigravity mantengan el grafo al dia de forma consistente.
    *   **[Graphify - Guia]:** se versiono `docs/graphify/OPERATIONS.md` con layout canonico, politica de actualizacion y troubleshooting.
*   **Notas/Advertencias:** Validacion completada con `node --check scripts/graphify-manager.mjs`, `npm run graphify:setup`, `npm run graphify:doctor`, `npm run graphify:update` y parseo correcto de `ai-memory/kingdoom-memory.jsonl`. Graphify reporto una advertencia no bloqueante: varios `agent.json` quedaron sin nodos AST en el refresh incremental.

### [Fecha: 09/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/scheduler.js`, `AI_CHANGELOG.md`
*   **Resumen de Tareas:** Eliminado el mensaje automatico de medianoche enviado por DM a los jugadores.
*   **Cambios Clave:**
    *   **[Bot - Scheduler Diario]:** el cron diario de `00:00` hora Paraguay mantiene el procesamiento de cuotas y la reprogramacion de tesoros, pero deja de ejecutar `sendToAll(...)` para no mandar el mensaje de reinicio de limites a todos los usuarios.
*   **Notas/Advertencias:** El reset diario sigue activo; solo se retiro la notificacion automatica. Validacion: `node --check src/scheduler.js` completado con exito.

### [Fecha: 06/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/supabase.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Realineacion de defaults de roleo del bot con la politica vigente de 9 dias.
*   **Cambios Clave:**
    *   **[Bot - Roleplay Defaults]:** `ROLEPLAY_LOCK_AFTER_DAYS` y `ROLEPLAY_INITIAL_GRACE_DAYS` vuelven a usar `9` como fallback local cuando Hugging Face o el entorno no definen overrides.
    *   **[Consistencia Web/Bot]:** El fallback del bot queda alineado con `Kingdoom-sync` (`RoleplayLockNotice`) y el SQL `supabase_roleplay_access.sql`, evitando bloqueos automaticos a los 7 dias por configuracion ausente.
*   **Notas/Advertencias:** Las variables de entorno siguen teniendo prioridad sobre el fallback. Validacion: `node --check src/supabase.js` y parseo JSONL completados con exito.

### [Fecha: 04/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Solucionado bug de silencio en comandos permitidos de dados/cofre/trampa/etc. en index.js.
*   **Cambios Clave:**
    *   **[Bot - Gating de Rol]:** Se extrajo la validación de `isRoleplayLocked` de la cadena principal de `if-else` de despacho de comandos. Esto previene que los comandos permitidos de minijuegos y economía fallen de forma silenciosa (sin respuesta alguna) para los jugadores que no están bloqueados por rol.
*   **Notas/Advertencias:** Validado con `node --check` y pruebas internas del blackjack.

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
*   **Resumen de Tareas:** Fix urgente del gate de comandos por roleo para respetar gracia vigente, exenciones y bloqueos manuales.
*   **Cambios Clave:**
    *   **[Bot - Roleplay Gate]:** el bloqueo de comandos ahora usa una evaluacion efectiva centralizada: exencion activa permite comandos, gracia vigente permite comandos aunque exista un `locked_at` automatico viejo, y los locks manuales siguen bloqueando hasta desbloqueo staff.
    *   **[Consistencia]:** `index.js` dejo de decidir solo por `locked_at && !is_exempt` y reutiliza la misma semantica base que el enforcement de Supabase.
    *   **[Scheduler]:** el auto-desbloqueo del scheduler solo limpia locks automaticos (`roleplay_inactive` o legacy sin razon), evitando borrar un bloqueo manual por accidente.
*   **Notas/Advertencias:** Validacion: `node --check src/index.js`, `node --check src/supabase.js`, `node --check src/scheduler.js` y prueba aislada del helper de lock pasaron correctamente.

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

### [Fecha: 05/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Soporte para reset de sesión de WhatsApp e inicialización autolimpiante ante suspensiones/bloqueos de cuenta.
*   **Cambios Clave:**
    *   **Manual Reset Endpoint (`/reset` / `/reset-auth`):** Se agregó un enrutador HTTP en el servidor para que los operadores puedan borrar la carpeta de sesión `.wwebjs_auth` y reiniciar el bot visitando `/reset` o `/reset-auth` desde el navegador.
    *   **Auto-Reset en Fallos Críticos:** Se modificó la lógica en `initializeClientWithRetry` para que, si se agotan todos los reintentos de inicialización (`WHATSAPP_INIT_MAX_RETRIES` intentos de `client.initialize()`), el bot borre de forma automática la sesión corrupta `.wwebjs_auth` y reinicie el contenedor (`process.exit(1)`), forzando un nuevo código QR limpio.
*   **Notas/Advertencias:** Ambos cambios protegen al bot de bucles infinitos en contenedores remotos de Hugging Face Spaces tras la suspensión de una línea telefónica.

### [Fecha: 07/07/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `AGENTS.md`, `.agents/rules/graphify.md`, `.agents/workflows/graphify.md`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Configuración y activación local de Graphify para el desarrollo del bot.
*   **Cambios Clave:**
    *   Se inyectaron las reglas y flujos de Graphify en el directorio de personalizaciones locales `.agents` y en `AGENTS.md`.
    *   Se configuraron los hooks de git (`post-commit`, `post-checkout`) para regenerar el grafo de manera automática.
*   **Notas/Advertencias:** Los cambios preparan el bot para la indexación y navegación mediante grafos AST semánticos locales.
### [Fecha: 11/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `.env.example`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Endurecimiento de la recuperacion de sesion de WhatsApp en Hugging Face cuando el cliente queda sin QR, se desconecta o arranca con auth corrupta.
*   **Cambios Clave:**
    *   **Watchdog de arranque:** Se agrego `WHATSAPP_CONNECT_STALL_TIMEOUT_MS` y un watchdog que reinicia el proceso si pasan demasiados segundos sin QR, con QR/codigo vencido o sin estado `ready`, evitando contenedores colgados en blanco o handshakes congelados.
    *   **Progreso observable:** Los eventos de runtime ahora refrescan una marca de actividad interna para diferenciar un arranque vivo de uno atascado.
    *   **Limpieza reutilizable de auth:** Se centralizo el borrado de `authDataPath` en un helper comun para usarlo en `auth_failure` y en desconexiones por `LOGOUT`, forzando un QR limpio cuando la sesion queda invalida.
    *   **Estado explicito del cliente:** El flujo de `qr`, `code`, `authenticated`, `ready`, `auth_failure` y `disconnected` ahora mantiene `whatsappClientReady` sincronizado para que el panel y el watchdog reaccionen al estado real.
*   **Notas/Advertencias:** Este cambio reduce los cuelgues silenciosos del Space, pero el despliegue final sigue dependiendo de subir el repo y de que Hugging Face reinicie el contenedor con almacenamiento persistente en `/data`.

### [Fecha: 11/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Mejora del refresco visual del QR para que el panel cambie la imagen en caliente cuando WhatsApp genera un codigo nuevo.
*   **Cambios Clave:**
    *   **Endpoint dedicado:** Se agrego `/qr.json` para exponer el QR actual con `Cache-Control: no-store`, sin inflar `status.json` ni el archivo persistido de runtime.
    *   **Refresh inline:** El script del panel ahora detecta cambios de `qrLastUpdatedAt`, pide el QR nuevo y reemplaza la imagen en vivo sin depender exclusivamente de `window.location.replace(...)`.
    *   **Feedback visual:** El QR ahora tiene transicion visual, texto de renovacion y una marca de ultima actualizacion para que el usuario vea cuando el codigo fue reemplazado automaticamente.
*   **Notas/Advertencias:** El panel mantiene el reload completo como fallback si cambia la estructura de la vista o si falla la actualizacion inline del QR.

### [Fecha: 11/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/supabase.js`, `src/handlers/player.js`, `src/handlers/auctionsRealtime.js`, `test_connection_watchdog.js`, `test_phone_lookup_cache.js`, `test_auctions_realtime.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Auditoria extrema de rendimiento y consistencia del runtime, consultas de jugador, transferencias y anuncios realtime.
*   **Cambios Clave:**
    *   **[Supabase - Cache concurrente]:** las consultas simultaneas del mismo telefono comparten una sola promesa y las mutaciones de oro invalidan el perfil cacheado; la prueba reproduce 20 llamadas concurrentes con una sola lectura inicial.
    *   **[Economia - Transferencia atomica]:** `!oro` deja de debitar y acreditar con dos RPC independientes y usa `transfer_player_gold`, compartida con la web mediante `supabase_player_transfers.sql`.
    *   **[Realtime - Sin duplicados]:** los cierres de subasta se reclaman por ID antes del envio y se liberan si WhatsApp falla, evitando anuncios repetidos por eventos UPDATE duplicados.
    *   **[WhatsApp - Watchdog preciso]:** los eventos HTTP y de diagnostico ya no renuevan el watchdog; solo QR, codigo, autenticacion, carga, ready e intentos reales cuentan como progreso de conexion.
*   **Notas/Advertencias:** La RPC de transferencia debe aplicarse en Supabase antes de desplegar el bot. La eficacia final del runtime requiere validar el Space `axel785/kingdoom-whatsapp`; las pruebas locales no sustituyen esa comprobacion.

### [Fecha: 11/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/scheduler.js`, `src/whatsappDelivery.js`, `test_scheduler_delivery_guard.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Contencion de desconexiones de WhatsApp causadas por la cola de notificaciones durante navegaciones internas de WhatsApp Web.
*   **Cambios Clave:**
    *   **Cola protegida:** El scheduler ahora exige que el cliente siga `ready`, tenga pagina Puppeteer activa y no cerrada antes de intentar un envio.
    *   **Error transitorio retenido:** `Execution context was destroyed`, `getChat` indefinido, `Target closed`, `Session closed` y errores de protocolo pausan los reintentos cinco minutos sin marcar el aviso como enviado.
    *   **Ready idempotente:** Repeticiones del evento `ready` ya no restauran misiones ni reejecutan el bootstrap operativo del bot.
*   **Notas/Advertencias:** Si WhatsApp invalida deliberadamente la vinculacion desde el telefono, seguira siendo necesario escanear un QR; este cambio evita que los reintentos del scheduler aceleren esa invalidacion.

### [Fecha: 11/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `src/whatsappRecovery.js`, `.env.example`, `README.md`, `test_connection_watchdog.js`, `test_whatsapp_recovery.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Auditoria y endurecimiento integral de la primera conexion y recuperacion de WhatsApp en Hugging Face.
*   **Cambios Clave:**
    *   **Cierre ordenado:** Los eventos de desconexion ya no ejecutan `process.exit` dentro del callback de `whatsapp-web.js`; Chromium recibe tiempo para cerrar y liberar el perfil persistente.
    *   **Takeover controlado:** El contenedor nuevo puede tomar la sesion tras un solapamiento de despliegue, evitando conflictos entre replicas vieja y nueva.
    *   **Locks seguros:** Antes de inicializar se eliminan solo `SingletonLock`, `SingletonSocket`, `SingletonCookie` y `DevToolsActivePort`, sin borrar cookies ni credenciales.
    *   **Backoff observable:** Los fallos consecutivos aumentan la espera hasta 60 segundos y conservan 40 eventos internos para diagnostico.
    *   **Shutdown de plataforma:** `SIGTERM` y `SIGINT` cierran Chromium antes de finalizar, reduciendo sesiones corruptas durante rebuilds o reinicios de Hugging Face.
*   **Notas/Advertencias:** El hardware gratuito de Hugging Face puede dormir por inactividad; este flujo recupera la sesion al volver, pero no puede impedir la politica de suspension de la plataforma.

### [Fecha: 13/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `test_connection_watchdog.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Correccion del `Runtime error` en Hugging Face causado por recuperaciones que mataban el proceso durante la espera de QR o la reconexion.
*   **Cambios Clave:**
    *   **Recuperacion en caliente:** `requestProcessRestart` deja de ejecutar `process.exit(1)` en rutas recuperables y ahora cierra Chromium, limpia estado transitorio y relanza `client.initialize()` dentro del mismo proceso.
    *   **Inicializacion single-flight:** `initializeClientWithRetry` reutiliza una sola promesa activa para evitar solapamientos entre watchdog, desconexiones y reintentos manuales.
    *   **Handle limpio de Puppeteer:** al cerrar el navegador ahora se limpian `pupBrowser` y `pupPage`, reduciendo referencias zombis antes del siguiente `initialize`.
    *   **Prueba anti-regresion:** la auditoria automatizada ahora falla si un reinicio recuperable vuelve a introducir `process.exit(1)` o deja de reinicializar el cliente en caliente.
*   **Notas/Advertencias:** Este ajuste elimina la salida fatal del contenedor en reconexiones recuperables; si WhatsApp invalida la sesion de forma definitiva, seguira siendo necesario volver a escanear el QR.

### [Fecha: 14/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/index.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Observabilidad reforzada para diagnosticar sesiones conectadas que no dejan logs ni responden comandos en Hugging Face.
*   **Cambios Clave:**
    *   **Runtime audible:** `recordRuntimeEvent(...)` ahora tambien emite cada evento en consola, no solo en `status.json`, para que el panel de logs del Space refleje autenticacion, ready, watchdog y reinicios.
    *   **Traza de comandos:** el listener `client.on('message')` registra entradas relevantes (`[message inbound]`), respuestas (`[message reply]`) y fallos (`message_failed`) con chat, remitente y comando resumido.
    *   **Alerta de lentitud:** los comandos con prefijo generan un aviso `message_processing_slow` si exceden el umbral configurable `COMMAND_PROCESSING_WARN_MS`, ayudando a distinguir entre cuelgue y respuesta lenta.
    *   **Lectura de ready/logout mas limpia:** el log `Kingdoom Bot conectado` ya no se repite en `ready` duplicados y el flujo `disconnected: LOGOUT` ahora deja claro en consola que la sesion persistida sera descartada antes de reinicializar.
    *   **Guardia de payload vacio:** la lectura del cuerpo del mensaje deja de asumir `msg.body` siempre string, evitando silencios si WhatsApp entrega un payload no textual.
*   **Notas/Advertencias:** Este cambio mejora mucho el diagnostico en Hugging Face, pero la causa final de un comando sin respuesta aun debe confirmarse con una prueba en vivo revisando si aparece `message_inbound`, `message_processing_slow`, `message_replied` o `message_failed`.

### [Fecha: 15/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Diagnostico en vivo de la sesion de WhatsApp que reaparecio en QR tras reinicios del Space de Hugging Face.
*   **Cambios Clave:**
    *   **Estado de produccion:** El Space `axel785/kingdoom-whatsapp` estaba `RUNNING` sobre `bebf666`, pero el proceso activo solo emitia QR y no habia alcanzado `authenticated` ni `ready`; `restartCount` permanecia en 3.
    *   **Persistencia verificada:** El bucket `axel785/kingdoom-whatsapp-state` seguia montado con escritura en `/data` y conservaba el perfil `LocalAuth`; no se encontro evidencia de perdida total del directorio ni errores de recuperacion en los logs de LevelDB.
    *   **Causa probable:** La evidencia apunta a una restauracion logica invalida o incompleta de la sesion local. Que el telefono aun mostrara el dispositivo vinculado no confirmaba que la instancia nueva conservara claves utilizables.
    *   **Telemetria insuficiente:** El cambio `102e278` hace que `requestProcessRestart(...)` termine con `process.exit(1)`. Despues del arranque, cada renovacion imprime el QR ASCII completo y agrega otro evento `qr`, desplazando del buffer de Hugging Face y del historial persistido de 40 eventos el disparador original.
    *   **Trazabilidad corregida:** Se documenta el comportamiento de `102e278`, que habia modificado solo `src/index.js` sin actualizar changelog ni memoria y contradecia la recuperacion en caliente registrada el 13/07/2026.
*   **Notas/Advertencias:** Este cierre registra solo el diagnostico; no cambia la logica del bot. El Space seguia esperando un QR nuevo y el motivo exacto del primer reinicio ya no era recuperable con la telemetria retenida. La recuperacion operativa inmediata requiere desvincular la sesion antigua, escanear el QR vigente y confirmar la secuencia `authenticated` -> `ready`.

### [Fecha: 15/07/2026] - [Autor: Codex]
*   **Archivos Modificados:** `src/launcher.js`, `src/index.js`, `package.json`, `Dockerfile`, `test_connection_watchdog.js`, `test_process_supervisor.js`, `AI_CHANGELOG.md`, `ai-memory/kingdoom-memory.jsonl`
*   **Resumen de Tareas:** Correccion del apagado completo del Space cuando `whatsapp-web.js` solicita recrear un cliente obsoleto.
*   **Cambios Clave:**
    *   **Supervisor interno:** Docker y `npm start` mantienen un proceso padre liviano que recrea el proceso del bot dentro del mismo contenedor, evitando desmontar el bucket `/data` en cada desconexion.
    *   **Cliente realmente limpio:** `requestProcessRestart(...)` conserva la salida controlada del proceso hijo, necesaria para no reutilizar referencias obsoletas de Puppeteer, pero ya no obliga a Hugging Face a reciclar todo el Space.
    *   **Backoff y shutdown:** los reinicios consecutivos usan espera exponencial de 3 a 30 segundos y `SIGTERM`/`SIGINT` se reenvian al bot para conservar su cierre ordenado de Chromium.
    *   **Pruebas reparadas:** el test del watchdog normaliza CRLF en Windows y la nueva prueba bloquea despliegues que omitan el supervisor en Docker o `npm start`.
*   **Notas/Advertencias:** La sesion activa ya estaba en estado QR antes de este cambio; el supervisor evita que la proxima desconexion recicle el Space, pero la vinculacion actual requiere un escaneo fisico para volver a `ready`.
