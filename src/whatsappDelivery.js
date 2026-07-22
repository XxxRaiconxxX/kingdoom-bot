export const NOTIFICATION_CONTEXT_RETRY_DELAY_MS = 5 * 60 * 1000;
const configuredAckTimeoutMs = Number.parseInt(
  process.env.WHATSAPP_DELIVERY_ACK_TIMEOUT_MS ?? '20000',
  10
);
export const WHATSAPP_DELIVERY_ACK_TIMEOUT_MS = Math.max(
  5_000,
  Number.isFinite(configuredAckTimeoutMs) ? configuredAckTimeoutMs : 20_000
);

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
      candidate.id,
      candidate.messageId,
      candidate.stanzaId,
      candidate.quotedStanzaID,
      candidate.key?.id,
      candidate._data?.id,
    ];

    for (const nested of nestedCandidates) {
      const messageId = visit(nested);
      if (messageId) return messageId;
    }

    return '';
  };

  return visit(value);
}

function isServerAcknowledged(ack) {
  return Number(ack) >= 1;
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
        const storedMessage = await getStoredMessageWithTimeout(client, messageId, lookupTimeoutMs);
        if (isServerAcknowledged(storedMessage?.ack ?? storedMessage?._data?.ack)) {
          finish();
          return;
        }
      } catch {
        // The timeout below is the actionable delivery result.
      }

      const error = new Error(`WhatsApp server ack timeout after ${timeoutMs}ms`);
      error.code = 'WHATSAPP_ACK_TIMEOUT';
      finish(error);
    }, timeoutMs);
  });
}

export async function sendMessageWithResult(client, chatId, content, options = {}) {
  const message = await client.sendMessage(chatId, content, {
    ...options,
    waitUntilMsgSent: true,
  });
  const messageId = getWhatsAppMessageId(message);
  if (!messageId) {
    const error = new Error('WhatsApp send completed without a recoverable message id');
    error.code = 'WHATSAPP_MISSING_MESSAGE_ID';
    throw error;
  }

  return { message, messageId };
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
