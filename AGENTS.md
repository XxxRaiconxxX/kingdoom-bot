# Kingdoom Agent Protocol — kingdoom-bot (Codex CLI)

Este documento es la guía técnica y protocolo de comportamiento para **Codex CLI**, Antigravity, Jules y cualquier agente de IA que opere en este repositorio.

---

## 0. Alcance de este repo

Dominio bot/backend: Bot de WhatsApp autónomo (Node.js / ESM / Baileys / Docker), desplegado en Hugging Face / Railway.

**REGLA DE CARRIL:** Trabajás exclusivamente en este repo. No tocás `Kingdoom-sync` ni `kingdoom-library` sin pedido explícito.

### Ecosistema Kingdoom:
- `Kingdoom-sync` (en carpeta `Kingdoom`): Portal web SPA, minijuegos de taberna y panel admin/GM.
- `kingdoom-bot`: Lógica del bot de WhatsApp, minijuegos y economía (este repo).
- `kingdoom-fichas`: App de gestión de fichas de personaje RPG.
- `kingdoom-library`: Códice digital (lore, reglas, guías y distribución de APKs).
- `kingdoom-graphify-ops`: Operaciones compartidas de Graphify, scripts y hooks.

---

## 1. Arquitectura del Repositorio

Todo el código fuente reside en el directorio `src/`:
- `src/index.js`: Punto de entrada principal. Inicializa el cliente WhatsApp (`whatsapp-web.js` / Baileys), establece conexiones a Supabase y despacha mensajes entrantes a sus handlers correspondientes.
- `src/supabase.js`: Wrapper para operaciones con la base de datos Supabase y ejecución de Remote Procedure Calls (RPC).
- `src/scheduler.js`: Tareas programadas (cron jobs) para eventos automáticos del sistema (límites diarios, cierre de subastas, purgas y mantenimiento).
- `src/handlers/`: Manejadores modulares de mensajes agrupados por categoría:
  - `admin.js`: Herramientas de Game Master (GM), moderación y comandos de administración.
  - `auctions.js` & `auctionsRealtime.js`: Mecánicas de subasta, retención lock-and-release y cobro de comisiones.
  - `blackjack.js`: Lógica completa del juego de cartas Blackjack.
  - `games.js`: Minijuegos generales y comandos lúdicos para jugadores.
  - `marketForge.js`: Crafteo de economía, forja y mejoras de ítems.
  - `player.js`: Perfil del jugador, consulta de balance, inventario y uso de consumibles.
  - `treasure.js`: Drops de cofres del tesoro y notificaciones de eventos.
  - `welcome.js`: Mensajes y animaciones de bienvenida para nuevos participantes en grupos.
- `src/activeProfileStore.js` & `src/adminStore.js`: Almacenamiento en memoria para cachés de sesión activa.
- `src/auditLog.js`: Sistema central de registro y auditoría de transacciones de oro e inventario.

---

## 2. Reglas de Ingeniería y Guardrails

- **Entorno y Lenguaje:** Node.js con sintaxis estricta de ES Modules (ESM) (utilizar `import`/`export`, no `require`).
- **Dependencias:** No modificar ni commitear `package-lock.json` salvo instrucción explícita.
- **Secretos y Configuración (`.env`):** Nunca hardcodear credenciales, tokens de WhatsApp ni service role keys. Leer configuración mediante `process.env`.
- **Consistencia de Base de Datos:** Toda mutación de saldo u objetos debe pasar por `src/supabase.js` o invocar RPCs transaccionales para garantizar atomicidad y evitar vulnerabilidades de RLS.
- **Auditoría Obligatoria:** Registrar toda alteración de balance o posesión de ítems mediante `src/auditLog.js`.

---

## 3. Reglas de Negocio Relevantes (Validación Previa a Comandos)

- **Subastas en WhatsApp:**
  - Comisión no reembolsable del 25% del precio base (`start_price`) al unirse por primera vez.
  - Modelo Lock-and-Release: el oro ofertado se retiene temporalmente y se reembolsa a los postores perdedores al finalizar la subasta, cobrándose solo al ganador.
  - Pujas Acumulativas: el comando `!pujar [monto]` suma al total acumulado global (ej: puja en 100k + `!pujar 5k` = 105k). Jugador sin saldo suficiente queda descalificado.
- **Cuotas (Installments):**
  - Planes de 3 cuotas (10% recargo) o 6 cuotas (18% recargo).
  - Pociones y consumibles no son financiables.
  - El ítem permanece con `is_locked = true` en el inventario hasta saldar la última cuota.
- **Morosidad:**
  - Jugador con `status = 'defaulted'` en los últimos 14 días tiene denegada cualquier compra a crédito.

---

## 4. Estructura de Base de Datos y RPCs

### Tablas Principales
- `players`: Perfil del jugador (`gold`, `phone`, `is_admin`, `banned`).
- `character_sheets`: Ficha de rol del jugador (columna `playerId` en camelCase).
- `player_inventory`: Inventario real de ítems (columna `player_id` en snake_case, `item_name`, `is_locked`).
- `market_auctions` & `market_auction_bids`: Subastas activas e historial de pujas.

### RPCs que el bot puede invocar
- `place_auction_bid(p_player_id, p_auction_id, p_amount)`: Cobro de comisión, validación de saldo e incremento de puja acumulada.
- `purchase_market_item_v2(p_player_id, p_item_id, p_installments)`: Compra directa o financiada con bloqueo de inventario.
- `resolve_market_auction(p_auction_id)`: Cierre atómico de subasta y liberación de depósitos.
- **Toda validación de saldo e inventario ocurre en Supabase**, nunca asumida localmente en el bot.

---

## 5. Playbooks (Guías Rápidas)

### Agregar un nuevo Comando al Bot
1. Identificar la categoría del comando (admin, juego, perfil, economía).
2. Crear la función manejadora dentro del archivo correspondiente en `src/handlers/`.
3. Registrar el comando y su regex de coincidencia en el despachador de `src/index.js`.
4. Documentar el comando y su sintaxis en el archivo central de ayuda.

### Modificar Lógica de Juegos y Minijuegos
- Editar `src/handlers/blackjack.js` o `src/handlers/games.js`.
- Validar siempre que el jugador cuente con saldo de oro suficiente antes de iniciar la partida y registrar el resultado atómicamente en Supabase.

---

## 6. Convenciones de Mensajería en WhatsApp

- **Formato de Texto:** Usar negritas de WhatsApp (`*texto*`) para destacar oro, ítems y comandos; cursivas (`_texto_`) para ambientación narrativa; emojis temáticos medievales.
- **Diseño Limpio:** Estructurar respuestas con saltos de línea legibles, evitando bloques densos de texto.
- **Sin Separadores Excesivos:** Evitar líneas divisorias repetitivas (como `------------------------`).

---

## 7. Protocolo de Sesión (Sin Rituales)

No anunciar "contexto cargado". Cargar en silencio y ejecutar directo.

---

## 8. Protocolo de Honestidad en Subidas y Despliegues (Push & Deploy Honesty)

Antes de reportar un deploy (Hugging Face / Railway / Docker) o push a GitHub como exitoso:
1. Ejecutar el comando real en terminal (`git push`, `docker push`, etc.) y esperar la salida.
2. Leer la salida completa del comando.
3. Solo reportar éxito ("✅ Desplegado/subido correctamente") si el código de salida es 0 y sin errores.
4. Si falla o no se ejecutó, informar inmediatamente: "⚠️ No se pudo subir/desplegar. Motivo: [error exacto]".

⛔ **PROHIBIDO** asumir que un despliegue funcionó sin ver la salida real.  
⛔ Si hay duda, decir "No lo subí aún" es siempre la respuesta correcta.

---

## 9. Protocolo de Disciplina de Reportes (Report Discipline)

Mismo formato cerrado de reporte único por mensaje (sin acumular reportes de tareas previas):
```markdown
---
[REPORTE] Tarea: [Nombre de la tarea]

Archivos modificados:
  - [archivo 1] — [cambio]

Cambios realizados:
  [resumen conciso]

Comandos ejecutados:
  $ [comando] → [salida]

Advertencias / Riesgos:
  ⚠️ [riesgo o "Ninguno detectado."]

Estado: ✅ Completado / ⚠️ Incompleto / ❌ Error
---
```

---

## 10. Anti-Pereza, Seguridad y Calidad

- Cero placeholders/TODOs en código entregado.
- Prohibido `any` o variables huérfanas sin justificar.
- **Manejo de excepciones obligatorio:** ⛔ Nunca dejar que un fallo o timeout de Supabase tumbe el proceso del bot (envolver en `try/catch` con respuestas amigables al chat).
- ⛔ **PROHIBIDO** loguear números de teléfono reales o PII (información personal) en consola o repositorios públicos.
- ⛔ **PROHIBIDO** ejecutar comandos administrativos fuera de la whitelist de administradores/owners configurada.

---

## 11. Pasos de Validación y Testing Previos a Commit

- Ejecutar `node --check src/index.js` para comprobar la sintaxis de todos los archivos modificados.
- Ejecutar scripts de prueba aislados en la raíz (ej: `node test_blackjack.js`, `test_roleplay_activity.js`).
- Ejecutar la suite completa del proyecto (`npm test`) y verificar que pase sin fallos.
- **Pruebas de Límites Obligatorias:** Si se modifican rangos numéricos o transacciones de economía, probar obligatoriamente el límite máximo y el límite mínimo, nunca únicamente casos triviales (ver Sección 13).
- Confirmar que todos los bloques asíncronos capturan errores adecuadamente.

---

## 12. Integración con Graphify

Este proyecto cuenta con un grafo de conocimiento en `graphify-out/` con nodos centrales y relaciones entre handlers y base de datos.

- Rutas operativas: `graphify-out/graph.json` y `.codex/hooks.json` (locales e ignorados por Git).
- Reglas:
  - Para dudas de flujo de comandos, ejecutar `graphify query "<pregunta>"` o trazar el camino `WhatsApp event -> handler -> helper/store -> Supabase`.
  - Antes de alterar módulos compartidos, ejecutar `graphify affected "<archivo_o_funcion>"`.
  - Ejecutar `npm run graphify:update` tras cambios estructurales de código.

---

## 13. Protocolo de Diagnóstico Forense y Validación de Base de Datos (Anti-Parches Superficiales)

Este protocolo es de cumplimiento estricto para **Codex CLI**, Antigravity y cualquier agente ante tareas de auditoría, soporte de incidencias o corrección de bugs reportados en producción:

### A. Evidencia en Logs Primero (Ground Truth First)
- ⛔ **PROHIBIDO adivinar o asumir la causa de un fallo** basándose únicamente en diferencias de código o lecturas superficiales.
- Ante un error reportado por un usuario o una captura de pantalla, el agente **DEBE consultar los logs reales del sistema** (PostgreSQL vía MCP `get_logs`, logs del contenedor Docker o consola) en la marca de tiempo exacta del incidente.
- No se inicia ninguna modificación de código hasta identificar la excepción cruda del sistema (ej: `violates check constraint`, `null value in column`, `RPC function not found`, `permission denied`).

### B. Auditoría Cruzada Código ↔ Esquema DDL (Constraint Audit)
- Cuando una función interactúa con PostgreSQL (mediante RPC, `insert` o `update`), no basta con verificar que las columnas existan o que los nombres coincidan.
- **Auditoría obligatoria de restricciones DDL:**
  * **`CHECK constraints`:** Verificar que los límites numéricos de la base de datos admitan la totalidad del rango que el código puede generar. Si JavaScript calcula `[10.000, 50.000]`, la base de datos debe permitir hasta `50.000` (o `>= 0`).
  * **`ENUMs / Status checks`:** Confirmar que todos los estados posibles del código (`open`, `claimed`, `closed`, `expired`) estén explícitamente permitidos en el `CHECK (status IN (...))`.
  * **`UNIQUE constraints` y Nulos:** Validar que las claves compuestas y la nulabilidad no choquen con inserciones parciales o flujos asíncronos.
- La regla es: **el código no manda sobre la base de datos; si el código cambia un rango económico o estado, la base de datos DEBE actualizarse en sincronía mediante migración SQL.**

### C. Pruebas de Límites Reales (Boundary Testing Obligatorio)
- ⛔ **PROHIBIDO validar correcciones únicamente con "caminos felices" triviales o valores mínimos.**
- Si una variable o recompensa es un número o rango `[min, max]`:
  * Se debe probar obligatoriamente el valor mínimo (`min`).
  * Se debe probar obligatoriamente el **valor máximo (`max`)**.
  * Se debe probar un valor intermedio típico.
- Si el juego permite hasta 50.000 oro, la prueba debe ejecutar una transacción real con 50.000 oro. Si falla con el valor máximo, la tarea **NO está resuelta**.

### D. Prohibición de Declaración de Éxito Prematuro (Verification Gate)
- Un bug no se considera resuelto porque "el test de sintaxis no arrojó errores" o porque "un evento inexistente no muta saldo".
- La validación debe demostrar que el **caso exacto reportado por el usuario** (mismo comando, mismos argumentos, misma identidad) ahora se completa satisfactoriamente con respuesta de éxito (`status = 'ok'`).
- Todo parche no trivial debe dejar **una prueba residual automatizada** (`test_*.js` o aserción) que falle si la restricción o la RPC se rompen en el futuro.

### E. Integridad y Versionado de Migraciones
- Todo ajuste de esquema o función en Supabase debe:
  1. Aplicarse en el entorno remoto activo.
  2. Quedar guardado en el archivo `.sql` de migración versionado del repositorio para que sea 100% reproducible.
  3. Registrarse en `AI_CHANGELOG.md` y `ai-memory/kingdoom-memory.jsonl` indicando la excepción real resuelta y la prueba de límites efectuada.

