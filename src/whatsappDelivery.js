export const NOTIFICATION_CONTEXT_RETRY_DELAY_MS = 5 * 60 * 1000;
const configuredAmbiguousHoldMs = Number.parseInt(
  process.env.WHATSAPP_AMBIGUOUS_DELIVERY_HOLD_MS ?? '1800000',
  10
);
export const WHATSAPP_AMBIGUOUS_DELIVERY_HOLD_MS = Math.max(
  5 * 60 * 1000,
  Number.isFinite(configuredAmbiguousHoldMs) ? configuredAmbiguousHoldMs : 30 * 60 * 1000
);
const configuredAckTimeoutMs = Number.parseInt(
  process.env.WHATSAPP_DELIVERY_ACK_TIMEOUT_MS ?? '20000',
  10
);
export const WHATSAPP_DELIVERY_ACK_TIMEOUT_MS = Math.max(
  5_000,
  Number.isFinite(configuredAckTimeoutMs) ? configuredAckTimeoutMs : 20_000
);
const MESSAGE_CREATE_RECOVERY_TIMEOUT_MS = 2_000;
const outboundResultLocks = new WeakMap();

export function getWhatsAppMessageId(value) {
  const seen = new Set();

  const visit = (candidate) => {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      return String(candidate).trim();
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) {
      return '';
    }

    seen.add(candidate);
    const nestedCandidates = [
      candidate._serialized,
      candidate.$1,
      candidate.messageId,
      candidate.stanzaId,
      candidate.id,
      candidate.quotedStanzaID,
      candidate.key?.id,
      candidate._data?.id,
      candidate._data?.key,
      candidate._data?.stanzaId,
    ];

    for (const nested of nestedCandidates) {
      const messageId = visit(nested);
      if (messageId) return messageId;
    }

    return '';
  };

  return visit(value);
}

export function hasQuotedMessageMetadata(msg) {
  if (!msg || typeof msg !== 'object') return false;

  const dataSources = [
    msg._data,
    msg._originalMsg?._data,
  ].filter(Boolean);

  return Boolean(
    msg.hasQuotedMsg
    || dataSources.some((data) => (
      data.quotedMsg
      || data.quotedSticker
      || getWhatsAppMessageId(data.quotedStanzaID)
      || getWhatsAppMessageId(data.quotedMsg?.id)
      || data.quotedParticipant
    ))
  );
}

function isServerAcknowledged(ack) {
  return Number(ack) >= 1;
}

function normalizeMessageBody(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function normalizeChatId(value) {
  const candidate = value?._serialized ?? value?.$1 ?? value?.id?._serialized ?? value?.id ?? value;
  if (typeof candidate !== 'string' && typeof candidate !== 'number') return '';
  return String(candidate).trim().replace(/@s\.whatsapp\.net$/i, '@c.us');
}

function isMatchingOutboundMessage(message, chatId, content, sentAfterSeconds) {
  const fromMe = message?.fromMe ?? message?.id?.fromMe ?? message?._data?.id?.fromMe;
  if (fromMe !== true || !getWhatsAppMessageId(message) || typeof content !== 'string') {
    return false;
  }

  const expectedChatId = normalizeChatId(chatId);
  const observedChatId = normalizeChatId(message?.to ?? message?._data?.to);
  if (expectedChatId && observedChatId && expectedChatId !== observedChatId) {
    const isGroupMismatch = expectedChatId.endsWith('@g.us') || observedChatId.endsWith('@g.us');
    const isStableUserMismatch = !expectedChatId.endsWith('@lid') && !observedChatId.endsWith('@lid');
    if (isGroupMismatch || isStableUserMismatch) return false;
  }

  const body = message?.body ?? message?._data?.body;
  if (normalizeMessageBody(body) !== normalizeMessageBody(content)) {
    return false;
  }

  const timestamp = Number(message?.timestamp ?? message?._data?.t);
  return !Number.isFinite(timestamp) || timestamp >= sentAfterSeconds;
}

async function runWithOutboundResultLock(client, task) {
  const previous = outboundResultLocks.get(client) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  outboundResultLocks.set(client, current);

  return current.finally(() => {
    if (outboundResultLocks.get(client) === current) {
      outboundResultLocks.delete(client);
    }
  });
}

async function sendMessageWithResultUnlocked(client, chatId, content, options) {
  const sentAfterSeconds = Math.floor(Date.now() / 1000) - 1;
  let observedMessage = null;
  let resolveObservedMessage;
  const observedMessagePromise = new Promise((resolve) => {
    resolveObservedMessage = resolve;
  });
  const onMessageCreate = (candidate) => {
    if (
      observedMessage
      || !isMatchingOutboundMessage(candidate, chatId, content, sentAfterSeconds)
    ) {
      return;
    }
    observedMessage = candidate;
    resolveObservedMessage(candidate);
  };

  client.on?.('message_create', onMessageCreate);
  try {
    let message = null;
    let sendError = null;
    try {
      message = await client.sendMessage(chatId, content, {
        ...options,
        waitUntilMsgSent: true,
      });
    } catch (error) {
      sendError = error;
    }

    let messageId = getWhatsAppMessageId(message);
    if (messageId) {
      return { message, messageId, source: 'send_result' };
    }

    if (!observedMessage && typeof client.on === 'function' && typeof content === 'string') {
      let timeoutId;
      try {
        observedMessage = await Promise.race([
          observedMessagePromise,
          new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(null), MESSAGE_CREATE_RECOVERY_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    messageId = getWhatsAppMessageId(observedMessage);
    if (messageId) {
      console.warn(
        `[delivery] ${sendError ? 'sendMessage fallo' : 'sendMessage no devolvio ID'}; `
        + 'resultado recuperado mediante message_create.'
      );
      return { message: observedMessage, messageId, source: 'message_create' };
    }

    if (sendError) throw sendError;

    const error = new Error('WhatsApp send completed without a recoverable message id');
    error.code = 'WHATSAPP_MISSING_MESSAGE_ID';
    throw error;
  } finally {
    client.off?.('message_create', onMessageCreate);
  }
}

async function getStoredMessageWithTimeout(client, messageId, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve(client.getMessageById?.(messageId)),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function inspectMessageServerAck(client, messageId, timeoutMs = 2_000) {
  const normalizedMessageId = getWhatsAppMessageId(messageId);
  if (!normalizedMessageId) return { state: 'missing', ack: null };

  try {
    const storedMessage = await getStoredMessageWithTimeout(client, normalizedMessageId, timeoutMs);
    if (!storedMessage) return { state: 'missing', ack: null };

    const ack = Number(storedMessage?.ack ?? storedMessage?._data?.ack);
    if (isServerAcknowledged(ack)) return { state: 'acknowledged', ack };
    if (Number.isFinite(ack) && ack < 0) return { state: 'rejected', ack };
    return { state: 'pending', ack: Number.isFinite(ack) ? ack : null };
  } catch {
    return { state: 'unknown', ack: null };
  }
}

export function decideTrackedDelivery(item, inspection, now = Date.now()) {
  if (!getWhatsAppMessageId(item?.delivery_message_id)) return 'send';
  if (inspection?.state === 'acknowledged') return 'mark_sent';
  if (inspection?.state === 'rejected') return 'retry';

  const startedAt = Date.parse(String(item?.delivery_started_at ?? ''));
  if (!Number.isFinite(startedAt) || now - startedAt < WHATSAPP_AMBIGUOUS_DELIVERY_HOLD_MS) {
    return 'hold';
  }

  return 'retry';
}

export function isNotificationDeliveryClaimAvailable(item, now = Date.now()) {
  if (getWhatsAppMessageId(item?.delivery_message_id)) return false;
  const startedAt = Date.parse(String(item?.delivery_started_at ?? ''));
  return !Number.isFinite(startedAt) || now - startedAt >= NOTIFICATION_CONTEXT_RETRY_DELAY_MS;
}

export async function waitForMessageServerAck(
  client,
  message,
  timeoutMs = WHATSAPP_DELIVERY_ACK_TIMEOUT_MS
) {
  const messageId = getWhatsAppMessageId(message);
  if (!messageId) {
    throw new Error('WhatsApp send returned no message id');
  }
  if (isServerAcknowledged(message?.ack ?? message?._data?.ack)) {
    return true;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      client.off?.('message_ack', onAck);
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(true);
    };
    const onAck = (ackMessage, ack) => {
      if (getWhatsAppMessageId(ackMessage) !== messageId) return;
      if (Number(ack) < 0) {
        finish(new Error('WhatsApp rejected the outbound message'));
      } else if (isServerAcknowledged(ack)) {
        finish();
      }
    };

    client.on?.('message_ack', onAck);
    timeoutId = setTimeout(async () => {
      try {
        const lookupTimeoutMs = Math.min(2_000, Math.max(1, timeoutMs));
        const inspection = await inspectMessageServerAck(client, messageId, lookupTimeoutMs);
        if (inspection.state === 'acknowledged') {
          finish();
          return;
        }
      } catch {
        // The timeout below is the actionable delivery result.
      }

      const error = new Error(`WhatsApp server ack timeout after ${timeoutMs}ms`);
      error.code = 'WHATSAPP_ACK_TIMEOUT';
      error.messageId = messageId;
      finish(error);
    }, timeoutMs);
  });
}

export async function sendMessageWithResult(client, chatId, content, options = {}) {
  if (!client || typeof client !== 'object' || typeof client.sendMessage !== 'function') {
    throw new TypeError('A WhatsApp client with sendMessage is required');
  }

  return runWithOutboundResultLock(
    client,
    () => sendMessageWithResultUnlocked(client, chatId, content, options)
  );
}

export async function sendMessageWithServerAck(
  client,
  chatId,
  content,
  options = {},
  timeoutMs = WHATSAPP_DELIVERY_ACK_TIMEOUT_MS
) {
  const { message } = await sendMessageWithResult(client, chatId, content, options);
  await waitForMessageServerAck(client, message, timeoutMs);
  return message;
}

export function isTransientWhatsappDeliveryError(error) {
  if (
    error?.code === 'WHATSAPP_ACK_TIMEOUT'
    || error?.code === 'WHATSAPP_MISSING_MESSAGE_ID'
    || error?.code === 'WHATSAPP_NOT_HEALTHY'
  ) {
    return true;
  }
  const message = String(error?.message ?? error).toLowerCase();
  return [
    'execution context was destroyed',
    'most likely because of a navigation',
    'target closed',
    'session closed',
    'protocol error',
    "cannot read properties of undefined (reading 'getchat')",
    'server ack timeout',
    'functional health',
  ].some((fragment) => message.includes(fragment));
}

export function isPermanentWhatsappRecipientError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return [
    'invalid whatsapp recipient',
    'number is not registered',
    'no lid for user',
    'wid error',
  ].some((fragment) => message.includes(fragment));
}
