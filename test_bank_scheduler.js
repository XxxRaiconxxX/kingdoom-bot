import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const {
  formatAsuncionDateKey,
  processBankInstallments,
  supabase,
} = await import('./src/supabase.js');

assert.equal(
  formatAsuncionDateKey(new Date('2026-01-15T12:00:00.000Z')),
  '2026-01-15'
);
await assert.rejects(
  processBankInstallments('   '),
  /La clave de ejecucion del banco es obligatoria/
);

const originalRpc = supabase.rpc;
try {
  let receivedCall;
  supabase.rpc = async (functionName, params) => {
    receivedCall = { functionName, params };
    return { data: { processed_count: 2 }, error: null };
  };

  assert.deepEqual(
    await processBankInstallments('bank:2026-01-15'),
    { processed_count: 2 }
  );
  assert.deepEqual(receivedCall, {
    functionName: 'bank_collect_due_installments',
    params: { p_run_key: 'bank:2026-01-15' },
  });

  supabase.rpc = async () => ({
    data: null,
    error: { message: 'database unavailable' },
  });
  await assert.rejects(
    processBankInstallments('bank:2026-01-15'),
    /No se pudieron procesar las cuotas del banco: database unavailable/
  );
} finally {
  supabase.rpc = originalRpc;
}

console.log('BANK_SCHEDULER_WRAPPER_OK');
