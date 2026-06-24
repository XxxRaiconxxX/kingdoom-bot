import { slugifyKnowledgeId } from './src/supabase.js';

console.log('--- INICIANDO PRUEBAS DE SLUGIFY ---');

function runTest(input, fallback, expectedOutput, description) {
  const actualOutput = slugifyKnowledgeId(input, fallback);
  if (actualOutput === expectedOutput) {
    console.log(`✅ [OK] ${description}: '${actualOutput}'`);
  } else {
    console.error(`❌ [FAIL] ${description}: Esperaba '${expectedOutput}', obtuve '${actualOutput}'`);
    process.exit(1);
  }
}

// Test case 1: Basic string
runTest('Hello World', undefined, 'hello-world', 'Cadena básica');

// Test case 2: Uppercase to lowercase
runTest('MAYUSCULAS', undefined, 'mayusculas', 'Conversión a minúsculas');

// Test case 3: Accents and diacritics
runTest('Canción de Hielo y Fuego', undefined, 'cancion-de-hielo-y-fuego', 'Acentos y diacríticos');

// Test case 4: Special characters
runTest('¡Documento Especial! @2023', undefined, 'documento-especial-2023', 'Caracteres especiales no alfanuméricos');

// Test case 5: Multiple spaces and trimming
runTest('   muchos   espacios   ', undefined, 'muchos-espacios', 'Múltiples espacios y trim');

// Test case 6: Empty string resulting in fallback
runTest('', 'default-slug', 'default-slug', 'Cadena vacía con fallback personalizado');

// Test case 7: Special chars resulting in empty string and default fallback
runTest('@@@@', undefined, 'documento', 'Caracteres especiales resultando en cadena vacía y fallback por defecto');

console.log('--- TODAS LAS PRUEBAS DE SLUGIFY PASARON EXITOSAMENTE ---');
process.exit(0);
