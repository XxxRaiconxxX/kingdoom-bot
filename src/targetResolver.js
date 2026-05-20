import { normalizePhone } from './adminStore.js';
import { findPlayerByIdentifier } from './supabase.js';

function extractDigits(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function cleanIdentifier(value) {
  return String(value ?? '').replace(/^@+/, '').trim();
}

function extractRawMentionToken(msg, fallbackIdentifier = '') {
  const body = String(msg?.body ?? '');
  const fromFallback = String(fallbackIdentifier ?? '');
  const source = fromFallback || body;
  const match = source.match(/@([^\s]+)/);
  return match ? cleanIdentifier(match[1]) : '';
}

export function getMentionedPhone(msg) {
  const mentioned = Array.isArray(msg?.mentionedIds) ? msg.mentionedIds[0] : '';
  return mentioned ? normalizePhone(mentioned) : '';
}

export async function extractTargetIdentifier(msg, fallbackIdentifier = '') {
  if (msg?.hasQuotedMsg) {
    const quoted = await msg.getQuotedMessage();
    const quotedPhone = normalizePhone(quoted?.author || quoted?.from);
    if (quotedPhone) {
      return { identifier: quotedPhone, source: 'quoted' };
    }
  }

  const mentionedPhone = getMentionedPhone(msg);
  if (mentionedPhone) {
    return { identifier: mentionedPhone, source: 'mentioned' };
  }

  const rawMention = extractRawMentionToken(msg, fallbackIdentifier);
  if (rawMention) {
    return { identifier: rawMention, source: 'raw-mention' };
  }

  const normalized = cleanIdentifier(fallbackIdentifier);
  if (normalized) {
    return { identifier: normalized, source: 'text' };
  }

  return { identifier: '', source: 'none' };
}

export async function resolvePlayerTarget(msg, fallbackIdentifier = '') {
  const { identifier, source } = await extractTargetIdentifier(msg, fallbackIdentifier);
  if (!identifier) {
    return {
      ok: false,
      source,
      identifier: '',
      phone: '',
      player: null,
      reason: 'missing',
    };
  }

  const normalizedIdentifier = /^\d+$/.test(extractDigits(identifier))
    ? normalizePhone(identifier)
    : identifier;

  const result = await findPlayerByIdentifier(normalizedIdentifier);

  return {
    ok: Boolean(result?.player),
    source,
    identifier: normalizedIdentifier,
    phone: result?.phone ?? (/^\d+$/.test(extractDigits(identifier)) ? normalizePhone(identifier) : ''),
    player: result?.player ?? null,
    matchType: result?.matchType ?? 'none',
    reason: result?.reason ?? 'not_found',
  };
}
