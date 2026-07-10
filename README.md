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
- La sesion de WhatsApp debe persistir en la ruta real donde Hugging Face monte el storage. Si el bucket esta montado en `/data`, usar `/data/kingdoom-bot/.wwebjs_auth`; si no, definir la ruta exacta con `PERSISTENT_DATA_PATH`.
- El reset manual ya no debe quedar abierto al publico. Si hace falta habilitarlo de forma excepcional, usar `RESET_AUTH_ENABLED=true` y `RESET_AUTH_TOKEN=<token>`; luego invocarlo con `?token=...` o header `x-reset-token`.
- `WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE` queda en `false` por defecto para no borrar sesiones validas por fallos de red o arranque transitorio.
