# Kingdoom Bot

Bot de WhatsApp automatizado para el Reino de Kingdoom. El runtime vivo actual corre en Ubuntu con Docker Compose desde `/home/crisma01/kingdoom-bot`; Hugging Face Spaces ya no es el entorno operativo principal.

## Estructura rapida

- `src/`: runtime del bot, handlers y servicios.
- `supabase/`: migraciones y SQL versionado del bot.
- `docs/architecture/`: diagnosticos y notas de arquitectura operativa.

## Ubuntu operativo

- Directorio vivo: `/home/crisma01/kingdoom-bot`.
- Servicio Docker: `kingdoom-whatsapp-bot`.
- Puerto local: `7860`.
- Estado: `curl -sS --max-time 10 http://localhost:7860/status`.
- Healthcheck HTTP estricto: `curl -i --max-time 10 http://localhost:7860/healthz`.
- Contenedor: `docker compose ps` y `docker stats kingdoom-whatsapp-bot --no-stream`.
- Logs acotados: `docker logs --tail 200 kingdoom-whatsapp-bot`.

La sesion de WhatsApp vive fuera de la imagen, montada como `./wwebjs_auth:/app/.wwebjs_auth`. No borrar, mover, versionar ni reconstruir sobre esa carpeta mientras Chromium este activo. Antes de cualquier `pull`, rebuild, restart o limpieza de locks, verificar `/status`, `git status --short --branch` y uso de recursos.

## Perfil de laptop

El compose vivo esta ajustado para una laptop de 2 cores y 4 GB RAM con WSL2 limitado a 2.5 GB. El contenedor reserva 512 MB, puede subir hasta 1280 MB en picos, queda limitado a 1.8 CPU y a 256 procesos, y expone `/dev/shm` de 256 MB como margen para Chromium. Se conserva `--disable-dev-shm-usage` porque fue la ruta de arranque estable en esta laptop. Si se mueve a un equipo con mas RAM, revisar estos valores antes de asumirlos como limites definitivos.

## Salud de WhatsApp

- El panel del QR vigila `/status.json` y se recarga solo cuando WhatsApp emite un QR nuevo, cambia de estado o entra a sincronizacion. Si el navegador queda clavado, la recarga de respaldo ocurre igual cada 25 segundos.
- `ready` deja la sesion en `CONNECTED_UNVERIFIED`: el watchdog exige socket, pagina y puente de eventos, pero ninguna comprobacion estructural puede declarar `HEALTHY` por si sola. Hace falta una consulta activa confirmada, trafico entrante real o un ACK saliente real de la conexion actual.
- `/status.json` separa `whatsappState` de `connectionHealth`, publica la prueba funcional real y conserva el resultado de cada reconexion. `/healthz` devuelve `200` solo cuando el bot esta operativo y `503` ante QR, canal no verificado o degradacion.
- La recuperacion funcional no entra en bucle: primero reengancha los listeners del puente y luego recrea una vez el proceso conservando auth. Solo solicita una vinculacion limpia si WhatsApp confirma que la cuenta o la sesion ya no son validas; una falla generica de red termina en `QUARANTINED` sin borrar credenciales.
- `OPENING`, `PAIRING` y `TIMEOUT` reciben una gracia de tres minutos porque WhatsApp Web los considera transitorios. Mientras exista un QR o codigo de vinculacion, el watchdog espera al usuario y no reinicia el proceso por antiguedad de la imagen.
- La cola privada marca `sent=true` solo despues del ACK del servidor de WhatsApp. Los timeouts y fallos de contexto permanecen pendientes para reintento; los trabajos de datos y cobros siguen funcionando aunque el canal de mensajeria este pausado.
- En Ubuntu/Docker Compose, la estrategia recomendada es `WHATSAPP_AUTH_STRATEGY=local` con `PERSISTENT_DATA_PATH=/app/.wwebjs_auth`, respaldado por el volumen `./wwebjs_auth`.
- Si el QR sigue siendo inestable, el cliente tambien admite vinculacion por numero telefonico con `WHATSAPP_PAIR_PHONE_NUMBER`, `WHATSAPP_PAIR_SHOW_NOTIFICATION` y `WHATSAPP_PAIR_INTERVAL_MS`.
- El reset manual ya no debe quedar abierto al publico. Si hace falta habilitarlo de forma excepcional, usar `RESET_AUTH_ENABLED=true` y `RESET_AUTH_TOKEN=<token>`; luego invocarlo con `?token=...` o header `x-reset-token`.
- `WHATSAPP_TAKEOVER_ON_CONFLICT=true` permite que el contenedor nuevo tome el control cuando un despliegue se solapa brevemente con el anterior.
- Los reinicios por desconexion, watchdog o `SIGTERM` fuerzan un snapshot cuando el cliente esta listo, cierran Chromium y eliminan solo locks huerfanos del cache. La carpeta persistente `state` del bot no se mezcla con el perfil de Chromium ni se borra al invalidar autenticacion.
- El QR ya no se imprime en logs, los eventos no guardan cuerpos ni identificadores de chats y las claves de IA se registran solo mediante un hash corto no reversible.

## Hugging Face historico

La configuracion y los documentos de arquitectura conservan notas de la etapa Hugging Face/RemoteAuth para auditoria. Ese camino era necesario por el filesystem efimero de Spaces, pero ya no debe usarse como referencia operativa diaria ahora que el bot vive en Ubuntu.
