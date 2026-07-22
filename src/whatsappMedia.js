import { serializeWhatsAppId } from './whatsappIdentity.js';

const DEFAULT_RETRY_DELAY_MS = 600;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRawQuotedData(msg) {
  return msg?._data?.quotedMsg
    || msg?._originalMsg?._data?.quotedMsg
    || msg?._data?.quotedSticker
    || null;
}

function buildSyntheticQuotedMessage(rawQuoted) {
  if (!rawQuoted) return null;

  return {
    id: serializeWhatsAppId(rawQuoted.id),
    hasMedia: Boolean(
      rawQuoted.isMedia
      || ['document', 'image', 'video', 'audio', 'sticker'].includes(rawQuoted.type)
      || rawQuoted.directPath
      || rawQuoted.mimetype
    ),
    body: rawQuoted.body || rawQuoted.caption || '',
    type: rawQuoted.type,
    mimetype: rawQuoted.mimetype,
    filename: rawQuoted.filename || '',
    _data: rawQuoted,
  };
}

export async function resolveMediaMessage(msg, client = msg?.client) {
  if (msg?.hasMedia) return msg;
  if (!msg?.hasQuotedMsg) return null;

  if (typeof msg.getQuotedMessage === 'function') {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted) return quoted;
    } catch {
      // Stale quote caches are expected; the ID and raw metadata fallbacks cover them.
    }
  }

  const rawQuoted = getRawQuotedData(msg);
  const quotedId = serializeWhatsAppId(rawQuoted?.id)
    || String(msg?._data?.quotedStanzaID || '').trim();
  if (quotedId && client && typeof client.getMessageById === 'function') {
    try {
      const quoted = await client.getMessageById(quotedId);
      if (quoted) return quoted;
    } catch {
      // Some current WhatsApp Web builds throw "r" for stale quoted messages.
    }
  }

  return buildSyntheticQuotedMessage(rawQuoted);
}

async function downloadFromRawMetadata(targetMsg, client) {
  const metadata = targetMsg?._data;
  const pupPage = client?.pupPage || targetMsg?.client?.pupPage;
  if (!metadata?.directPath || !metadata?.mediaKey || !pupPage) return null;

  // ponytail: this fallback uses a WhatsApp Web internal only when no native Message exists.
  return pupPage.evaluate(async (mediaMeta) => {
    try {
      const manager = window.require('WAWebDownloadManager')?.downloadManager;
      const download = manager?.downloadAndMaybeDecrypt;
      if (typeof download !== 'function') return null;

      const mockQpl = {
        addAnnotations() { return this; },
        addPoint() { return this; },
      };
      const decrypted = await download.call(manager, {
        directPath: mediaMeta.directPath,
        encFilehash: mediaMeta.encFilehash,
        filehash: mediaMeta.filehash,
        mediaKey: mediaMeta.mediaKey,
        mediaKeyTimestamp: mediaMeta.mediaKeyTimestamp,
        type: mediaMeta.type || 'document',
        signal: new AbortController().signal,
        downloadQpl: mockQpl,
      });
      if (!decrypted) return null;

      return {
        data: await window.WWebJS.arrayBufferToBase64Async(decrypted),
        mimetype: mediaMeta.mimetype || 'application/octet-stream',
        filename: mediaMeta.filename || '',
        filesize: mediaMeta.size || null,
      };
    } catch {
      return null;
    }
  }, {
    directPath: metadata.directPath,
    encFilehash: metadata.encFilehash,
    filehash: metadata.filehash,
    mediaKey: metadata.mediaKey,
    mediaKeyTimestamp: metadata.mediaKeyTimestamp,
    type: metadata.type,
    mimetype: metadata.mimetype,
    filename: metadata.filename,
    size: metadata.size,
  });
}

export async function downloadMessageMedia(targetMsg, client = targetMsg?.client, options = {}) {
  if (!targetMsg?.hasMedia) return null;

  const attempts = Math.max(1, Number(options.attempts) || 2);
  const requestedRetryDelay = Number(options.retryDelayMs);
  const retryDelayMs = Number.isFinite(requestedRetryDelay)
    ? Math.max(0, requestedRetryDelay)
    : DEFAULT_RETRY_DELAY_MS;

  if (typeof targetMsg.downloadMedia === 'function') {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const media = await targetMsg.downloadMedia();
        if (media?.data) return media;
      } catch (error) {
        console.warn(
          `[whatsappMedia] Descarga nativa no disponible (intento ${attempt}/${attempts}):`,
          error?.message ?? error
        );
      }

      if (attempt < attempts) {
        if (typeof targetMsg.reload === 'function') {
          try {
            await targetMsg.reload();
          } catch {
            // The message can already be outside the WhatsApp Web cache.
          }
        }
        await wait(retryDelayMs);
      }
    }
  }

  return downloadFromRawMetadata(targetMsg, client);
}

export async function resolveAndDownloadMedia(msg, client = msg?.client, options = {}) {
  const targetMsg = await resolveMediaMessage(msg, client);
  const media = targetMsg?.hasMedia
    ? await downloadMessageMedia(targetMsg, client, options)
    : null;
  return { targetMsg, media };
}
