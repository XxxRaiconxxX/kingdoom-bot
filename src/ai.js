import { GoogleGenerativeAI } from '@google/generative-ai';

if (!process.env.GEMINI_API_KEY) {
  console.error('[ai] ⚠️  GEMINI_API_KEY no está configurada. El Oráculo y el chat de IA no funcionarán.');
}

function getApiKeys() {
  const envKey = process.env.GEMINI_API_KEY ?? '';
  return envKey.split(',').map(k => k.trim()).filter(Boolean);
}

export async function askKingdoomAI(history, systemPrompt) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY no configurada');
  }

  const baseModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const modelsToTry = [baseModel];
  if (baseModel !== 'gemini-2.5-flash') {
    modelsToTry.push('gemini-2.5-flash');
  }
  if (baseModel !== 'gemini-3.5-flash') {
    modelsToTry.push('gemini-3.5-flash');
  }
  // Añadimos la version 1.5 como salvavidas en caso de que los servidores esten muy saturados
  if (baseModel !== 'gemini-1.5-flash') {
    modelsToTry.push('gemini-1.5-flash');
  }

  // Gemini requiere que el historial empiece con 'user' y alterne roles.
  // Sanitizamos: eliminamos el primer mensaje si no es 'user',
  // y descartamos mensajes consecutivos del mismo rol.
  let lastRole = null;
  const contents = history
    .filter((msg, i) => {
      if (i === 0 && msg.role !== 'user') return false;
      return true;
    })
    .reduce((acc, msg) => {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) return acc; // skip consecutive same-role
      lastRole = role;
      acc.push({ role, parts: [{ text: msg.content }] });
      return acc;
    }, []);

  if (!contents.length) throw new Error('Historial de mensajes vacío o inválido');

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
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
          ]
        });

        const response = await model.generateContent({
          contents,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.85,
          },
        });
        
        const text = response.response.text();
        if (!text && response.response.promptFeedback?.blockReason) {
            console.error('[ai] Prompt bloqueado por seguridad:', response.response.promptFeedback.blockReason);
        }
        return text;
      } catch (err) {
        lastError = err;
        console.error(`[ai] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error(`[ai] HTTP Status:`, err.status);
        if (err?.errorDetails) console.error(`[ai] Details:`, JSON.stringify(err.errorDetails));

        // Si el error es una cuota/limite de peticiones (429) o autenticacion/permisos (401, 403),
        // el problema es de la clave API, por lo que pasamos a la siguiente clave.
        // Si es cualquier otro error (404 no encontrado, 503 sobrecarga/indisponible, etc.),
        // el problema puede ser específico del modelo, por lo que probamos el siguiente de la lista con esta clave.
        const isKeyError = err?.status === 429 || err?.status === 401 || err?.status === 403 ||
          (err?.message && (err.message.includes('API key') || err.message.includes('quota') || err.message.includes('429')));

        if (!isKeyError) {
          console.log(`[ai] Error de modelo o servicio (${err?.status || '503/red'}). Intentando con el siguiente modelo de la lista...`);
          continue;
        }

        if (i < keys.length - 1) {
          console.log(`[ai] Error relacionado con la clave API (ej: cuotas/429/403). Pasando a la siguiente clave API...`);
        }
        break;
      }
    }
  }

  throw lastError || new Error('Todas las claves de API y modelos fallaron');
}



