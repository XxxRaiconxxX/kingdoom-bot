import { heraldList } from './src/formatting.js';

console.log('--- INICIANDO PRUEBAS DE FORMATTING ---');

function runTest(actual, expected, description) {
  if (actual === expected) {
    console.log(`✅ [OK] ${description}`);
  } else {
    console.error(`❌ [FAIL] ${description}\nEsperaba:\n${JSON.stringify(expected)}\nObtuve:\n${JSON.stringify(actual)}`);
    process.exit(1);
  }
}

// Test case 1: Default arguments (no arguments)
runTest(
  heraldList(),
  '',
  'Sin argumentos: Retorna string vacío'
);

// Test case 2: Empty array
runTest(
  heraldList([]),
  '',
  'Array vacío: Retorna string vacío'
);

// Test case 3: Happy path with default prefix
runTest(
  heraldList(['Espada', 'Escudo', 'Poción']),
  '• Espada\n• Escudo\n• Poción',
  'Happy path con prefijo por defecto'
);

// Test case 4: Happy path with custom prefix
runTest(
  heraldList(['Manzana', 'Pera'], '-'),
  '- Manzana\n- Pera',
  'Happy path con prefijo personalizado'
);

// Test case 5: Filtering falsy values
runTest(
  heraldList(['Oro', null, '', undefined, 'Plata', 0, false]),
  '• Oro\n• Plata',
  'Filtro de valores falsy (null, undefined, "", 0, false)'
);

console.log('--- TODAS LAS PRUEBAS DE FORMATTING PASARON EXITOSAMENTE ---');
process.exit(0);
