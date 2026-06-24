import { formatAsuncionDateKey } from './src/supabase.js';

console.log('--- INICIANDO PRUEBAS DE SUPABASE ---');

function runTest(date, expectedString, description) {
  try {
    const actualString = formatAsuncionDateKey(date);
    if (actualString === expectedString) {
      console.log(`✅ [OK] ${description}: ${actualString}`);
    } else {
      console.error(`❌ [FAIL] ${description}: Esperaba ${expectedString}, obtuve ${actualString}`);
      process.exit(1);
    }
  } catch (error) {
    if (expectedString === 'ERROR') {
      console.log(`✅ [OK] ${description}: Capturó error correctamente (${error.message})`);
    } else {
      console.error(`❌ [FAIL] ${description}: Falló con error inesperado: ${error.message}`);
      process.exit(1);
    }
  }
}

// Test case 1: Specific date in Asuncion timezone (summer time)
runTest(new Date('2023-01-01T02:00:00Z'), '2022-12-31', 'Fecha de año nuevo (UTC) es día anterior en Asunción (-3 en verano)');

// Test case 2: Specific date in Asuncion timezone (winter time)
runTest(new Date('2023-07-01T03:00:00Z'), '2023-06-30', 'Fecha de julio (UTC) es día anterior en Asunción (-4 en invierno)');

// Test case 3: Specific date exact Asuncion timezone
runTest(new Date('2023-05-15T12:00:00-04:00'), '2023-05-15', 'Fecha exacta en zona horaria de Asunción');

// Test case 4: Invalid date
runTest(new Date('invalid'), 'ERROR', 'Fecha inválida');

console.log('--- TODAS LAS PRUEBAS DE SUPABASE PASARON EXITOSAMENTE ---');
process.exit(0);
