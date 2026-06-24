import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKeyCooldowns = new Map();
const NVIDIA_API_BASE_URL = process.env.NVIDIA_API_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const GROQ_API_BASE_URL = process.env.GROQ_API_BASE_URL || 'https://api.groq.com/openai/v1';
const SUPPORTED_AI_PROVIDERS = new Set(['gemini', 'nvidia', 'groq']);

if (!process.env.GEMINI_API_KEY) {
  console.error('[ai] GEMINI_API_KEY no esta configurada. El Oraculo y el chat de IA no funcionaran.');
}

function parseApiKeyList(value) {
  return String(value ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function getGeminiApiKeys() {
  return parseApiKeyList(process.env.GEMINI_API_KEY);
}

function getNvidiaApiKeys() {
  return parseApiKeyList(process.env.NVIDIA_API_KEY);
}

function getGroqApiKeys() {
  return parseApiKeyList(process.env.GROQ_API_KEY);
}

function getProviderKeyCount(provider) {
  if (provider === 'gemini') return getGeminiApiKeys().length;
  if (provider === 'nvidia') return getNvidiaApiKeys().length;
  if (provider === 'groq') return getGroqApiKeys().length;
  return 0;
}

function getProviderOrder() {
  const requested = String(process.env.AI_PROVIDER_ORDER || 'nvidia,groq,gemini')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

  const unique = [];
  for (const provider of requested) {
    if (SUPPORTED_AI_PROVIDERS.has(provider) && !unique.includes(provider)) {
      unique.push(provider);
    }
  }

  return unique.length ? unique : ['nvidia', 'groq', 'gemini'];
}

function getKeyFingerprint(key) {
  return String(key ?? '').trim().slice(0, 12);
}

function logProviderSuccess(provider, key, modelName, extra = '') {
  const fingerprint = getKeyFingerprint(key);
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[ai] Provider ${provider} respondio correctamente con modelo ${modelName} y key ${fingerprint}...${suffix}`);
}

function getCooldownId(provider, key, modelName, scope = 'key') {
  return scope === 'model'
    ? `${provider}::${getKeyFingerprint(key)}::${modelName}`
    : `${provider}::${getKeyFingerprint(key)}`;
}

function readCooldown(provider, key, modelName) {
  const now = Date.now();
  const candidates = [
    apiKeyCooldowns.get(getCooldownId(provider, key, modelName, 'model')),
    apiKeyCooldowns.get(getCooldownId(provider, key, modelName, 'key')),
  ].filter(Boolean);

  for (const entry of candidates) {
    if (entry.until > now) {
      return entry;
    }
  }

  apiKeyCooldowns.delete(getCooldownId(provider, key, modelName, 'model'));
  apiKeyCooldowns.delete(getCooldownId(provider, key, modelName, 'key'));
  return null;
}

function writeCooldown(provider, key, modelName, reason, durationMs, scope = 'key') {
  apiKeyCooldowns.set(getCooldownId(provider, key, modelName, scope), {
    reason,
    until: Date.now() + durationMs,
  });
}

function parseRetryDelayMs(err) {
  const retryInfo = err?.errorDetails?.find?.((detail) => detail?.['@type']?.includes('RetryInfo'));
  const retryDelay = retryInfo?.retryDelay ?? '';
  const seconds = Number.parseInt(String(retryDelay).replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return null;
}

function classifyAIError(err) {
  const message = String(err?.message ?? '').toLowerCase();
  const status = Number(err?.status ?? 0);

  if (status === 400 && message.includes('api key')) return 'key_invalid';
  if (status === 401) return 'key_invalid';
  if (status === 403) return 'access_denied';
  if (status === 429 || message.includes('quota exceeded') || message.includes('too many requests')) return 'quota_exceeded';
  if (status === 503 || message.includes('service unavailable') || message.includes('high demand')) return 'service_unavailable';
  if (message.includes('api key')) return 'key_invalid';
  return 'unknown';
}

export function describeAIError(err) {
  switch (classifyAIError(err)) {
    case 'key_invalid':
      return {
        code: 'key_invalid',
        userMessage: 'El oráculo está ciego por ahora; una de sus runas de invocación quedó inválida.',
      };
    case 'access_denied':
      return {
        code: 'access_denied',
        userMessage: 'El oráculo perdió acceso a sus visiones. Hay que restaurar sus permisos arcanos.',
      };
    case 'quota_exceeded':
      return {
        code: 'quota_exceeded',
        userMessage: 'El oráculo agotó su cuota de visiones por ahora. Intentá de nuevo más tarde.',
      };
    case 'service_unavailable':
      return {
        code: 'service_unavailable',
        userMessage: 'El oráculo siente demasiado ruido en los planos. Esperá un poco e intentá otra vez.',
      };
    default:
      return {
        code: 'unknown',
        userMessage: 'El oráculo guarda silencio... intentá de nuevo más tarde.',
      };
  }
}

function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

function truncateToTokenBudget(text, maxTokens) {
  const safeText = String(text ?? '');
  const maxChars = Math.max(maxTokens, 1) * 4;
  if (safeText.length <= maxChars) return safeText;
  return `${safeText.slice(0, maxChars).trimEnd()}\n...[truncado por limite de tokens estimados]`;
}

function applyInputBudget(history, systemPrompt, maxEstimatedInputTokens) {
  if (!maxEstimatedInputTokens) {
    return { history, systemPrompt, trimmed: false };
  }

  let trimmed = false;
  let safeSystemPrompt = String(systemPrompt ?? '');
  let systemTokens = estimateTokens(safeSystemPrompt);
  const maxSystemTokens = Math.max(Math.floor(maxEstimatedInputTokens * 0.45), 512);

  if (systemTokens > maxSystemTokens) {
    safeSystemPrompt = truncateToTokenBudget(safeSystemPrompt, maxSystemTokens);
    systemTokens = estimateTokens(safeSystemPrompt);
    trimmed = true;
  }

  const remainingBudget = Math.max(maxEstimatedInputTokens - systemTokens, 256);
  const normalizedHistory = history.map((msg) => ({
    role: msg.role,
    content: String(msg.content ?? ''),
  }));

  const selected = [];
  let usedTokens = 0;
  for (let i = normalizedHistory.length - 1; i >= 0; i -= 1) {
    const msg = normalizedHistory[i];
    const messageTokens = estimateTokens(msg.content);
    if (selected.length === 0) {
      const content = messageTokens > remainingBudget
        ? truncateToTokenBudget(msg.content, remainingBudget)
        : msg.content;
      trimmed = trimmed || content !== msg.content;
      selected.push({ ...msg, content });
      usedTokens += estimateTokens(content);
      continue;
    }

    if (usedTokens + messageTokens > remainingBudget) {
      trimmed = true;
      continue;
    }

    selected.push(msg);
    usedTokens += messageTokens;
  }

  return {
    history: selected.reverse(),
    systemPrompt: safeSystemPrompt,
    trimmed,
  };
}

function buildGeminiContents(history) {
  let lastRole = null;
  return history
    .filter((msg, i) => {
      if (i === 0 && msg.role !== 'user') return false;
      return true;
    })
    .reduce((acc, msg) => {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) return acc;
      lastRole = role;
      acc.push({ role, parts: [{ text: msg.content }] });
      return acc;
    }, []);
}

function buildOpenAICompatibleMessages(history, systemPrompt) {
  const normalizedHistory = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: String(msg.content ?? ''),
  }));

  const messages = [];
  const safeSystemPrompt = String(systemPrompt ?? '').trim();
  if (safeSystemPrompt) {
    messages.push({ role: 'system', content: safeSystemPrompt });
  }

  for (const msg of normalizedHistory) {
    messages.push(msg);
  }

  return messages;
}

async function countInputTokens(model, systemPrompt, contents) {
  try {
    const result = await model.countTokens({ contents });
    return result?.totalTokens ?? null;
  } catch (err) {
    console.warn('[ai] No se pudo contar tokens oficialmente:', err?.message ?? err);
    return null;
  }
}

function shrinkHistoryToTokenBudget(history, systemPrompt, maxInputTokens, officialTokenCount) {
  if (!history.length) {
    return { history, systemPrompt, trimmed: false };
  }

  const safeSystemPrompt = String(systemPrompt ?? '');
  const safeHistory = history.map((msg) => ({
    role: msg.role,
    content: String(msg.content ?? ''),
  }));

  const approxCurrent = officialTokenCount ?? (
    estimateTokens(safeSystemPrompt) + safeHistory.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
  );
  if (approxCurrent <= maxInputTokens) {
    return { history: safeHistory, systemPrompt: safeSystemPrompt, trimmed: false };
  }

  const overflow = approxCurrent - maxInputTokens;
  const lastIndex = safeHistory.length - 1;
  const lastMessage = safeHistory[lastIndex];
  const lastTokens = estimateTokens(lastMessage.content);
  const nextTarget = Math.max(lastTokens - overflow - 128, 256);

  safeHistory[lastIndex] = {
    ...lastMessage,
    content: truncateToTokenBudget(lastMessage.content, nextTarget),
  };

  return {
    history: safeHistory,
    systemPrompt: safeSystemPrompt,
    trimmed: true,
  };
}

async function askGeminiAI(history, systemPrompt, options = {}) {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY no configurada');
  }

  const baseModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  // Cadena de fallback: solo modelos reales y vigentes de la API de Google.
  // (gemini-3.5-flash no existe -> 404 garantizado; gemini-1.5-flash esta retirado)
  const modelsToTry = [baseModel];
  if (baseModel !== 'gemini-2.5-flash') {
    modelsToTry.push('gemini-2.5-flash');
  }
  if (baseModel !== 'gemini-2.0-flash') {
    modelsToTry.push('gemini-2.0-flash');
  }

  const {
    maxEstimatedInputTokens = null,
    maxOutputTokens = 2048,
    temperature = 0.85,
  } = options;

  let lastError = null;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    for (const modelName of modelsToTry) {
      const cooldown = readCooldown('gemini', key, modelName);
      if (cooldown) {
        console.log(`[ai] Saltando clave/modelo en cooldown (${cooldown.reason}) hasta ${new Date(cooldown.until).toISOString()}`);
        lastError = lastError ?? new Error(`AI cooldown activo: ${cooldown.reason}`);
        continue;
      }

      console.log(`[ai] Intentando con clave API index ${i} (${key.substring(0, 8)}...) y modelo ${modelName}`);

      try {
        const genAI = new GoogleGenerativeAI(key);
        const { HarmCategory, HarmBlockThreshold } = await import('@google/generative-ai');

        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ],
        });

        let budgeted = applyInputBudget(history, systemPrompt, maxEstimatedInputTokens);
        if (budgeted.trimmed) {
          console.warn(`[ai] Se recorto el payload para mantenerse dentro del presupuesto estimado de ${maxEstimatedInputTokens} tokens.`);
        }

        let contents = buildGeminiContents(budgeted.history);
        if (!contents.length) throw new Error('Historial de mensajes vacio o invalido');

        if (maxEstimatedInputTokens) {
          const officialTokenCount = await countInputTokens(model, budgeted.systemPrompt, contents);
          if (officialTokenCount != null) {
            console.log(`[ai] Input tokens oficiales: ${officialTokenCount}`);
            if (officialTokenCount > maxEstimatedInputTokens) {
              const tightened = shrinkHistoryToTokenBudget(
                budgeted.history,
                budgeted.systemPrompt,
                maxEstimatedInputTokens,
                officialTokenCount
              );
              if (tightened.trimmed) {
                console.warn(`[ai] Payload ajustado tras countTokens oficial para bajar de ${officialTokenCount} a <= ${maxEstimatedInputTokens}.`);
              }
              budgeted = tightened;
              contents = buildGeminiContents(budgeted.history);
              if (!contents.length) throw new Error('Historial de mensajes vacio o invalido tras el recorte oficial de tokens');
            }
          }
        }

        const response = await model.generateContent({
          contents,
          generationConfig: {
            maxOutputTokens,
            temperature,
          },
        });

        const text = response.response.text();
        if (response.response.usageMetadata) {
          console.log('[ai] Usage metadata:', JSON.stringify(response.response.usageMetadata));
        }
        if (!text && response.response.promptFeedback?.blockReason) {
          console.error('[ai] Prompt bloqueado por seguridad:', response.response.promptFeedback.blockReason);
        }
        logProviderSuccess('gemini', key, modelName);
        return text;
      } catch (err) {
        lastError = err;
        console.error(`[ai] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error('[ai] HTTP Status:', err.status);
        if (err?.errorDetails) console.error('[ai] Details:', JSON.stringify(err.errorDetails));
        const errorType = classifyAIError(err);
        const retryDelayMs = parseRetryDelayMs(err);

        if (errorType === 'key_invalid') {
          writeCooldown('gemini', key, modelName, errorType, 1000 * 60 * 60 * 12);
        } else if (errorType === 'access_denied') {
          writeCooldown('gemini', key, modelName, errorType, 1000 * 60 * 60);
        } else if (errorType === 'quota_exceeded') {
          writeCooldown('gemini', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 10);
        } else if (errorType === 'service_unavailable') {
          writeCooldown('gemini', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 2, 'model');
        }

        const isKeyError = errorType === 'key_invalid'
          || errorType === 'access_denied'
          || errorType === 'quota_exceeded';

        if (!isKeyError) {
          console.log(`[ai] Error de modelo o servicio (${err?.status || '503/red'}). Intentando con el siguiente modelo de la lista...`);
          continue;
        }

        if (i < keys.length - 1) {
          console.log('[ai] Error relacionado con la clave API (ej: cuotas/429/403). Pasando a la siguiente clave API...');
        }
        break;
      }
    }
  }

  throw lastError || new Error('Todas las claves de API y modelos fallaron');
}

async function askNvidiaAI(history, systemPrompt, options = {}) {
  const keys = getNvidiaApiKeys();
  if (keys.length === 0) {
    throw new Error('NVIDIA_API_KEY no configurada');
  }

  const {
    maxEstimatedInputTokens = null,
    maxOutputTokens = 2048,
    temperature = 0.85,
  } = options;

  const configuredModels = [
    process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
    process.env.NVIDIA_FALLBACK_MODEL || 'qwen/qwen3-32b',
  ].filter((model, index, arr) => model && arr.indexOf(model) === index);

  let lastError = null;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    for (const modelName of configuredModels) {
      const cooldown = readCooldown('nvidia', key, modelName);
      if (cooldown) {
        console.log(`[ai][nvidia] Saltando clave/modelo en cooldown (${cooldown.reason}) hasta ${new Date(cooldown.until).toISOString()}`);
        lastError = lastError ?? new Error(`NVIDIA cooldown activo: ${cooldown.reason}`);
        continue;
      }

      try {
        const budgeted = applyInputBudget(history, systemPrompt, maxEstimatedInputTokens);
        const messages = buildOpenAICompatibleMessages(budgeted.history, budgeted.systemPrompt);
        const response = await fetch(`${NVIDIA_API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            messages,
            max_tokens: maxOutputTokens,
            temperature,
            stream: false,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload?.error?.message || payload?.message || `NVIDIA request failed with status ${response.status}`);
          error.status = response.status;
          error.errorDetails = payload?.error ? [payload.error] : payload;
          throw error;
        }

        const text = payload?.choices?.[0]?.message?.content?.trim?.();
        if (!text) {
          throw new Error('Respuesta vacia desde NVIDIA');
        }

        logProviderSuccess('nvidia', key, modelName);
        return text;
      } catch (err) {
        lastError = err;
        console.error(`[ai][nvidia] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error('[ai][nvidia] HTTP Status:', err.status);
        if (err?.errorDetails) console.error('[ai][nvidia] Details:', JSON.stringify(err.errorDetails));

        const errorType = classifyAIError(err);
        const retryDelayMs = parseRetryDelayMs(err);

        if (errorType === 'key_invalid') {
          writeCooldown('nvidia', key, modelName, errorType, 1000 * 60 * 60 * 12);
        } else if (errorType === 'access_denied') {
          writeCooldown('nvidia', key, modelName, errorType, 1000 * 60 * 60);
        } else if (errorType === 'quota_exceeded') {
          writeCooldown('nvidia', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 10);
        } else if (errorType === 'service_unavailable') {
          writeCooldown('nvidia', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 2, 'model');
        }

        const isProviderError = errorType === 'key_invalid'
          || errorType === 'access_denied'
          || errorType === 'quota_exceeded';

        if (!isProviderError) {
          console.log(`[ai][nvidia] Error de modelo o servicio (${err?.status || 'red'}). Intentando con el siguiente modelo de la lista...`);
          continue;
        }

        if (i < keys.length - 1) {
          console.log('[ai][nvidia] Error relacionado con la clave API. Pasando a la siguiente clave...');
        }
        break;
      }
    }
  }

  throw lastError || new Error('Todas las claves NVIDIA y modelos fallaron');
}

async function askGroqAI(history, systemPrompt, options = {}) {
  const keys = getGroqApiKeys();
  if (keys.length === 0) {
    throw new Error('GROQ_API_KEY no configurada');
  }

  const {
    maxEstimatedInputTokens = null,
    maxOutputTokens = 2048,
    temperature = 0.85,
  } = options;

  const configuredModels = [
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant',
  ].filter((model, index, arr) => model && arr.indexOf(model) === index);

  let lastError = null;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    for (const modelName of configuredModels) {
      const cooldown = readCooldown('groq', key, modelName);
      if (cooldown) {
        console.log(`[ai][groq] Saltando clave/modelo en cooldown (${cooldown.reason}) hasta ${new Date(cooldown.until).toISOString()}`);
        lastError = lastError ?? new Error(`Groq cooldown activo: ${cooldown.reason}`);
        continue;
      }

      try {
        const budgeted = applyInputBudget(history, systemPrompt, maxEstimatedInputTokens);
        const messages = buildOpenAICompatibleMessages(budgeted.history, budgeted.systemPrompt);
        const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            messages,
            max_tokens: maxOutputTokens,
            temperature,
            stream: false,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload?.error?.message || payload?.message || `Groq request failed with status ${response.status}`);
          error.status = response.status;
          error.errorDetails = payload?.error ? [payload.error] : payload;
          throw error;
        }

        const text = payload?.choices?.[0]?.message?.content?.trim?.();
        if (!text) {
          throw new Error('Respuesta vacia desde Groq');
        }

        logProviderSuccess('groq', key, modelName);
        return text;
      } catch (err) {
        lastError = err;
        console.error(`[ai][groq] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error('[ai][groq] HTTP Status:', err.status);
        if (err?.errorDetails) console.error('[ai][groq] Details:', JSON.stringify(err.errorDetails));

        const errorType = classifyAIError(err);
        const retryDelayMs = parseRetryDelayMs(err);

        if (errorType === 'key_invalid') {
          writeCooldown('groq', key, modelName, errorType, 1000 * 60 * 60 * 12);
        } else if (errorType === 'access_denied') {
          writeCooldown('groq', key, modelName, errorType, 1000 * 60 * 60);
        } else if (errorType === 'quota_exceeded') {
          writeCooldown('groq', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 10);
        } else if (errorType === 'service_unavailable') {
          writeCooldown('groq', key, modelName, errorType, retryDelayMs ?? 1000 * 60 * 2, 'model');
        }

        const isProviderError = errorType === 'key_invalid'
          || errorType === 'access_denied'
          || errorType === 'quota_exceeded';

        if (!isProviderError) {
          console.log(`[ai][groq] Error de modelo o servicio (${err?.status || 'red'}). Intentando con el siguiente modelo de la lista...`);
          continue;
        }

        if (i < keys.length - 1) {
          console.log('[ai][groq] Error relacionado con la clave API. Pasando a la siguiente clave...');
        }
        break;
      }
    }
  }

  throw lastError || new Error('Todas las claves Groq y modelos fallaron');
}

export async function askKingdoomAI(history, systemPrompt, options = {}) {
  const providers = getProviderOrder();
  console.log(`[ai] Orden efectivo de proveedores: ${providers.join(' -> ')}`);
  let lastError = null;

  for (const provider of providers) {
    const keyCount = getProviderKeyCount(provider);
    if (keyCount === 0) {
      console.log(`[ai] Provider ${provider} omitido: no hay claves configuradas.`);
      continue;
    }

    console.log(`[ai] Intentando provider ${provider} con ${keyCount} clave(s) disponible(s).`);

    try {
      if (provider === 'gemini') {
        return await askGeminiAI(history, systemPrompt, options);
      }

      if (provider === 'nvidia') {
        return await askNvidiaAI(history, systemPrompt, options);
      }

      if (provider === 'groq') {
        return await askGroqAI(history, systemPrompt, options);
      }
    } catch (err) {
      lastError = err;
      console.error(`[ai] Provider ${provider} fallo:`, err?.message ?? err);
    }
  }

  throw lastError || new Error('No hay proveedores de IA disponibles');
}
