import { GoogleGenerativeAI } from '@google/generative-ai';

if (!process.env.GEMINI_API_KEY) {
  console.error('[ai] ⚠️  GEMINI_API_KEY no está configurada. El Oráculo y el chat de IA no funcionarán.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

export async function askKingdoomAI(history, systemPrompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada');
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  console.log(`[ai] Usando modelo: ${modelName}`);

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

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

  try {
    const response = await model.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.85,
      },
    });
    return response.response.text();
  } catch (err) {
    console.error('[ai] Error Gemini API:', err?.message ?? err);
    if (err?.status) console.error('[ai] HTTP Status:', err.status);
    if (err?.errorDetails) console.error('[ai] Details:', JSON.stringify(err.errorDetails));
    throw err;
  }
}
