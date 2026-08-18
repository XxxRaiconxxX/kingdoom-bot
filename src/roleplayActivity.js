import { serializeWhatsAppId } from './whatsappIdentity.js';

const TRIVIAL_ROLEPLAY_REPLIES = new Set([
  'ok',
  'oka',
  'xd',
  'si',
  'no',
  'dale',
  'jaja',
  'ajaj',
  'jsjs',
  'lol',
  'uh',
  'ah',
  'hey',
]);

function normalizeRoleplayText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getRoleplayMessageText(msg) {
  if (typeof msg?.caption === 'string' && msg.caption.trim()) {
    return msg.caption.trim();
  }
  return typeof msg?.body === 'string' ? msg.body.trim() : '';
}

export function getRoleplayMessageId(msg) {
  return serializeWhatsAppId(msg?.id) || String(msg?.id?._serialized ?? '').trim();
}

export function getRoleplayMessageChatId(msg) {
  return serializeWhatsAppId(msg?.from)
    || serializeWhatsAppId(msg?.id?.remote)
    || serializeWhatsAppId(msg?._data?.from);
}

export function isLikelyLowEffortRoleplayText(value) {
  const normalized = normalizeRoleplayText(value);
  if (!normalized) return true;
  if (TRIVIAL_ROLEPLAY_REPLIES.has(normalized)) return true;

  const alphaNumeric = normalized.replace(/[^a-z0-9\s]/g, ' ').trim();
  const words = alphaNumeric.split(/\s+/).filter(Boolean);
  const compactLength = alphaNumeric.replace(/\s+/g, '').length;
  return compactLength < 12 && words.length < 3;
}

export function evaluateRoleplayActivityMessage(msg, expectedGroupId) {
  const groupJid = getRoleplayMessageChatId(msg);
  const normalizedExpectedGroupId = serializeWhatsAppId(expectedGroupId);
  const inRoleplayGroup = Boolean(
    groupJid
    && normalizedExpectedGroupId
    && groupJid === normalizedExpectedGroupId
  );

  if (!inRoleplayGroup) {
    return { eligible: false, inRoleplayGroup: false, reason: 'wrong_group', groupJid, text: '' };
  }

  const text = getRoleplayMessageText(msg);
  if (!text) {
    return { eligible: false, inRoleplayGroup: true, reason: 'empty', groupJid, text };
  }
  if (text.startsWith('!')) {
    return { eligible: false, inRoleplayGroup: true, reason: 'command', groupJid, text };
  }
  if (isLikelyLowEffortRoleplayText(text)) {
    return { eligible: false, inRoleplayGroup: true, reason: 'low_effort', groupJid, text };
  }

  return { eligible: true, inRoleplayGroup: true, reason: 'accepted', groupJid, text };
}

export function isAutomaticRoleplayLock(access) {
  return !access?.lock_reason || access.lock_reason === 'roleplay_inactive';
}

export function buildRoleplayLockUpdate(access) {
  const automaticLockCleared = Boolean(
    access?.locked_at && isAutomaticRoleplayLock(access)
  );
  const shouldClearLockFields = !access?.locked_at || isAutomaticRoleplayLock(access);
  return {
    locked_at: shouldClearLockFields ? null : access.locked_at,
    lock_reason: shouldClearLockFields ? null : access.lock_reason,
    automaticLockCleared,
  };
}
