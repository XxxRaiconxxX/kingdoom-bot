# AI Collaboration Log & Project Context - Kingdoom Bot

Este archivo sirve como registro de actividad y contexto operativo para el repositorio **kingdoom-bot**.

## Historial de Cambios (Changelog)

### [Fecha: 14/06/2026] - [Autor: Antigravity]
*   **Archivos Modificados:** `src/supabase.js`, `src/handlers/admin.js`
*   **Resumen de Tareas:** Inclusión de perfiles web no vinculados en el reporte `!actividad` para auditoría y purga.
*   **Cambios Clave:**
    *   **[Bot - Registro de Actividad]:** Se actualizó la función `verifyAndLinkPlayer` en `src/supabase.js` para que registre `last_active_at` al momento de vincularse.
    *   **[Bot - Reporte de Actividad]:** Se eliminó el filtro `.not('phone', 'is', null)` en `getActivityReport` para volver a incluir las cuentas creadas en la web que aún no están enlazadas a WhatsApp. Se seleccionó la columna `phone` en la consulta.
    *   **[Bot - Formateo de Actividad]:** Se modificó el bucle de impresión en `src/handlers/admin.js` para que detecte si un usuario no tiene teléfono vinculado (`!p.phone`) y le asigne el estado `Sin WA`. Esto permite a los administradores diferenciar de inmediato las cuentas web inactivas de las vinculadas y realizar la auditoría/limpieza de forma segura.
*   **Notas/Advertencias:** Validación de sintaxis de Node exitosa en ambos archivos modificados.
