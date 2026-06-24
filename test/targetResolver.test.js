import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMentionedPhone } from '../src/targetResolver.js';

test('getMentionedPhone', async (t) => {
  await t.test('returns empty string if msg is undefined', () => {
    assert.equal(getMentionedPhone(undefined), '');
  });

  await t.test('returns empty string if msg is null', () => {
    assert.equal(getMentionedPhone(null), '');
  });

  await t.test('returns empty string if msg is empty object', () => {
    assert.equal(getMentionedPhone({}), '');
  });

  await t.test('returns empty string if msg.mentionedIds is empty array', () => {
    assert.equal(getMentionedPhone({ mentionedIds: [] }), '');
  });

  await t.test('returns empty string if msg.mentionedIds is not an array', () => {
    assert.equal(getMentionedPhone({ mentionedIds: 'not_an_array' }), '');
  });

  await t.test('extracts valid phone number from mentionedIds', () => {
    assert.equal(getMentionedPhone({ mentionedIds: ['595987273405@c.us'] }), '595987273405');
  });

  await t.test('extracts first valid phone number if multiple exist', () => {
    assert.equal(getMentionedPhone({ mentionedIds: ['595987273405@c.us', 'another@c.us'] }), '595987273405');
  });

  await t.test('normalizes Mexican number', () => {
    assert.equal(getMentionedPhone({ mentionedIds: ['526645891712@c.us'] }), '5216645891712');
  });

  await t.test('strips non-digit characters and suffix', () => {
    assert.equal(getMentionedPhone({ mentionedIds: ['+1234567890@c.us'] }), '1234567890');
  });
});
