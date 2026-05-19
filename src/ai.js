import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askKingdoomAI(history, systemPrompt) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash', // ✅ actualizado desde 1.5-flash
    systemInstruction: systemPrompt,
  });

  // Gemini requiere que el historial empiece con 'user' y alterne roles.
  // Si por algún bug llega mal formado, lo sanitizamos acá.
  const contents = history
    .filter((msg, i) => {
      if (i === 0 && msg.role !== 'user') return false;
      return true;
    })
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

  const response = await model.generateContent({
    contents,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.85,
    },
  });

  return response.response.text();
}
