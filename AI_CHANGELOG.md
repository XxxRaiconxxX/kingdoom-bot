# AI Collaboration Log & Project Context - Kingdoom Bot

Este archivo sirve como registro de actividad y contexto operativo para el repositorio **kingdoom-bot**.

## Historial de Cambios (Changelog)

### [Fecha: 14/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`
*   **Resumen de Tareas:** Corrección en el comando `!actividad` y optimización del flujo de vinculación de usuarios.
*   **Cambios Clave:**
    *   **[Bot - Registro de Actividad]:** Se actualizó la función `verifyAndLinkPlayer` para que, tras una vinculación exitosa con `!verificar`, se actualice de inmediato la columna `last_active_at` en Supabase con el tiempo actual, evitando que los usuarios recién verificados queden marcados como inactivos o desaparezcan del inicio del reporte.
    *   **[Bot - Reporte de Actividad]:** Se modificó la función `getActivityReport` para filtrar y omitir los perfiles con `phone = null` (aventureros web que no han vinculado su número de WhatsApp), limpiando el reporte de ruido. Adicionalmente, se cambió el orden de visualización de `last_active_at` a descendente (`ascending: false, nullsLast: true`) para posicionar a los usuarios activos y nuevos al principio de la lista.
*   **Notas/Advertencias:** Validación de sintaxis de Node exitosa. Advertencias: Ningún riesgo inmediato detectado fuera de los habituales de Puppeteer/WhatsApp Web en la infraestructura de Hugging Face.
