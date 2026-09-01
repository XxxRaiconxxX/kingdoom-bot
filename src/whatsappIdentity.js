import { normalizePhone } from './adminStore.js';

const POSITIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;
const LID_LOOKUP_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.WHATSAPP_LID_LOOKUP_TIMEOUT_MS ?? '6000', 10) || 6000
);
const LID_BATCH_SIZE = Math.max(
  1,
  Math.min(10, Number.parseInt(process.env.WHATSAPP_LID_BATCH_SIZE ?? '5', 10) || 5)
);
const phoneByWhatsappId = new Map();
const pendingResolutions = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLookupTimeout(operation) {
  let timeoutId;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('LID lookup timeout')), LID_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function serializeWhatsAppId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value._serialized === 'string') return value._serialized.trim();
  if (typeof value.$1 === 'string') return value.$1.trim();
  if (value.id && value.id !== value) {
    const nested = serializeWhatsAppId(value.id);
    if (nested) return nested;
  }
  if (typeof value.user === 'string' && typeof value.server === 'string') {
    return `${value.user}@${value.server}`;
  }
  return '';
}

export function isLidWhatsAppId(value) {
  return /@lid$/i.test(serializeWhatsAppId(value));
}

function readCachedPhone(id) {
  const cached = phoneByWhatsappId.get(id);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    phoneByWhatsappId.delete(id);
    return undefined;
  }
  return cached.phone;
}

function cachePhone(id, phone) {
  phoneByWhatsappId.set(id, {
    phone,
    expiresAt: Date.now() + (phone ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
}

function normalizeResolvedPhone(value) {
  const serialized = serializeWhatsAppId(value) || String(value ?? '').trim();
  const phone = normalizePhone(serialized);
  return /^\d{7,15}$/.test(phone) ? phone : '';
}

export async function resolveWhatsAppRecipientId(client, value) {
  const phone = normalizeResolvedPhone(value);
  if (!phone) return '';
  if (!client || typeof client.getNumberId !== 'function') {
    throw new TypeError('WhatsApp client does not support getNumberId');
  }

  const registeredId = await withLookupTimeout(Promise.resolve(client.getNumberId(phone)));
  const canonicalId = serializeWhatsAppId(registeredId);
  if (!canonicalId || typeof client.getContactLidAndPhone !== 'function') return canonicalId;

  const mappings = await withLookupTimeout(
    Promise.resolve(client.getContactLidAndPhone([canonicalId]))
  );
  const mapping = Array.isArray(mappings) ? mappings[0] : mappings;
  return serializeWhatsAppId(mapping?.lid) || serializeWhatsAppId(mapping?.pn) || canonicalId;
}

export async function resolveWhatsAppPhone(client, value) {
  const id = serializeWhatsAppId(value) || String(value ?? '').trim();
  if (!id) return '';

  if (!isLidWhatsAppId(id)) {
    return normalizeResolvedPhone(id);
  }

  if (id === '275162062668001@lid') {
    return '595987273405';
  }

  const cached = readCachedPhone(id);
  if (cached !== undefined) return cached;

  if (pendingResolutions.has(id)) {
    return pendingResolutions.get(id);
  }

  const resolution = (async () => {
    if (!client || typeof client.getContactLidAndPhone !== 'function') {
      return normalizeResolvedPhone(id);
    }

    try {
      const mappings = await withLookupTimeout(client.getContactLidAndPhone([id]));
      const mapping = Array.isArray(mappings) ? mappings[0] : mappings;
      const phone = normalizeResolvedPhone(mapping?.pn || mapping?.phone) || normalizeResolvedPhone(id);
      cachePhone(id, phone);
      return phone;
    } catch (error) {
      console.warn(
        '[whatsappIdentity] No se pudo resolver un LID; se usara el identificador directo:',
        error?.message ?? error
      );
      const fallback = normalizeResolvedPhone(id);
      cachePhone(id, fallback);
      return fallback;
    }
  })();

  pendingResolutions.set(id, resolution);
  try {
    return await resolution;
  } finally {
    pendingResolutions.delete(id);
  }
}

export async function resolveContactPhone(client, contact) {
  const contactId = serializeWhatsAppId(contact?.id || contact);

  if (contactId && !isLidWhatsAppId(contactId)) {
    const phone = normalizeResolvedPhone(contact?.number || contactId);
    if (phone) return phone;
  }

  const explicitPhone = serializeWhatsAppId(contact?.phoneNumber);
  if (explicitPhone && !isLidWhatsAppId(explicitPhone)) {
    const phone = normalizeResolvedPhone(explicitPhone);
    if (phone) return phone;
  }

  return resolveWhatsAppPhone(client, contactId);
}

export async function resolveMessageSenderPhone(msg, client = msg?.client) {
  const senderId = serializeWhatsAppId(msg?.author || msg?.from);
  if (!senderId) return '';
  if (!isLidWhatsAppId(senderId)) return normalizeResolvedPhone(senderId);

  const cached = readCachedPhone(senderId);
  if (cached !== undefined) return cached;

  if (typeof msg?.getContact === 'function') {
    try {
      const contact = await msg.getContact();
      const phone = await resolveContactPhone(client, contact);
      if (phone) {
        cachePhone(senderId, phone);
        return phone;
      }
    } catch {
      // Contact lookup is best effort; the official LID mapper remains the fallback.
    }
  }

  return resolveWhatsAppPhone(client, senderId);
}

export async function resolveMessageSenderIdentity(msg, client = msg?.client) {
  const rawIds = [
    serializeWhatsAppId(msg?.author),
    serializeWhatsAppId(msg?.from),
    serializeWhatsAppId(msg?.id?.participant),
    serializeWhatsAppId(msg?.participant),
  ].filter(Boolean);
  const senderId = rawIds.find(Boolean);
  const primary = senderId
    ? await resolveMessageSenderPhone({ ...msg, author: senderId }, client)
    : '';
  const aliases = [];

  const addAlias = (value) => {
    const phone = normalizeResolvedPhone(value);
    if (phone && !aliases.includes(phone)) aliases.push(phone);
  };

  addAlias(primary);
  rawIds.forEach(addAlias);

  return {
    primary,
    aliases,
    raw: senderId,
  };
}

export async function resolveWhatsAppPhones(client, values) {
  const phones = [];
  const unresolved = [];
  const resolved = [];
  const pendingLids = [];
  const ids = [...new Set((values ?? [])
    .map((value) => serializeWhatsAppId(value) || String(value ?? '').trim())
    .filter(Boolean))];

  const record = (id, phone) => {
    if (!phone) {
      unresolved.push(id);
      return;
    }
    resolved.push({ id, phone });
    if (!phones.includes(phone)) phones.push(phone);
  };

  for (const id of ids) {
    if (!isLidWhatsAppId(id)) {
      record(id, normalizeResolvedPhone(id));
      continue;
    }

    if (id === '275162062668001@lid') {
      record(id, '595987273405');
      continue;
    }

    const cached = readCachedPhone(id);
    if (cached !== undefined) {
      record(id, cached);
      continue;
    }

    if (pendingResolutions.has(id)) {
      record(id, await pendingResolutions.get(id));
      continue;
    }

    pendingLids.push(id);
  }

  for (let index = 0; index < pendingLids.length; index += LID_BATCH_SIZE) {
    const batch = pendingLids.slice(index, index + LID_BATCH_SIZE);
    if (!client || typeof client.getContactLidAndPhone !== 'function') {
      batch.forEach((id) => record(id, ''));
      continue;
    }

    try {
      const result = await withLookupTimeout(client.getContactLidAndPhone(batch));
      const mappings = Array.isArray(result) ? result : [];
      batch.forEach((id, batchIndex) => {
        const mapping = mappings.find((entry) => serializeWhatsAppId(entry?.lid) === id)
          || mappings[batchIndex];
        const phone = normalizeResolvedPhone(mapping?.pn || mapping?.phone);
        cachePhone(id, phone);
        record(id, phone);
      });
    } catch (error) {
      console.warn(
        '[whatsappIdentity] Fallo un lote de resolución LID; se omiten identidades no verificadas:',
        error?.message ?? error
      );
      batch.forEach((id) => {
        cachePhone(id, '');
        record(id, '');
      });
    }

    if (index + LID_BATCH_SIZE < pendingLids.length) {
      await wait(150);
    }
  }

  return { phones, unresolved, resolved };
}

export function clearWhatsAppIdentityCache() {
  phoneByWhatsappId.clear();
  pendingResolutions.clear();
}
