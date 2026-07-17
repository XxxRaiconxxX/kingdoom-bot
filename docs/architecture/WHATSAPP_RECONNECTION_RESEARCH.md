# Investigacion de reconexion WhatsApp en Hugging Face

Fecha: 2026-07-17

## Resultado ejecutivo

El Space no estaba perdiendo todo el disco en cada reinicio: Hugging Face tiene el bucket
`axel785/kingdoom-whatsapp-state` montado con escritura en `/data`. Sin embargo, la prueba real
del 17/07/2026 demostro que eso no vuelve confiable a un perfil Chromium `LocalAuth` vivo:

1. Se vinculo el telefono, el bot alcanzo `HEALTHY`, respondio comandos y `/healthz` devolvio 200.
2. El marcador de `/data` sobrevivio al siguiente rebuild y reporto `verified_across_restart`.
3. El proceso nuevo no restauro la sesion y emitio QR de todos modos.

Por tanto, “el volumen persiste” y “la sesion se restaura” son propiedades distintas. El perfil
mutable de Chromium ya no se ejecuta directamente sobre el bucket. El runtime usa `RemoteAuth`
con cache efimero y snapshots ZIP versionados en `/data`.

La auditoria inicial tambien encontro que:

1. `ready` y varias sondas estructurales podian terminar mostrando `HEALTHY` sin una prueba
   funcional reciente de la conexion actual.
2. El watchdog trataba un QR envejecido y estados transitorios como bloqueos, por lo que
   podia reiniciar Chromium mientras WhatsApp aun estaba recuperandose o esperando escaneo.
3. No habia un registro persistente que distinguiera una reconexion verificada de una que
   termino nuevamente en QR.
4. El reset de autenticacion borraba toda `.wwebjs_auth`, incluida la carpeta `state` del bot,
   en vez de limitarse al perfil Chromium `session`.

Antes del primer escaneo, el telefono mostro que no quedaba ningun dispositivo vinculado. En ese
estado no existia una sesion del servidor que pudiera reconectarse. La vinculacion posterior sirvio
para probar `LocalAuth`; su fallo entre rebuilds obliga a un ultimo escaneo para crear el primer
snapshot remoto.

## Evidencia y fuentes primarias

- La guia oficial de `whatsapp-web.js` exige filesystem persistente para `LocalAuth` y ofrece
  `RemoteAuth` cuando la sesion debe guardarse en un store remoto:
  https://wwebjs.dev/guide/creating-your-bot/authentication.html
- El almacenamiento por defecto de Spaces es efimero; los buckets se montan como almacenamiento
  persistente de lectura y escritura:
  https://huggingface.co/docs/hub/main/spaces-storage
  https://huggingface.co/docs/hub/storage-buckets
- Cada push reconstruye y reinicia el Space, por lo que un proceso vivo no puede ser la fuente
  de persistencia:
  https://huggingface.co/docs/hub/main/spaces-overview
- El hardware gratuito `cpu-basic` se suspende tras 48 horas sin uso. El runtime consultado el
  2026-07-17 reporto `hardware=cpu-basic` y `sleepTime=null`; ningun watchdog interno puede
  ejecutarse durante esa suspension:
  https://huggingface.co/docs/hub/main/spaces-gpus#set-a-custom-sleep-time
- El cliente de `whatsapp-web.js` acepta `CONNECTED`, `OPENING`, `PAIRING` y `TIMEOUT` durante
  cambios de estado; reiniciar inmediatamente en los tres ultimos compite con su recuperacion:
  https://github.com/pedroslopez/whatsapp-web.js/blob/main/src/Client.js
- `RemoteAuth` tarda cerca de un minuto en guardar la primera sesion. En la version instalada
  `1.34.7`, su flujo base de desconexion elimina la sesion remota y la extraccion espera un evento
  que puede terminar antes de completar todos los archivos; ambos puntos requieren wrapper:
  https://github.com/wwebjs/whatsapp-web.js/blob/v1.34.7/src/authStrategies/RemoteAuth.js
- Hay reportes reproducibles donde una sesion autentica pero no vuelve a `ready` despues de
  restaurar un contenedor; archivos presentes no equivalen a canal operativo:
  https://github.com/pedroslopez/whatsapp-web.js/issues/5717

## Alternativas evaluadas

### Mantener LocalAuth sobre el bucket montado

Descartado despues de la prueba controlada. El marcador y los archivos sobrevivieron al rebuild,
pero WhatsApp volvio a QR. Continuar ajustando reintentos alrededor del mismo perfil solo ocultaria
el fallo y produciria nuevas reconexiones visuales sin credenciales restaurables.

### Migrar ahora a RemoteAuth

Opcion seleccionada. El store implementa la interfaz oficial sobre el bucket ya montado, sin una
base nueva ni dependencias nuevas. Chromium trabaja en `/tmp`; el bucket recibe ZIP inmutables con
SHA-256, manifiesto atomico y tres versiones. El wrapper conserva el store en desconexiones
transitorias, lo purga solo ante invalidacion explicita y espera la finalizacion real del extractor.

### Mover el bot a un VPS con volumen local

Reduce reconstrucciones de contenedor y da semantica de filesystem mas predecible, pero no evita
que WhatsApp cierre una vinculacion. Sigue necesitando las mismas pruebas funcionales y auditoria.
Es una alternativa de infraestructura si el bucket muestra corrupcion repetible aun con este cambio.

### Mantener ejecucion 24/7 en Hugging Face

La solucion oficial es cambiar a hardware actualizado y dejar el sleep desactivado. `CPU Upgrade`
figura a USD 0.03 por hora en la documentacion consultada. No se aplico porque crea un costo
recurrente y requiere una decision del propietario. `/healthz` queda disponible para un monitor
externo, pero un ping no sustituye una garantia contractual de disponibilidad.

## Solucion aplicada

- `HEALTHY` exige una prueba de esta conexion: `active_network`, `inbound_traffic` o `server_ack`.
- Las sondas de socket, pagina y listeners solo dejan `CONNECTED_UNVERIFIED`.
- Cada reinicio automatico crea un intento persistente con inicio, causa y resultado.
- Los `SIGTERM` de despliegue o reinicio de Hugging Face tambien crean un intento pendiente para
  comprobar la restauracion en el siguiente proceso.
- Toda restauracion de snapshot crea `remote_auth_restore` si la plataforma reemplazo el proceso
  sin entregar `SIGTERM`; asi el canal nuevo tambien debe completar una prueba funcional.
- `reconnection_verified` solo se emite despues de una prueba funcional real.
- `reconnection_failed_pairing_required` se emite si el intento termina en QR o codigo.
- `/healthz` responde `200` solo con canal funcional y `503` en cualquier estado visual o incompleto.
- `OPENING`, `PAIRING` y `TIMEOUT` esperan 180 segundos antes de escalar.
- Un QR activo no provoca reinicios por antiguedad.
- El marcador de persistencia diferencia ruta configurada de datos comprobados en otro boot.
- Hugging Face elige `RemoteAuth`; local conserva `LocalAuth` salvo configuracion explicita.
- El perfil activo vive en `/tmp` y el store en `/data/kingdoom-bot/remote-auth`.
- Los snapshots se verifican antes de publicar y antes de restaurar; si el ultimo falla SHA-256,
  se usa una version anterior.
- El primer snapshot se marca disponible solo despues del guardado real de `RemoteAuth`.
- Desconexiones transitorias y cierres conservan snapshots; invalidaciones explicitas los purgan.
- Antes de un reinicio controlado se intenta guardar y luego se cierra Chromium.
- Un reset remoto no borra `state` ni otros datos persistidos del bot.

## Criterio de validacion en produccion

Despues del unico escaneo necesario, el cierre exitoso requiere:

1. `authStrategyMode=remote`.
2. `remoteAuthSnapshotAvailable=true` y `reconnectReady=true` despues del primer minuto.
3. `connectionHealth=HEALTHY`.
4. `lastFunctionalProofType` con `active_network`, `inbound_traffic` o `server_ack`.
5. `/healthz` con HTTP 200.
6. Reinicio controlado del Space sin QR y con `remote_auth_snapshot_restored`.
7. `lastReconnectResult.outcome=verified` despues de una prueba funcional del proceso restaurado.

Si aparece QR, la reconexion se registra como fallida y no se presenta como recuperacion exitosa.

La validacion anterior cubre reconexion del cliente dentro de un Space en ejecucion. No convierte
el hardware gratuito en un servicio 24/7: para eso queda pendiente la decision de CPU Upgrade o VPS.
