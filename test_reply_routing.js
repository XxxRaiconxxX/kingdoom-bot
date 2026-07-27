import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.BOT_SUPABASE_URL ||= process.env.SUPABASE_URL;
process.env.BOT_SUPABASE_SERVICE_KEY ||= process.env.SUPABASE_SERVICE_KEY;

const {
  getWhatsAppMessageId,
  hasQuotedMessageMetadata,
} = await import('./src/whatsappDelivery.js');
const {
  extractTargetIdentifier,
  findActiveQuotedMessageKey,
  safeGetQuotedDetails,
} = await import('./src/targetResolver.js');
const {
  findBlackjackReplySessionKey,
  isBlackjackBoardText,
  isBlackjackReplyAction,
  sendTrackedBlackjackMessage,
} = await import('./src/handlers/blackjack.js');
const { resolveMediaMessage } = await import('./src/whatsappMedia.js');

assert.equal(
  getWhatsAppMessageId({ messageId: { $1: 'true_group@g.us_WRAPPED' } }),
  'true_group@g.us_WRAPPED'
);
assert.equal(hasQuotedMessageMetadata(null), false);
assert.equal(hasQuotedMessageMetadata({ hasQuotedMsg: false, _data: {} }), false);
assert.equal(hasQuotedMessageMetadata({
  hasQuotedMsg: false,
  _data: { quotedStanzaID: 'RAW-STANZA' },
}), true);
assert.equal(hasQuotedMessageMetadata({
  hasQuotedMsg: false,
  _originalMsg: { _data: { quotedMsg: { id: 'ORIGINAL-QUOTE' } } },
}), true);

const rawDetails = await safeGetQuotedDetails({
  hasQuotedMsg: false,
  _data: {
    quotedStanzaID: 'RAW-STANZA',
    quotedParticipant: '595981111222@c.us',
  },
});
assert.deepEqual(rawDetails, {
  hasQuoted: true,
  id: 'RAW-STANZA',
  author: '595981111222@c.us',
  body: null,
});
assert.deepEqual(await extractTargetIdentifier({
  hasQuotedMsg: false,
  _data: {
    quotedStanzaID: 'RAW-STANZA',
    quotedParticipant: '595981111222@c.us',
  },
}, ''), {
  identifier: '595981111222',
  source: 'quoted',
});

const embeddedDetails = await safeGetQuotedDetails({
  hasQuotedMsg: false,
  _data: {
    quotedMsg: {
      id: { id: 'EMBEDDED-STANZA' },
      author: '240797811245267@lid',
      body: '21 (Blackjack)',
    },
  },
});
assert.deepEqual(embeddedDetails, {
  hasQuoted: true,
  id: 'EMBEDDED-STANZA',
  author: '240797811245267@lid',
  body: '21 (Blackjack)',
});

const fetchedDetails = await safeGetQuotedDetails({
  hasQuotedMsg: true,
  async getQuotedMessage() {
    return {
      id: { _serialized: 'true_group@g.us_FETCHED' },
      from: '595983333444@c.us',
      body: 'mensaje citado',
    };
  },
});
assert.deepEqual(fetchedDetails, {
  hasQuoted: true,
  id: 'true_group@g.us_FETCHED',
  author: '595983333444@c.us',
  body: 'mensaje citado',
});

const activeQuoted = new Map([
  ['true_120363000000000000@g.us_STANZA-ONLY', { kind: 'blackjack' }],
  ['true_120363000000000000@g.us_OTHER', { kind: 'treasure' }],
]);
assert.equal(
  findActiveQuotedMessageKey(activeQuoted, 'STANZA-ONLY'),
  'true_120363000000000000@g.us_STANZA-ONLY'
);
assert.equal(
  findActiveQuotedMessageKey(activeQuoted, { id: { $1: 'true_120363000000000000@g.us_OTHER' } }),
  'true_120363000000000000@g.us_OTHER'
);
assert.equal(findActiveQuotedMessageKey(activeQuoted, 'MISSING'), null);

const soloSession = {
  isMultiplayer: false,
  chatId: 'group@g.us',
  playerPhone: '595981111222',
};
const pendingPvpSession = {
  isMultiplayer: true,
  state: 'pending',
  groupChatId: 'group@g.us',
  players: [{ playerPhone: '595983333444' }],
};
const playingPvpSession = {
  isMultiplayer: true,
  state: 'playing',
  groupChatId: 'group@g.us',
  players: [{ playerPhone: '595985555666' }],
};
const sessions = new Map([
  ['solo-id', soloSession],
  ['pending-pvp-id', pendingPvpSession],
  ['playing-pvp-id', playingPvpSession],
]);

assert.equal(isBlackjackReplyAction(' PEDIR '), true);
assert.equal(isBlackjackReplyAction('aceptar'), true);
assert.equal(isBlackjackReplyAction('reclamar'), false);
assert.equal(isBlackjackBoardText('21 (Blackjack PvP) - Reto'), true);
assert.equal(isBlackjackBoardText('Tesoro Errante del Reino'), false);
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'group@g.us',
  sender: '595981111222:9@c.us',
  action: 'pedir',
}), 'solo-id');
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'group@g.us',
  sender: '595983333444@c.us',
  action: 'aceptar',
}), 'pending-pvp-id');
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'group@g.us',
  sender: '595985555666@c.us',
  action: 'plantarse',
}), 'playing-pvp-id');
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'other@g.us',
  sender: '595981111222@c.us',
  action: 'pedir',
}), null);
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'group@g.us',
  sender: '595980000000@c.us',
  action: 'pedir',
}), null);
assert.equal(findBlackjackReplySessionKey(sessions, {
  chatId: 'group@g.us',
  sender: '595983333444@c.us',
  action: 'pedir',
}), null);

const ambiguousSessions = new Map([
  ['first', soloSession],
  ['second', { ...soloSession }],
]);
assert.equal(findBlackjackReplySessionKey(ambiguousSessions, {
  chatId: 'group@g.us',
  sender: '595981111222@c.us',
  action: 'pedir',
}), null);

const mediaFromRawQuote = await resolveMediaMessage({
  hasQuotedMsg: false,
  _data: {
    quotedMsg: {
      id: { id: 'MEDIA-STANZA' },
      type: 'image',
      mimetype: 'image/png',
      directPath: '/media/path',
      body: 'referencia',
    },
  },
});
assert.equal(mediaFromRawQuote.id, 'MEDIA-STANZA');
assert.equal(mediaFromRawQuote.hasMedia, true);

class MessageCreateClient extends EventEmitter {
  async sendMessage(chatId, content) {
    queueMicrotask(() => {
      this.emit('message_create', {
        fromMe: true,
        id: { _serialized: 'true_group@g.us_RECOVERED' },
        to: chatId,
        body: content,
        timestamp: Math.floor(Date.now() / 1000),
      });
    });
    return undefined;
  }
}

const trackedClient = new MessageCreateClient();
assert.equal(
  await sendTrackedBlackjackMessage(trackedClient, 'group@g.us', 'tablero interactivo'),
  'true_group@g.us_RECOVERED'
);
assert.equal(trackedClient.listenerCount('message_create'), 0);

console.log('REPLY_ROUTING_OK');
