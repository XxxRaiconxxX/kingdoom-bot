# Investigacion de reconexion WhatsApp en Hugging Face

Fecha: 2026-07-17

## Resultado ejecutivo

El Space no estaba perdiendo todo el disco en cada reinicio: Hugging Face tiene el bucket
`axel785/kingdoom-whatsapp-state` montado con escritura en `/data`, y `LocalAuth` guarda el
perfil bajo `/data/kingdoom-bot/.wwebjs_auth`. El problema principal era distinto:

1. `ready` y varias sondas estructurales podian terminar mostrando `HEALTHY` sin una prueba
   funcional reciente de la conexion actual.
2. El watchdog trataba un QR envejecido y estados transitorios como bloqueos, por lo que
   podia reiniciar Chromium mientras WhatsApp aun estaba recuperandose o esperando escaneo.
3. No habia un registro persistente que distinguiera una reconexion verificada de una que
   termino nuevamente en QR.
4. El reset de autenticacion borraba toda `.wwebjs_auth`, incluida la carpeta `state` del bot,
   en vez de limitarse al perfil Chromium `session`.

El telefono mostro que no quedaba ningun dispositivo vinculado. En ese estado no existe una
sesion del servidor que pueda reconectarse: el QR actual es una revinculacion obligatoria.

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
- `RemoteAuth` espera antes del primer respaldo y su flujo de desconexion elimina la sesion del
  store. Adoptarlo sin un wrapper y backups versionados agregaria una nueva ventana de perdida:
  https://github.com/pedroslopez/whatsapp-web.js/blob/main/src/authStrategies/RemoteAuth.js
- Hay reportes reproducibles donde una sesion autentica pero no vuelve a `ready` despues de
  restaurar un contenedor; archivos presentes no equivalen a canal operativo:
  https://github.com/pedroslopez/whatsapp-web.js/issues/5717

## Alternativas evaluadas

### Mantener LocalAuth sobre el bucket montado

Es la opcion de menor riesgo inmediato porque conserva el perfil ya usado, no introduce una
migracion y satisface el requisito de persistencia de `LocalAuth`. Se agrega evidencia entre
boots y salud funcional estricta para dejar de confundir archivos presentes con sesion activa.

### Migrar ahora a RemoteAuth

No se eligio para este incidente. Requiere una nueva vinculacion, un store implementado y probado,
backups versionados, control de corrupcion y una proteccion contra el borrado remoto en desconexiones
transitorias. El beneficio no compensa ese riesgo mientras `/data` ya esta montado de forma
persistente.

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
- `reconnection_verified` solo se emite despues de una prueba funcional real.
- `reconnection_failed_pairing_required` se emite si el intento termina en QR o codigo.
- `/healthz` responde `200` solo con canal funcional y `503` en cualquier estado visual o incompleto.
- `OPENING`, `PAIRING` y `TIMEOUT` esperan 180 segundos antes de escalar.
- Un QR activo no provoca reinicios por antiguedad.
- El marcador de persistencia diferencia ruta configurada de datos comprobados en otro boot.
- Un reset elimina solo `session`; no borra `state` ni otros datos persistidos del bot.

## Criterio de validacion en produccion

Despues del unico escaneo necesario, el cierre exitoso requiere:

1. `connectionHealth=HEALTHY`.
2. `lastFunctionalProofType` con `active_network`, `inbound_traffic` o `server_ack`.
3. `/healthz` con HTTP 200.
4. Ante una desconexion posterior, `lastReconnectResult.outcome=verified` sin QR.

Si aparece QR, la reconexion se registra como fallida y no se presenta como recuperacion exitosa.

La validacion anterior cubre reconexion del cliente dentro de un Space en ejecucion. No convierte
el hardware gratuito en un servicio 24/7: para eso queda pendiente la decision de CPU Upgrade o VPS.
