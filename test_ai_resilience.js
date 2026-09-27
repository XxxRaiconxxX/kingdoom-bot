import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const savedEnvironment = Object.fromEntries([
  'AI_PROVIDER_ORDER',
  'NVIDIA_API_KEY',
  'NVIDIA_MODEL',
  'NVIDIA_FALLBACK_MODEL',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_FALLBACK_MODEL',
  'AI_REQUEST_TIMEOUT_MS',
].map((name) => [name, process.env[name]]));

try {
  process.env.AI_PROVIDER_ORDER = 'nvidia';
  process.env.NVIDIA_API_KEY = 'offline-test-key';
  process.env.NVIDIA_MODEL = 'offline-primary';
  process.env.NVIDIA_FALLBACK_MODEL = 'offline-fallback';
  process.env.AI_REQUEST_TIMEOUT_MS = '1000';

  const { describeAIError, askKingdoomAI } = await import('./src/ai.js');

  assert.equal(describeAIError(new Error('AI cooldown activo: key_invalid')).code, 'key_invalid');
  assert.equal(describeAIError(new Error('quota exceeded for model')).code, 'quota_exceeded');

  const requestedModels = [];
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal, 'Las solicitudes deben tener AbortSignal de timeout');
    const body = JSON.parse(options.body);
    requestedModels.push(body.model);
    if (body.model === 'offline-primary') {
      return new Response(JSON.stringify({ choices: [{ message: { reasoning_content: 'No exponer razonamiento' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'LISTO' } }] }), { status: 200 });
  };

  const result = await askKingdoomAI([{ role: 'user', content: 'Prueba offline' }], 'Sistema offline');
  assert.equal(result, 'LISTO');
  assert.deepEqual(requestedModels, ['offline-primary', 'offline-fallback']);

  requestedModels.length = 0;
  process.env.AI_PROVIDER_ORDER = 'groq';
  process.env.GROQ_API_KEY = 'offline-groq-key';
  process.env.GROQ_MODEL = 'offline-primary';
  process.env.GROQ_FALLBACK_MODEL = 'offline-fallback';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestedModels.push(body.model);
    if (body.model === 'offline-primary') {
      return new Response(JSON.stringify({ choices: [{ message: { reasoning: 'No exponer razonamiento' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'GROQ_FALLBACK_OK' } }] }), { status: 200 });
  };
  const reasoningOnlyResult = await askKingdoomAI([{ role: 'user', content: 'Reasoning offline' }], 'Sistema offline');
  assert.equal(reasoningOnlyResult, 'GROQ_FALLBACK_OK');
  assert.deepEqual(requestedModels, ['offline-primary', 'offline-fallback']);

  process.env.AI_PROVIDER_ORDER = 'nvidia';
  globalThis.fetch = (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const startedAt = Date.now();
  await assert.rejects(
    askKingdoomAI([{ role: 'user', content: 'Timeout offline' }], 'Sistema offline'),
    /AbortError/
  );
  assert.ok(Date.now() - startedAt < 5000, 'El timeout offline debe liberar la solicitud');

  globalThis.fetch = (_url, options) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  const bodyStartedAt = Date.now();
  await assert.rejects(
    askKingdoomAI([{ role: 'user', content: 'Body timeout offline' }], 'Sistema offline'),
    /AbortError/
  );
  assert.ok(Date.now() - bodyStartedAt < 5000, 'El timeout debe abarcar un body JSON estancado');

  console.log('AI_RESILIENCE_OK');
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
