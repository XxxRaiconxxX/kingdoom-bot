import assert from 'node:assert/strict';
import 'dotenv/config';

const { findActiveQuotedMessageKey, safeGetQuotedDetails } = await import('./src/targetResolver.js');

let fallbackCalls = 0;
const staleQuote = {
  hasQuotedMsg: true,
  _data: {
    quotedMsg: { id: { _serialized: 'quoted-id' }, body: 'texto' },
  },
  getQuotedMessage: async () => {
    fallbackCalls += 1;
    throw new Error('r');
  },
};

const first = await safeGetQuotedDetails(staleQuote);
const second = await safeGetQuotedDetails(staleQuote);
assert.equal(first.hasQuoted, true);
assert.equal(first.id, 'quoted-id');
assert.equal(second.id, 'quoted-id');
assert.equal(fallbackCalls, 1, 'A stale quote fallback must run at most once per message.');

const phantomQuote = await safeGetQuotedDetails({
  hasQuotedMsg: true,
  _data: {},
  getQuotedMessage: async () => {
    throw new Error('r');
  },
});
assert.equal(phantomQuote.hasQuoted, false);

const objectQuote = await safeGetQuotedDetails({
  hasQuotedMsg: true,
  _data: {
    quotedMsg: {
      id: {
        fromMe: true,
        remote: '595971938097-1618930274@g.us',
        id: '3EB0OBJECT123',
      },
      author: '595981123456@c.us',
      body: 'Tesoro Errante del Reino',
    },
  },
});
assert.equal(objectQuote.id, '3EB0OBJECT123');

const serializedId = 'true_595971938097-1618930274@g.us_3EB0ABC123_240797811245267@lid';
const activeMessages = new Map([[serializedId, { active: true }]]);
assert.equal(findActiveQuotedMessageKey(activeMessages, serializedId), serializedId);
assert.equal(findActiveQuotedMessageKey(activeMessages, '3EB0ABC123'), serializedId);
assert.equal(
  findActiveQuotedMessageKey(activeMessages, {
    fromMe: true,
    remote: '595971938097-1618930274@g.us',
    id: '3EB0ABC123',
  }),
  serializedId
);
assert.equal(findActiveQuotedMessageKey(activeMessages, { $1: '3EB0ABC123' }), serializedId);
assert.equal(findActiveQuotedMessageKey(activeMessages, '3EB0OTHER'), null);

console.log('QUOTED_DETAILS_OK');
