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
- El panel del QR ahora vigila `/status.json` y se recarga solo cuando WhatsApp emite un QR nuevo, cambia de estado o entra a sincronizacion. Si el navegador queda clavado, la recarga de respaldo ocurre igual cada 25 segundos.
- Despues de `ready`, el watchdog consulta `client.getState()` cada 30 segundos. `/status.json` expone `whatsappState`, la fecha de la ultima lectura y el contador de fallos; tres fallos consecutivos reinician el worker y los estados `UNPAIRED` generan una autenticacion limpia para recuperar el QR.
- La sesion de WhatsApp debe persistir en la ruta real donde Hugging Face monte el storage. Si el bucket esta montado en `/data`, usar `/data/kingdoom-bot/.wwebjs_auth`; si no, definir la ruta exacta con `PERSISTENT_DATA_PATH`.
- Si el QR sigue siendo inestable, el cliente tambien admite vinculacion por numero telefonico con `WHATSAPP_PAIR_PHONE_NUMBER`, `WHATSAPP_PAIR_SHOW_NOTIFICATION` y `WHATSAPP_PAIR_INTERVAL_MS`.
- El reset manual ya no debe quedar abierto al publico. Si hace falta habilitarlo de forma excepcional, usar `RESET_AUTH_ENABLED=true` y `RESET_AUTH_TOKEN=<token>`; luego invocarlo con `?token=...` o header `x-reset-token`.
- `WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE` queda en `false` por defecto para no borrar sesiones validas por fallos de red o arranque transitorio.
- `WHATSAPP_TAKEOVER_ON_CONFLICT=true` permite que el contenedor nuevo tome el control cuando un despliegue se solapa brevemente con el anterior.
- Los reinicios por desconexion, watchdog o `SIGTERM` cierran Chromium antes de salir y eliminan solo locks huerfanos del perfil persistente; la sesion se borra unicamente ante `LOGOUT`, fallo de autenticacion confirmado o reset manual autorizado.
