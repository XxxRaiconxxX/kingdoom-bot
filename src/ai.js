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
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
        });

        const response = await model.generateContent({
          contents,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.85,
          },
        });
        return response.response.text();
      } catch (err) {
        lastError = err;
        console.error(`[ai] Error con clave API index ${i} y modelo ${modelName}:`, err?.message ?? err);
        if (err?.status) console.error(`[ai] HTTP Status:`, err.status);
        if (err?.errorDetails) console.error(`[ai] Details:`, JSON.stringify(err.errorDetails));

        // Si es un error 404 (modelo no encontrado), probamos con el siguiente modelo de la lista para esta misma clave.
        const isModelNotFoundError = err?.status === 404 || 
          (err?.message && (err.message.includes('not found') || err.message.includes('supported')));

        if (isModelNotFoundError) {
          console.log(`[ai] Modelo ${modelName} no encontrado o no soportado. Intentando con el siguiente modelo...`);
          continue;
        }

        // Si es otro tipo de error (ej. 429 cuota), rompemos el bucle de modelos para esta clave
        // y pasamos a la siguiente clave API.
        if (i < keys.length - 1) {
          console.log(`[ai] Error no relacionado con el modelo (ej: cuotas/429). Pasando a la siguiente clave API...`);
        }
        break;
      }
    }
  }

  throw lastError || new Error('Todas las claves de API y modelos fallaron');
}


