import assert from 'node:assert/strict';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const {
  assessGMResponse,
  buildGMPrompt,
  buildVisibleGMResponse,
  formatGMResponseForWhatsApp,
} = await import('./src/gmTracker.js');

const rawResponse = `### Frente Norte
> **El portón cede bajo el impacto.**

| Actor | Consecuencia |
|---|---|
| Ardan | 120 de daño |

─── ❖ ─── ESTADO DEL FLANCO ─── ❖ ───
• Ardan: estable

\`\`\`
Métricas: 120 daño
\`\`\`

[ESTADO_MISION]
resultado: en_curso
motivo: El portón cayó.
siguiente_presion: Entran refuerzos.
[/ESTADO_MISION]`;

const visible = buildVisibleGMResponse(rawResponse);
assert.doesNotMatch(visible, /\[ESTADO_MISION\]/);
assert.doesNotMatch(visible, /^#{1,6}\s/m);
assert.doesNotMatch(visible, /\*\*|•|[─━═]{3,}/u);
assert.doesNotMatch(visible, /^\s*\|/m);
assert.match(visible, /\*Frente Norte\*/);
assert.match(visible, /- \*Actor:\* Consecuencia/);
assert.match(visible, /- \*Ardan:\* 120 de daño/);
assert.match(visible, /```\nMétricas: 120 daño\n```/);

const assessed = assessGMResponse(rawResponse);
assert.equal(assessed.needsRepair, false);
assert.equal(assessed.missionState.resultado, 'en_curso');
assert.equal(assessed.visibleResponse, visible);

const fencedState = buildVisibleGMResponse(`*Escena válida.*
\`\`\`
[ESTADO_MISION]
resultado: en_curso
motivo: La escena continúa.
siguiente_presion: Avanza la guardia.
[/ESTADO_MISION]
\`\`\``);
assert.equal(fencedState, '*Escena válida.*', 'No deben quedar cercas vacías del bloque interno.');

const unwrapped = formatGMResponseForWhatsApp(`\`\`\`md
### Escena
> Niebla cerrada.

El puente tiembla.
\`\`\``);
assert.equal(unwrapped, '*Escena*\n> Niebla cerrada.\n\nEl puente tiembla.');

const malformed = formatGMResponseForWhatsApp('### Alerta\n**Golpe decisivo**\n_Tensión sin cierre');
assert.equal(malformed, '*Alerta*\n*Golpe decisivo*\nTensión sin cierre');

const prompt = buildGMPrompt();
assert.match(prompt, /La salida visible se envía directamente a WhatsApp/);
assert.match(prompt, /No uses encabezados con #, dobles asteriscos, tablas Markdown/);
assert.match(prompt, /no lo envuelvas con acentos graves/);
assert.doesNotMatch(
  prompt.slice(prompt.indexOf('### OPCIÓN B'), prompt.indexOf('## 7. TONO')),
  /\\`\\`\\`|•/u,
  'El reporte WhatsApp del prompt no debe ir dentro de un bloque de código ni usar viñetas incompatibles.'
);

console.log('GM_FORMATTING_OK');
