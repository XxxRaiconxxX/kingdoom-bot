import { GoogleGenerativeAI } from '@google/generative-ai';

if (!process.env.GEMINI_API_KEY) {
  console.error('[ai] GEMINI_API_KEY no esta configurada. El Oraculo y el chat de IA no funcionaran.');
}

function getApiKeys() {
  const envKey = process.env.GEMINI_API_KEY ?? '';
  return envKey.split(',').map((k) => k.trim()).filter(Boolean);
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

export async function askKingdoomAI(history, systemPrompt, options = {}) {
  const keys = getApiKeys();
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
        return text;
      } catch (err) {
        lastError = err;
        console.error(`[ai] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error('[ai] HTTP Status:', err.status);
        if (err?.errorDetails) console.error('[ai] Details:', JSON.stringify(err.errorDetails));

        const isKeyError = err?.status === 429 || err?.status === 401 || err?.status === 403
          || (err?.message && (err.message.includes('API key') || err.message.includes('quota') || err.message.includes('429')));

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
