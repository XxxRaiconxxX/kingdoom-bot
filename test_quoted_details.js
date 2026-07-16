import assert from 'node:assert/strict';
import 'dotenv/config';

const { safeGetQuotedDetails } = await import('./src/targetResolver.js');

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

console.log('QUOTED_DETAILS_OK');
