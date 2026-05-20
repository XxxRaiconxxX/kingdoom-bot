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

  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

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
      console.error(`[ai] Error con clave API index ${i}:`, err?.message ?? err);
      if (err?.status) console.error(`[ai] HTTP Status index ${i}:`, err.status);
      if (err?.errorDetails) console.error(`[ai] Details index ${i}:`, JSON.stringify(err.errorDetails));

      if (i < keys.length - 1) {
        console.log(`[ai] Reintentando con la siguiente clave API...`);
      }
    }
  }

  throw lastError || new Error('Todas las claves de API fallaron');
}

