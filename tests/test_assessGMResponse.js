import { assessGMResponse } from '../src/gmTracker.js';

console.log('--- STARTING GM TRACKER TESTS (parseMissionStateBlock via assessGMResponse) ---');

let passed = 0;
let failed = 0;

function runTest(description, input, expectedState) {
  const result = assessGMResponse(input);
  const actualState = result.missionState;

  // Simple deep equals
  const isMatch = JSON.stringify(actualState) === JSON.stringify(expectedState);

  if (isMatch) {
    console.log(`✅ [OK] ${description}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${description}`);
    console.error(`   Expected: ${JSON.stringify(expectedState)}`);
    console.error(`   Actual:   ${JSON.stringify(actualState)}`);
    failed++;
  }
}

// 1. Happy path
runTest('Happy path with all valid fields',
`Aquí está la narrativa del GM.
[ESTADO_MISION]
resultado: victoria_jugadores
motivo: Los jugadores derrotaron al jefe.
siguiente_presion: El templo comienza a colapsar.
[/ESTADO_MISION]
`,
{
  resultado: 'victoria_jugadores',
  motivo: 'Los jugadores derrotaron al jefe.',
  siguientePresion: 'El templo comienza a colapsar.'
});

// 2. Missing end tag (truncation scenario)
runTest('Handles missing closing tag (truncation)',
`[ESTADO_MISION]
resultado: en_curso
motivo: Aún están peleando.
siguiente presion: Refuerzos en camino.`,
{
  resultado: 'en_curso',
  motivo: 'Aún están peleando.',
  siguientePresion: 'Refuerzos en camino.'
});

// 3. Missing block completely
runTest('Returns null if no state block is present',
`Esto es solo texto, sin bloques.`,
null);

// 4. Default behavior for 'resultado'
runTest('Ignores invalid "resultado" values and uses "en_curso"',
`[ESTADO_MISION]
resultado: valor_invalido
motivo: Razones
[/ESTADO_MISION]`,
{
  resultado: 'en_curso',
  motivo: 'Razones',
  siguientePresion: ''
});

// 5. Resilient parsing (capitalization, spaces, alternate keys)
runTest('Resilient parsing of capitalization, spaces, and "siguiente presion"',
`[ESTADO_MISION]
  ReSuLtAdO  : victoria_gm
 MOTIVO:  Todo salió mal para ellos.
 siguiente presion  : Muerte inminente
[/ESTADO_MISION]`,
{
  resultado: 'victoria_gm',
  motivo: 'Todo salió mal para ellos.',
  siguientePresion: 'Muerte inminente'
});

// 6. Ignore unknown keys
runTest('Ignores unknown fields inside the block',
`[ESTADO_MISION]
resultado: en_curso
motivo: Normal
inventado: Esto no existe
siguiente_presion: Nada
[/ESTADO_MISION]`,
{
  resultado: 'en_curso',
  motivo: 'Normal',
  siguientePresion: 'Nada'
});

console.log(`\n--- RESULTS: ${passed} passed, ${failed} failed ---`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
