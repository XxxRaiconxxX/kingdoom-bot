---
title: Kingdoom Bot
emoji: 🏰
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Kingdoom Bot

Bot de WhatsApp automatizado para el Reino de Kingdoom, alojado en Hugging Face Spaces.

## Estructura rapida

- `src/`: runtime del bot, handlers y servicios.
- `supabase/`: migraciones y SQL versionado del bot.
- `docs/architecture/`: diagnosticos y notas de arquitectura operativa.

## Hugging Face operativo

- El estado publico del bot se consulta en `/status.json`.
- El Space actual usa `cpu-basic`: Hugging Face lo suspende tras 48 horas sin visitas. La garantia oficial de ejecucion indefinida requiere hardware actualizado sin sleep o mover el contenedor a un VPS; el watchdog interno no puede ejecutarse mientras el Space esta dormido.
- El panel del QR ahora vigila `/status.json` y se recarga solo cuando WhatsApp emite un QR nuevo, cambia de estado o entra a sincronizacion. Si el navegador queda clavado, la recarga de respaldo ocurre igual cada 25 segundos.
- `ready` deja la sesion en `CONNECTED_UNVERIFIED`: el watchdog exige socket, pagina y puente de eventos, pero ninguna comprobacion estructural puede declarar `HEALTHY` por si sola. Hace falta una consulta activa confirmada, trafico entrante real o un ACK saliente real de la conexion actual.
- `/status.json` separa `whatsappState` de `connectionHealth`, publica la prueba funcional real y conserva el resultado de cada reconexion. `/healthz` devuelve `200` solo cuando el bot esta operativo y `503` ante QR, canal no verificado o degradacion.
- La recuperacion funcional no entra en bucle: primero reengancha los listeners del puente y luego recrea una vez el proceso conservando auth. Solo solicita una vinculacion limpia si WhatsApp confirma que la cuenta o la sesion ya no son validas; una falla generica de red termina en `QUARANTINED` sin borrar credenciales.
- `OPENING`, `PAIRING` y `TIMEOUT` reciben una gracia de tres minutos porque WhatsApp Web los considera transitorios. Mientras exista un QR o codigo de vinculacion, el watchdog espera al usuario y no reinicia el proceso por antiguedad de la imagen.
- La cola privada marca `sent=true` solo despues del ACK del servidor de WhatsApp. Los timeouts y fallos de contexto permanecen pendientes para reintento; los trabajos de datos y cobros siguen funcionando aunque el canal de mensajeria este pausado.
- La sesion de WhatsApp debe persistir en la ruta real donde Hugging Face monte el storage. El runtime escribe un marcador y solo informa `verified_across_restart` despues de leerlo en otro boot; una ruta con aspecto persistente ya no es la unica evidencia.
- Si el QR sigue siendo inestable, el cliente tambien admite vinculacion por numero telefonico con `WHATSAPP_PAIR_PHONE_NUMBER`, `WHATSAPP_PAIR_SHOW_NOTIFICATION` y `WHATSAPP_PAIR_INTERVAL_MS`.
- El reset manual ya no debe quedar abierto al publico. Si hace falta habilitarlo de forma excepcional, usar `RESET_AUTH_ENABLED=true` y `RESET_AUTH_TOKEN=<token>`; luego invocarlo con `?token=...` o header `x-reset-token`.
- `WHATSAPP_TAKEOVER_ON_CONFLICT=true` permite que el contenedor nuevo tome el control cuando un despliegue se solapa brevemente con el anterior.
- Los reinicios por desconexion, watchdog o `SIGTERM` cierran Chromium antes de salir y eliminan solo locks huerfanos del perfil persistente. El perfil `session` se borra unicamente ante `LOGOUT`, fallo de autenticacion confirmado, `UNPAIRED` o reset manual autorizado; el estado operativo hermano se conserva.
- El QR ya no se imprime en logs, los eventos no guardan cuerpos ni identificadores de chats y las claves de IA se registran solo mediante un hash corto no reversible.
