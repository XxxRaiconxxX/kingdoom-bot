# Segunda auditoria integral de Kingdoom Bot

Fecha: 2026-07-22
Autor: Codex

## Dictamen

La segunda auditoria encontro y corrigio fallos que no estaban cubiertos por la suite
anterior: RPC privilegiadas alcanzables con `anon`, reglas de subasta distintas al contrato,
inflacion en empates de blackjack PvP, falta de idempotencia en el cofre, reintentos ambiguos
de notificaciones, comandos admin inalcanzables, montos aceptados fuera del tipo PostgreSQL y
exitos falsos al persistir misiones o resetear el ranking semanal.

El cierre no afirma que todos los tests sean equivalentes. Se separan cuatro niveles:

- **Integracion real:** usa los dos Supabase productivos, filas sinteticas aisladas y APIs reales.
- **Conductual:** ejecuta funciones y handlers con entradas controladas y comprueba resultados.
- **Estructural:** inspecciona que exista una guarda o un caller; no prueba el comportamiento.
- **Transporte humano pendiente:** requiere que una cuenta real envie el mensaje a WhatsApp.

## Inventario auditado

- 59 literales de comandos y alias presentes en `src/`.
- 29 comandos administrativos, 9 comandos privilegiados y 4 comandos exclusivos del owner
  verificados contra una unica matriz de autorizacion.
- 15 RPC consumidas por el bot, distribuidas entre el Supabase principal y el dedicado.
- Juegos con oro: dados, trampa, cofre, blackjack solo/PvP, tesoro y subastas.
- Estado persistente: perfiles, apuestas escrow, limites diarios, misiones GM, notificaciones,
  tesoros, premios idempotentes, inventario y ordenes de subasta.
- Entrega WhatsApp: resultado de `sendMessage`, `message_create`, ACK inmediato/tardio,
  rechazo, timeout, reinicio y destinatario invalido.

## Evidencia web primaria

- La documentacion de `whatsapp-web.js 1.34.7` distingue `message` (recibidos) de
  `message_create`, que puede incluir mensajes propios. Esto permite recuperar el ID saliente
  sin reenviar: https://docs.wwebjs.dev/Client.html
- La guia oficial indica `hasMedia` + `downloadMedia()` y advierte que la descarga puede
  devolver `undefined`: https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html
- Supabase documenta que las funciones son ejecutables por cualquier rol de forma
  predeterminada y que se debe revocar tanto `public` como el rol concreto:
  https://supabase.com/docs/guides/database/functions
- PostgreSQL documenta el alcance de `SECURITY DEFINER` y la necesidad de fijar un
  `search_path` seguro: https://www.postgresql.org/docs/current/sql-createfunction.html

## Hallazgos corregidos

### P0 - RPC de economia expuestas

La sonda inicial con la clave `anon` alcanzaba logica interna en `increment_gold`,
`place_bet`, `resolve_bet`, `resolve_market_auction`, premios de mision, reciclaje de ficha y
cuotas. La migracion `supabase_primary_rpc_hardening.sql` ahora:

- exige `service_role` para apuestas del bot, premios manuales, fichas y cuotas;
- limita transferencias y subastas a `authenticated`/`service_role`;
- valida que una puja pertenezca a un jugador vinculado a la sesion;
- elimina el overload heredado de cuatro argumentos que hacia ambigua `increment_gold`;
- rechaza montos fraccionarios, negativos o fuera del contrato antes de tocar oro.

La prueba real confirma denegacion para `anon` y para un usuario autenticado temporal sin
vinculo. Ese usuario se elimina al terminar la corrida.

### P0 - Estado interno no reproducible como privado

Produccion ya ocultaba por RLS las tablas antiguas, pero el SQL versionado no declaraba esa
proteccion. `supabase_bot_state_rls_hardening.sql` activa RLS, revoca `public`, `anon` y
`authenticated`, y conserva CRUD solo para `service_role` en siete tablas.

Antes/despues se conservaron exactamente:

- 222 filas de limites diarios;
- 3 misiones activas;
- 47 eventos y 82 reclamos de tesoro;
- 749 notificaciones y 838 logs de comandos;
- 0 premios de juego pendientes.

Tras la migracion, las siete lecturas anonimas devuelven HTTP 401/403.

### P1 - Subasta con contrato incorrecto

El bot y la web publicaban comision unica del 25% y lock-and-release, pero la RPC descontaba
cada puja de forma permanente. `supabase_auction_lock_release.sql` agrega el estado minimo de
bloqueo y reemplaza puja/resolucion:

- primera entrada: comision unica + bloqueo de la puja total;
- postor superado: reembolso inmediato del bloqueo, nunca de la comision;
- reingreso: no vuelve a cobrar comision;
- ganador: el lock se consume una sola vez y no se cobra al resolver;
- no ganadores: cualquier lock residual se libera al cerrar.

La prueba real uso dos jugadores y comprobo los saldos exactos `987500`, `997500`, `985500`,
la entrega de un solo item y la ausencia de un segundo cobro.

### P1 - Cofre no atomico entre bases

Antes se consumia el uso en el Supabase dedicado y despues se acreditaba oro sin una clave
propia de la jugada. `supabase_bot_game_rewards.sql` reserva uso, resultado y premio bajo el
ID real del mensaje; `award_bot_gold_once` acredita de forma idempotente y el scheduler
reconcilia pendientes. Reprocesar el mismo mensaje no duplica oro ni uso.

### P1 - Inflacion en blackjack PvP

El reparto anterior dividia el pozo y despues garantizaba a cada ganador 2x/2.5x, por lo que
un empate podia crear oro. El nuevo settlement reparte exactamente el pozo, asigna el resto
de forma determinista y deja el pozo en la casa si todos exceden 21. Se probaron todas las
combinaciones de 2 a 20 jugadores y cada cantidad posible de ganadores.

### P1 - Duplicados tras ACK ambiguo

Un timeout de ACK podia provocar el reenvio de una notificacion ya visible. Ahora se persiste
el ID saliente, inicio, intentos y error antes de esperar el ACK; al reiniciar se consulta el
mensaje y se marca enviado, se mantiene en espera o se reintenta solo tras una ventana segura.
La migracion es aditiva y conserva las 749 filas existentes.

### P2 - Routing, montos y persistencia

- `!eliminar` y `!kick` comparten el mismo registro que router y handler; ya no quedan
  inalcanzables.
- Owner, admin y staff usan una sola politica; el menu de staff no promete comandos admin.
- Los montos aceptan enteros simples o miles paraguayos (`100.000`) y rechazan negativos,
  decimales, basura, ceros no permitidos y valores mayores a `2147483647`.
- `!misionstart` revierte memoria si Supabase no persiste; cancelar no anuncia exito antes de
  eliminar la fila.
- La busqueda corta de mision deja de aplicar `ilike` a UUID y exige una coincidencia unica.
- El reset semanal comprueba el error de Supabase antes de registrar exito.

## Pruebas ejecutadas

### Suite local

- 37 archivos de `src/` y `scripts/` pasan `node --check`.
- 21 scripts pasan con `npm test`.
- Las pruebas conductuales cubren parser de oro, matriz admin, reparto blackjack, identidad
  LID, media nativa/fallback, recuperacion `message_create`, ACK, formato GM y tesoro.
- Algunas pruebas heredadas siguen siendo estructurales; no se contabilizan como integracion.

### Integracion real aislada

`test_real_integration.js` crea 11 perfiles con prefijo `__codex_audit_`, ejecuta y limpia:

- conexion separada a ambos Supabase;
- transferencia con conservacion del oro y apuesta escrow con doble resolucion rechazada;
- concurrencia de limites diarios;
- handlers reales de dados, trampa, cofre y blackjack;
- repeticion del mismo mensaje de cofre sin doble premio ni doble uso;
- `!misionstart`, persistencia, formato WhatsApp y cancelacion;
- dos reclamos simultaneos para un tesoro de un cupo;
- tracking de notificaciones y columnas migradas;
- ciclo completo de subasta lock-and-release;
- denegacion de RPC/tablas para `anon` y usuario autenticado no vinculado.

Resultado: `REAL_INTEGRATION_OK` y cero residuos para perfiles, subastas, tesoros y premios.
La mision se verifica en cero por su `instance_id` exacto dentro del propio test.

### Proveedor de Game Master

La llamada real con la configuracion productiva uso NVIDIA
`meta/llama-3.1-70b-instruct`, completo en aproximadamente 91 segundos, genero un bloque
`[ESTADO_MISION]` valido y no filtro encabezados Markdown, tablas, `**` ni estado interno.
La clave Gemini local devolvio `API_KEY_INVALID`; el fallback productivo funciono.

### WhatsApp real

Los logs vivos previos al release mostraron ocho recuperaciones exitosas de ID mediante
`message_create`, cinco `No LID for user` y cinco timeouts de ACK, sin `uncaughtException` ni
`unhandledRejection`. Esto valida el problema productivo y el camino de recuperacion, pero no
equivale a un mensaje entrante humano posterior a este cambio.

## Migraciones aplicadas

Proyecto principal `sibisgiwmgdrpfkzmkkw`:

- `supabase_primary_rpc_hardening.sql`
- `supabase_auction_lock_release.sql`

Proyecto dedicado `tnrocqdfbssscnszahut`:

- `supabase_notification_delivery_tracking.sql`
- `supabase_bot_game_rewards.sql`
- `supabase_bot_state_rls_hardening.sql`

Todas se verificaron mediante consultas posteriores y pruebas funcionales; no se borraron
filas reales.

## Riesgos abiertos

### Critico compartido con Kingdoom Sync

`increment_gold` ya no es anonimo y no permite operar sobre un jugador no vinculado, pero un
usuario web autenticado y vinculado aun puede invocarlo sobre su propio perfil. Nueve
minijuegos web calculan premios en el navegador y dependen de ese permiso. Revocarlo desde el
bot romperia produccion; el cierre definitivo requiere migrar esos settlements a RPC
server-side verificables en `Kingdoom-sync`.

### Dependencias

`npm audit --omit=dev` reporta 4 vulnerabilidades: 2 altas y 2 moderadas. Las altas son
transitivas en `brace-expansion 2.1.1` y `js-yaml 4.2.0`; sus versiones corregidas son 2.1.2 y
4.3.0 respectivamente:

- https://github.com/advisories/GHSA-3jxr-9vmj-r5cp
- https://github.com/advisories/GHSA-52cp-r559-cp3m

La correccion completa exige actualizar el lockfile y `node-cron` 3 a 4. El guardrail del
repo prohibe modificar `package-lock.json` sin autorizacion explicita, y Docker usa `npm ci`;
por eso no se hizo una actualizacion parcial que dejaria build y manifiesto desincronizados.

### Limites de la validacion

- No se envio desde una cuenta humana un `!data`, `reclamar` o `!misionstart` al grupo real.
- El test de media ejecuta el contrato publico con objetos controlados; no falsifica que haya
  atravesado la red de WhatsApp.
- Existe una ventana no atomizable entre el envio de WhatsApp y la escritura de su ID: una
  caida exacta en ese punto todavia puede dejar una entrega ambigua. La persistencia inmediata
  y la espera de 30 minutos reducen el riesgo, pero no pueden crear una transaccion distribuida
  con WhatsApp Web.

## Verificacion postdespliegue

- Hugging Face ejecuto exactamente `d3122660d8a754c080543cebd02b671ca4db012d` en estado
  `RUNNING`.
- `/healthz` confirmo `ok=true`, `connectionHealth=HEALTHY`, una prueba de red activa y una
  restauracion RemoteAuth verificada.
- Los logs de ejecucion obtenidos con el cliente oficial no contienen `uncaughtException`,
  `unhandledRejection` ni errores fatales. Registran dos `No LID` y dos timeouts de ACK.
- La cola dedicada confirma que los `No LID` quedaron cerrados con error y que el ACK ambiguo
  permanece `sent=false`, con ID, contador de intentos y `WHATSAPP_ACK_TIMEOUT` persistidos.
- La repeticion real encontro una carrera en el borrado del store: Windows devolvio `ENOTEMPTY`
  dentro de `VersionedFileRemoteAuthStore.delete()` despues de pasar la integracion. El store
  y el teardown del test ahora usan `maxRetries`/`retryDelay` nativos; no se cambio ninguna
  asercion ni la persistencia normal de autenticacion.
- El cierre corregido paso 50 ciclos RemoteAuth consecutivos, 21 pruebas locales y 22 pruebas
  con integracion real. La comprobacion independiente termino con cero perfiles, subastas,
  tesoros, reclamos y premios sinteticos.

### Carrera de workers en la cola

La observacion posterior mostro que la notificacion ambigua seguia `sent=false` y trazada,
pero su contador llego a nueve intentos durante las transiciones desde workers anteriores. El
codigo protegia ejecuciones solapadas dentro de un proceso, no entre dos procesos que hubieran
leido la misma fila antes de que alguno persistiera el ID saliente.

El cierre reutiliza las columnas existentes como lease optimista:

- antes de enviar, el worker actualiza la fila solo si continua pendiente, sin ID y con el
  mismo timestamp que leyo;
- un lease reciente se respeta y uno huerfano puede reclamarse despues de cinco minutos;
- para reintentar un mensaje trazado, el reset solo gana si el ID viejo sigue siendo el actual;
- si otro worker gana cualquiera de las dos carreras, el perdedor abandona esa ejecucion sin
  tocar WhatsApp.

La prueba contra el Supabase dedicado creo una fila sintetica, lanzo dos resets y dos claims
concurrentes y obtuvo exactamente un ganador en cada etapa. La fila se elimino al terminar.
No fue necesaria otra migracion. El cierre completo paso 21 pruebas locales y 22 con
integracion real; la comprobacion independiente dejo en cero siete tipos de artefactos.

### Destinatario eliminado

La misma fila era un aviso masivo del 20 de julio y su telefono ya no tenia coincidencias en
`players`. El scheduler ahora valida esa relacion antes del claim. Una fila sin jugador se
cierra con `sent=true` y `delivery_error=RECIPIENT_NOT_LINKED`, evitando reintentos perpetuos.

La consulta usa una variante estricta de `getPlayersByPhone`: conserva el filtro exacto y la
cache positiva existente, pero revalida resultados vacios y propaga errores de Supabase. Una
caida de base deja la notificacion pendiente en vez de cerrarla falsamente. La prueba local
fuerza HTTP 503 y una cache vacia obsoleta; la integracion real crea/cierra una fila huerfana.
Ademas, la lectura de produccion encontro dos formatos telefonicos historicos y ambos resolvieron
el perfil exacto (`2/2`). Todas las filas sinteticas se eliminaron.
