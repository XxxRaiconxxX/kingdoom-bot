# Auditoria de compatibilidad WhatsApp, tesoros y Game Master

Fecha: 2026-07-22
Autor: Codex

## Alcance

- Comando `!data`: adjuntos directos, mensajes citados y mensajes antiguos sin modelo nativo.
- Identidad WhatsApp: remitentes, menciones, participantes y contactos `@lid`.
- Tesoro Errante: identificacion, atribucion visible, cupos y acreditacion de oro.
- `!misionstart` y respuestas del Game Master: menciones, continuidad y formato visible.
- Superficies relacionadas: blackjack multijugador, forja con imagen, bienvenida y lifecycle.

## Evidencia oficial consultada

- La version instalada es `whatsapp-web.js 1.34.7`. Su release incluye correcciones de
  menciones y manejo de modelos LID:
  https://github.com/wwebjs/whatsapp-web.js/releases/tag/v1.34.7
- `Message.downloadMedia()` ya busca el mensaje en cache, intenta resolver el medio y usa
  `WAWebDownloadManager.downloadAndMaybeDecrypt` internamente:
  https://docs.wwebjs.dev/Message.html
  https://github.com/wwebjs/whatsapp-web.js/blob/v1.34.7/src/structures/Message.js
- La API publica `Client.getContactLidAndPhone()` existe para convertir LID y numero:
  https://docs.wwebjs.dev/Client.html#getContactLidAndPhone
- WhatsApp documenta su sintaxis propia de formato; no es Markdown completo:
  https://faq.whatsapp.com/539178204879377
- El tracker oficial registra limites/rate limiting al resolver muchos LID, por lo que los
  grupos grandes se procesan en lotes pequenos:
  https://github.com/pedroslopez/whatsapp-web.js/issues/3857

## Causas confirmadas

### 1. `!data`

El pipeline local ejecutaba primero dos copias privadas del comportamiento de la libreria:
`WAWebCollections`, polling de `mediaStage`, lectura de `_blob` y descarga manual. En 1.34.7
la API publica ya implementa la busqueda, resolucion y desencriptado. Mantener ambas copias
duplicaba puntos de rotura frente a cambios de WhatsApp Web.

Decision:

- `downloadMedia()` es el primer camino.
- Si retorna `undefined`, se usa `reload()` y un reintento acotado.
- Solo un mensaje sintetico antiguo puede usar el fallback de `directPath + mediaKey`.
- `!data` limita el archivo antes y despues de decodificar, exige UTF-8 valido y no registra
  IDs completos en logs.
- La Forja reutiliza el mismo descargador.

### 2. Identidad `@lid`

Un LID es un identificador opaco y no un telefono. `normalizePhone()` eliminaba `@lid` y
consultaba Supabase con esos digitos. Ademas, `formatJid()` suponia que todo numero de 14 o
mas digitos era un LID. Esto explica rechazos de tesoro, menciones y perfiles sin atribucion.

Decision:

- Los LID genericos ya no pasan como telefonos.
- El router resuelve una vez el remitente mediante la API publica y comparte el telefono con
  todos los handlers.
- Hay cache positiva/negativa, timeout y lotes de hasta cinco IDs.
- Si WhatsApp no resuelve la identidad, las rutas de perfil/oro fallan cerradas con un aviso;
  nunca operan contra los digitos del LID.
- Se corrigieron tambien menciones de GM/blackjack, participantes admin, bienvenida y
  lifecycle.

### 3. Tesoro Errante

El flujo anterior hacia tres operaciones separadas: contar cupos, insertar claim y sumar oro.
Un reinicio o error entre pasos podia dejar cupos pendientes; dos replicas podian superar el
maximo y `updateGold` no tenia clave idempotente.

Decision:

- `reserve_treasure_claim` bloquea la fila del evento y reserva un cupo atomicamente.
- `award_bot_gold_once` acredita en la base principal con clave unica `treasure + claim_id`.
- Los claims usan estado `pending/credited` y un job por minuto reconcilia pendientes despues
  de errores o reinicios.
- El camino anterior queda como compatibilidad hasta instalar las RPC, sin cambiar el
  comportamiento productivo antes de la migracion.
- La respuesta inmediata y el resumen muestran `@telefono`, nombre, recompensa y saldo
  confirmado cuando la RPC lo devuelve.

### 4. Game Master

El prompt pedia formato WhatsApp, pero mostraba tablas Markdown, encabezados `#`, dobles
asteriscos, bullets `•`, marcos ornamentales y el bloque interno de estado dentro de triple
backticks. Al retirar `[ESTADO_MISION]` podian quedar cercas vacias visibles.

Decision:

- El prompt usa secciones cortas, listas `- ` y marcadores WhatsApp de una sola pareja.
- El estado interno no se envuelve en un bloque de codigo.
- La salida visible normaliza encabezados, tablas, dobles asteriscos, bullets, separadores y
  marcadores sin cierre, preservando bloques compactos de metricas.
- La narrativa conserva sus reglas tacticas, anticheat, continuidad y canon disponible.
- El envio usa el canal resiliente con particionado y fallback de texto.

## Estado de base de datos

Migraciones aplicadas el 2026-07-22 mediante la API oficial de gestion de Supabase:

1. `supabase/supabase_bot_state_migration.sql` en `tnrocqdfbssscnszahut`, proyecto
   dedicado al estado del bot. SHA-256 aplicado:
   `66DEA4FD3BE24F95D92A0EEA39405E868CA9447BF36A50C7B976980D8D0E280F`.
2. `supabase/supabase_treasure_gold_awards.sql` en `sibisgiwmgdrpfkzmkkw`, proyecto
   principal con `players`. SHA-256 aplicado:
   `729DF21F924B96C30E8CE3FBD0C3917EF80B052D00763CAD1D8A4E2A9500814B`.

Verificacion posterior:

- Se conservaron 47 eventos y 82 reclamos en el estado del bot; los 82 reclamos historicos
  quedaron marcados como acreditados y no existe ningun `credit_status` nulo.
- `reserve_treasure_claim` y `mark_treasure_claim_credited` existen y solo pueden ejecutarse
  con `service_role`; `anon` y `authenticated` fueron revocados explicitamente.
- El proyecto principal conserva 32 jugadores y los mismos totales de `gold` y `weekly_gold`.
  `bot_gold_awards` se creo vacia, con RLS activa y clave unica de idempotencia.
- `award_bot_gold_once` es `SECURITY DEFINER`; solo `service_role` puede ejecutarla y consultar
  el historial. Los roles anonimo y autenticado no tienen acceso directo.
- Las simulaciones de reserva, duplicado, cupo lleno, marcado y doble credito pasaron dentro
  de transacciones finalizadas con `ROLLBACK`.
- PostgREST reconoce ambas RPC: la sonda del bot devolvio evento ausente y la del premio
  devolvio la validacion esperada `P0001`, ya no `PGRST202`.

## Validacion local

- `node --check` sobre todos los archivos JavaScript de `src`.
- Todos los scripts `test_*.js`.
- `npm ci --dry-run --ignore-scripts --omit=dev`.
- `npm run graphify:update`.
- `git diff --check`.

## Riesgos abiertos

- La validacion local no demuestra el comportamiento del Space de Hugging Face; requiere
  despliegue y prueba viva posterior.
- El `.env` local no define `BOT_SUPABASE_URL` ni `BOT_SUPABASE_SERVICE_KEY`; una ejecucion
  local seguira usando el proyecto principal como fallback para estado hasta configurar esas
  variables. El proyecto dedicado fue identificado como el activo mas reciente.
- `src/whatsappHealth.js` conserva `WAWebCollections` como observador estructural independiente
  del bridge publico. No participa en `!data` ni en la resolucion LID, pero sigue siendo una
  dependencia privada de WhatsApp Web: si cambia, el watchdog fallara cerrado y activara la
  recuperacion en vez de considerar sana una conexion sin observador.
- El remoto Hugging Face local contiene una credencial embebida en `.git/config`. No se
  versiono ni se imprimio, pero debe rotarse y moverse a un gestor de credenciales.
