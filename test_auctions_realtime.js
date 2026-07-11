import assert from 'node:assert/strict';
import 'dotenv/config';

const {
  claimCompletedAuctionAnnouncement,
  releaseCompletedAuctionAnnouncement,
} = await import('./src/handlers/auctionsRealtime.js');

const auctionId = `audit-${Date.now()}`;

assert.equal(
  claimCompletedAuctionAnnouncement({ status: 'active' }, { id: auctionId, status: 'active' }),
  false,
  'An active auction must not be announced as completed.'
);
assert.equal(
  claimCompletedAuctionAnnouncement({ status: 'active' }, { id: auctionId, status: 'completed' }),
  true,
  'The first completion transition must be announced.'
);
assert.equal(
  claimCompletedAuctionAnnouncement({}, { id: auctionId, status: 'completed' }),
  false,
  'A duplicate completion event must be suppressed.'
);

releaseCompletedAuctionAnnouncement(auctionId);
assert.equal(
  claimCompletedAuctionAnnouncement({}, { id: auctionId, status: 'completed' }),
  true,
  'A failed delivery must be claimable again after release.'
);
assert.equal(
  claimCompletedAuctionAnnouncement(
    { status: 'completed' },
    { id: `${auctionId}-old`, status: 'completed' }
  ),
  false,
  'An update that was already completed must not be announced.'
);

releaseCompletedAuctionAnnouncement(auctionId);
console.log('AUCTIONS_REALTIME_DEDUPE_OK');
