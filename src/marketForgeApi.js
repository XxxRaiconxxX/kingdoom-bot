function getAssistantApiBaseUrl() {
  const configured =
    process.env.KINGDOOM_ASSISTANT_API_URL?.trim() ||
    process.env.KINGDOOM_API_BASE_URL?.trim() ||
    process.env.KINGDOOM_WEB_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return 'https://kingdoom.vercel.app';
}

function getAssistantSecret() {
  return process.env.WHATSAPP_ASSISTANT_SECRET?.trim() || '';
}

async function postAssistant(pathname, body) {
  const secret = getAssistantSecret();
  if (!secret) {
    throw new Error(
      'Falta WHATSAPP_ASSISTANT_SECRET en el bot para usar la forja automatica del mercado.'
    );
  }

  const response = await fetch(`${getAssistantApiBaseUrl()}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-kingdoom-bot-secret': secret,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const fallbackMessage = rawText
      ? `El asistente de mercado respondio ${response.status}. ${rawText.slice(0, 180).trim()}`
      : `El asistente de mercado respondio ${response.status} sin cuerpo util.`;
    throw new Error(
      payload?.message || fallbackMessage
    );
  }

  return payload;
}

export function createMarketForgeDraft(input) {
  return postAssistant('/api/admin/assistant/market', { ...input, action: 'draft' });
}

export function reviseMarketForgeDraft(input) {
  return postAssistant('/api/admin/assistant/market', { ...input, action: 'revise' });
}

export function confirmMarketForgeDraft(input) {
  return postAssistant('/api/admin/assistant/market', { ...input, action: 'confirm' });
}
