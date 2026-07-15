import { normalizePhone } from '../adminStore.js';
import { safeGetQuotedDetails } from '../targetResolver.js';
import {
  clearMarketForgeSession,
  getMarketForgeSession,
  setMarketForgeSession,
} from '../marketForgeStore.js';
import {
  confirmMarketForgeDraft,
  createMarketForgeDraft,
  reviseMarketForgeDraft,
} from '../marketForgeApi.js';

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/\S+/i);
  return match?.[0] || '';
}

function stripUrlFromText(text, url) {
  if (!url) return String(text || '').trim();
  return String(text || '').replace(url, '').replace(/\s+/g, ' ').trim();
}

function isImageMimeType(mime) {
  return String(mime || '').startsWith('image/');
}

async function extractQuotedReference(msg) {
  if (!msg.hasQuotedMsg) {
    return { url: '', imageDataUrl: '', quotedText: '' };
  }

  const quotedDetails = await safeGetQuotedDetails(msg);
  const quotedText = String(quotedDetails.body || '').trim();
  const quotedUrl = extractFirstUrl(quotedText);

  try {
    const quoted = await msg.getQuotedMessage();
    if (quoted && quoted.hasMedia) {
      const media = await quoted.downloadMedia().catch(() => null);
      if (media && isImageMimeType(media.mimetype)) {
        return {
          url: quotedUrl,
          imageDataUrl: `data:${media.mimetype};base64,${media.data}`,
          quotedText,
        };
      }
    }
  } catch (err) {
    console.warn('[marketForge] Error downloading quoted media:', err.message ?? err);
  }

  return { url: quotedUrl, imageDataUrl: '', quotedText };
}

async function extractReferenceFromMessage(msg) {
  const rawText = String(msg.body || msg.caption || '').trim();
  const ownUrl = extractFirstUrl(rawText);

  if (msg.hasMedia) {
    const media = await msg.downloadMedia().catch(() => null);
    if (media && isImageMimeType(media.mimetype)) {
      return {
        url: ownUrl,
        imageDataUrl: `data:${media.mimetype};base64,${media.data}`,
        sourceText: rawText,
      };
    }
  }

  const quoted = await extractQuotedReference(msg);
  return {
    url: ownUrl || quoted.url,
    imageDataUrl: quoted.imageDataUrl || '',
    sourceText: rawText || quoted.quotedText,
  };
}

function getIdeaPromptForDraft(text, command) {
  let working = String(text || '').trim();

  if (command === 'forjaritem') {
    working = working.replace(/^!forjaritem\b/i, '').trim();
  } else if (command === 'mercado') {
    working = working.replace(/^!mercado\b/i, '').trim();
    working = working.replace(/^crear\b/i, '').trim();
  }

  const url = extractFirstUrl(working);
  return stripUrlFromText(working, url);
}

function buildRole(context) {
  return context.isAdmin ? 'admin' : 'staff';
}

function formatForgeError(error) {
  const message = String(error?.message || '').trim();
  if (!message) {
    return 'No pude forjar el item en este momento. Intenta de nuevo en un momento.';
  }

  return `No pude forjar el item: ${message}`;
}

function extractCommand(text) {
  const normalized = String(text || '').trim();
  if (!normalized.startsWith('!')) {
    return { hasPrefix: false, command: '', body: normalized };
  }

  const withoutPrefix = normalized.slice(1).trim();
  const [command = '', ...rest] = withoutPrefix.split(/\s+/);
  return {
    hasPrefix: true,
    command: command.toLowerCase(),
    body: rest.join(' ').trim(),
  };
}

function shouldStartForge(command, body, isPrivileged) {
  if (!isPrivileged) return false;
  if (command === 'forjaritem') return true;
  if (command === 'mercado' && body.toLowerCase().startsWith('crear')) return true;
  return false;
}

function shouldContinueSession(text, session) {
  if (!session) return false;
  return Boolean(String(text || '').trim());
}

export async function handleMarketForgeConversation(msg, context) {
  const rawText = String(msg.body || '').trim();
  const { hasPrefix, command, body } = extractCommand(rawText);
  const session = getMarketForgeSession(msg.from, context.sender);

  if (shouldStartForge(command, body, context.isPrivileged)) {
    const ideaPrompt = getIdeaPromptForDraft(rawText, command);
    if (!ideaPrompt) {
      return 'Describe la idea del item junto al comando. Ejemplo: *!forjaritem alabarda maldita con filo de obsidiana https://pin.it/...*';
    }

    const reference = await extractReferenceFromMessage(msg);
    if (!reference.url && !reference.imageDataUrl) {
      return 'Necesito una referencia visual para forjar el item. Puedes pegar una URL tipo Pinterest o adjuntar una imagen junto al comando.';
    }

    try {
      const payload = await createMarketForgeDraft({
        ideaPrompt,
        reference,
        requestedBy: context.actorName,
        requestedByPhone: normalizePhone(context.sender),
        requestedByRole: buildRole(context),
        originalMessage: rawText,
        chatId: msg.from,
      });

      setMarketForgeSession(msg.from, context.sender, {
        draftId: payload.draftId,
        actorRole: payload?.actor?.role || buildRole(context),
      });

      return payload.replyText || 'Borrador forjado.';
    } catch (error) {
      return formatForgeError(error);
    }
  }

  const sessionText = hasPrefix && ['confirmar', 'cancelar'].includes(command)
    ? command
    : rawText;

  if (hasPrefix && !['confirmar', 'cancelar'].includes(command)) {
    return null;
  }

  if (!shouldContinueSession(sessionText, session) || !context.isPrivileged) {
    return null;
  }

  const normalizedText = sessionText.toLowerCase().trim();
  if (normalizedText === 'confirmar') {
    try {
      const payload = await confirmMarketForgeDraft({
        draftId: session.draftId,
        requestedBy: context.actorName,
        requestedByPhone: normalizePhone(context.sender),
        requestedByRole: session.actorRole,
        originalMessage: sessionText,
      });
      clearMarketForgeSession(msg.from, context.sender);
      return payload.replyText || 'Item publicado.';
    } catch (error) {
      return formatForgeError(error);
    }
  }

  try {
    const payload = await reviseMarketForgeDraft({
      draftId: session.draftId,
      revisionInstruction: sessionText,
      requestedBy: context.actorName,
      requestedByPhone: normalizePhone(context.sender),
      requestedByRole: session.actorRole,
      originalMessage: sessionText,
    });

    if (payload.status === 'cancelled') {
      clearMarketForgeSession(msg.from, context.sender);
    }

    return payload.replyText || 'Borrador ajustado.';
  } catch (error) {
    return formatForgeError(error);
  }
}
