import 'dotenv/config';
import { normalizePhone } from './src/adminStore.js';

console.log('--- INICIANDO PRUEBAS DE ADMIN STORE (normalizePhone) ---');

function runTest(input, expectedOutput, description) {
  const actualOutput = normalizePhone(input);
  if (actualOutput === expectedOutput) {
    console.log(`✅ [OK] ${description}: ${actualOutput}`);
  } else {
    console.error(`❌ [FAIL] ${description}: Esperaba '${expectedOutput}', obtuve '${actualOutput}' (Input: '${input}')`);
    process.exit(1);
  }
}

// 1. Basic cleanup
runTest('123456@c.us', '123456', 'Limpieza básica: Remueve @c.us');
runTest('123456@g.us', '123456', 'Limpieza básica: Remueve @g.us');
runTest('  +1 (234) 567-890  ', '1234567890', 'Limpieza básica: Remueve espacios y caracteres no numéricos');
runTest(null, '', 'Casos nulos: Maneja null');
runTest(undefined, '', 'Casos nulos: Maneja undefined');
runTest('', '', 'Casos nulos: Maneja string vacío');

// 2. Paraguayan numbers
runTest('5959987273405', '595987273405', 'Paraguay: 59599... -> 5959...');
runTest('5959123456789', '595123456789', 'Paraguay: 5959... -> 595...');
runTest('595812345678', '595812345678', 'Paraguay: No modifica si no empieza con 5959 (o longitud no es 13)');

// 3. Mexican numbers
runTest('526645891712', '5216645891712', 'Mexico: Agrega el 1 después del 52');
runTest('5216645891712', '5216645891712', 'Mexico: No modifica si ya tiene el 1 (521...)');
runTest('52551234567', '52551234567', 'Mexico: No modifica si la longitud no es 12');

// 4. Argentine numbers
runTest('543411234567', '5493411234567', 'Argentina: Agrega el 9 después del 54');
runTest('54153411234567', '5493411234567', 'Argentina: Remueve el 15 y agrega el 9 después del 54');
runTest('5493411234567', '5493411234567', 'Argentina: No modifica si ya empieza con 549');

// 5. Special Owner ID mapping
runTest('275162062668001', '595987273405', 'Mapeo Especial: ID del dueño a teléfono principal');

console.log('--- TODAS LAS PRUEBAS DE ADMIN STORE PASARON EXITOSAMENTE ---');
process.exit(0);
