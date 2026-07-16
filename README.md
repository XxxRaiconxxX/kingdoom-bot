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
- `ready` deja la sesion en `CONNECTED_UNVERIFIED`: el watchdog exige socket, pagina y puente de eventos, mantiene presencia como ayuda no destructiva y usa una consulta invisible periodica al servidor para no aceptar un falso `CONNECTED`. Tres comprobaciones correctas dentro de la ventana estable habilitan `HEALTHY`; un mensaje real lo confirma inmediatamente.
- `/status.json` separa `whatsappState` de `connectionHealth` y expone ultimo mensaje entrante, ultimo ACK saliente, ultima prueba funcional, antiguedad de la sesion y presupuesto de recuperacion. El scheduler, los tesoros y los anuncios realtime no envian fuera de `HEALTHY`.
- La recuperacion funcional no entra en bucle: primero reengancha los listeners del puente y luego recrea una vez el proceso conservando auth. Solo solicita una vinculacion limpia si WhatsApp confirma que la cuenta o la sesion ya no son validas; una falla generica de red termina en `QUARANTINED` sin borrar credenciales.
- La cola privada marca `sent=true` solo despues del ACK del servidor de WhatsApp. Los timeouts y fallos de contexto permanecen pendientes para reintento; los trabajos de datos y cobros siguen funcionando aunque el canal de mensajeria este pausado.
- La sesion de WhatsApp debe persistir en la ruta real donde Hugging Face monte el storage. Si el bucket esta montado en `/data`, usar `/data/kingdoom-bot/.wwebjs_auth`; si no, definir la ruta exacta con `PERSISTENT_DATA_PATH`.
- Si el QR sigue siendo inestable, el cliente tambien admite vinculacion por numero telefonico con `WHATSAPP_PAIR_PHONE_NUMBER`, `WHATSAPP_PAIR_SHOW_NOTIFICATION` y `WHATSAPP_PAIR_INTERVAL_MS`.
- El reset manual ya no debe quedar abierto al publico. Si hace falta habilitarlo de forma excepcional, usar `RESET_AUTH_ENABLED=true` y `RESET_AUTH_TOKEN=<token>`; luego invocarlo con `?token=...` o header `x-reset-token`.
- `WHATSAPP_TAKEOVER_ON_CONFLICT=true` permite que el contenedor nuevo tome el control cuando un despliegue se solapa brevemente con el anterior.
- Los reinicios por desconexion, watchdog o `SIGTERM` cierran Chromium antes de salir y eliminan solo locks huerfanos del perfil persistente; la sesion se borra unicamente ante `LOGOUT`, fallo de autenticacion confirmado, cuenta propia no confirmada despues de una recuperacion conservadora o reset manual autorizado.
- El QR ya no se imprime en logs, los eventos no guardan cuerpos ni identificadores de chats y las claves de IA se registran solo mediante un hash corto no reversible.
