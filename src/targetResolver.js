import { normalizePhone } from './adminStore.js';
import { findPlayerByIdentifier } from './supabase.js';

const quotedDetailsCache = new WeakMap();

function getMessageStanzaId(value) {
  const messageId = String(value ?? '').trim();
  if (!messageId) return '';

  const serializedMatch = messageId.match(/^(?:true|false)_[^_]+_([^_]+)(?:_|$)/i);
  return serializedMatch?.[1] || messageId;
}

export function findActiveQuotedMessageKey(activeMessages, quotedId) {
  const candidate = String(quotedId ?? '').trim();
  if (!candidate || !activeMessages) return null;
  if (activeMessages.has(candidate)) return candidate;

  const candidateStanza = getMessageStanzaId(candidate);
  for (const activeId of activeMessages.keys()) {
    if (getMessageStanzaId(activeId) === candidateStanza) {
      return activeId;
    }
  }

  return null;
}

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

export async function safeGetQuotedDetails(msg) {
  if (!msg || !msg.hasQuotedMsg) {
    return { hasQuoted: false, id: null, author: null, body: null };
  }

  if (quotedDetailsCache.has(msg)) {
    return quotedDetailsCache.get(msg);
  }

  const resolution = (async () => {
    let id = null;
    let author = null;
    let body = null;

    if (msg._data) {
      const rawQuoted = msg._data.quotedMsg;
      if (rawQuoted) {
        if (rawQuoted.id) {
          id = rawQuoted.id._serialized || rawQuoted.id;
        }
        author = rawQuoted.author || rawQuoted.from || null;
        body = rawQuoted.body || rawQuoted.caption || null;
      }
      id ||= msg._data.quotedStanzaID || null;
      author ||= msg._data.quotedParticipant || null;
    }

    if ((!id || !author) && typeof msg.getQuotedMessage === 'function') {
      try {
        const quoted = await msg.getQuotedMessage();
        if (quoted) {
          id ||= quoted.id?._serialized || quoted.id?.id || null;
          author ||= quoted.author || quoted.from || null;
          body ||= quoted.body || quoted.caption || null;
        }
      } catch {
        // Best effort: stale and encrypted quote metadata is expected to fail sometimes.
      }
    }

    return {
      hasQuoted: Boolean(id || author || body),
      id,
      author,
      body,
    };
  })();

  quotedDetailsCache.set(msg, resolution);
  return resolution;
}

export async function extractTargetIdentifier(msg, fallbackIdentifier = '') {
  if (msg?.hasQuotedMsg) {
    const quotedDetails = await safeGetQuotedDetails(msg);
    const quotedPhone = normalizePhone(quotedDetails.author);
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
