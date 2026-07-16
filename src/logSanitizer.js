const SECRET_PATTERNS = [
  /\b(?:nvapi|gsk|hf)[_-][A-Za-z0-9_-]{6,}\b/gi,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{8,}\b/gi,
];

export function sanitizeLogText(value) {
  let text = String(value ?? '');

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[redacted-secret]');
  }

  return text
    .replace(/([?&](?:token|key|api_key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b\d{5,}(?:-\d+)?@(?:c\.us|g\.us|lid|s\.whatsapp\.net)\b/gi, '[redacted-jid]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]');
}
