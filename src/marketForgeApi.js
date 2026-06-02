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

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.message || 'El asistente de mercado no devolvio una respuesta valida.'
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
