import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRoleplayLockUpdate,
  evaluateRoleplayActivityMessage,
} from './src/roleplayActivity.js';
import {
  clearWhatsAppIdentityCache,
  resolveMessageSenderIdentity,
} from './src/whatsappIdentity.js';

const roleplayGroupId = '120363410116763398@g.us';

assert.deepEqual(
  evaluateRoleplayActivityMessage({
    from: roleplayGroupId,
    body: 'Pues si tiene sangre, pero primero debemos inmovilizar a la criatura.',
  }, roleplayGroupId),
  {
    eligible: true,
    inRoleplayGroup: true,
    reason: 'accepted',
    groupJid: roleplayGroupId,
    text: 'Pues si tiene sangre, pero primero debemos inmovilizar a la criatura.',
  }
);

assert.equal(
  evaluateRoleplayActivityMessage({
    from: roleplayGroupId,
    caption: 'Desenvaino la espada y avanzo con cautela hacia la entrada.',
    hasMedia: true,
  }, roleplayGroupId).eligible,
  true,
  'Una imagen o video con texto narrativo significativo debe contar como roleo.'
);
assert.equal(
  evaluateRoleplayActivityMessage({ from: roleplayGroupId, body: '!cofre' }, roleplayGroupId).reason,
  'command'
);
assert.equal(
  evaluateRoleplayActivityMessage({ from: roleplayGroupId, body: 'Sí' }, roleplayGroupId).reason,
  'low_effort'
);
assert.equal(
  evaluateRoleplayActivityMessage({
    id: { remote: roleplayGroupId },
    body: 'La guardia observa las huellas y prepara una emboscada silenciosa.',
  }, roleplayGroupId).eligible,
  true,
  'El JID remoto del mensaje cubre eventos message_create sin from hidratado.'
);
assert.equal(
  evaluateRoleplayActivityMessage({
    from: '120363000000000000@g.us',
    body: 'Este texto no pertenece al grupo configurado.',
  }, roleplayGroupId).reason,
  'wrong_group'
);

clearWhatsAppIdentityCache();
const identity = await resolveMessageSenderIdentity({
  author: '240797811245267@lid',
}, {
  async getContactLidAndPhone(ids) {
    assert.deepEqual(ids, ['240797811245267@lid']);
    return [{ lid: ids[0], pn: '595981111222@c.us' }];
  },
});
assert.equal(identity.primary, '595981111222');
assert.deepEqual(identity.aliases, ['595981111222', '240797811245267']);

assert.deepEqual(
  buildRoleplayLockUpdate({
    locked_at: '2026-08-18T12:00:00.000Z',
    lock_reason: 'roleplay_inactive',
  }),
  { locked_at: null, lock_reason: null, automaticLockCleared: true }
);
assert.deepEqual(
  buildRoleplayLockUpdate({
    locked_at: '2026-08-18T12:00:00.000Z',
    lock_reason: 'moderation_review',
  }),
  {
    locked_at: '2026-08-18T12:00:00.000Z',
    lock_reason: 'moderation_review',
    automaticLockCleared: false,
  },
  'La actividad no debe borrar un bloqueo manual.'
);

const rpcSql = readFileSync(
  new URL('./supabase/supabase_roleplay_activity_rpc.sql', import.meta.url),
  'utf8'
);
assert.match(rpcSql, /create or replace function public\.record_roleplay_activity/i);
assert.match(rpcSql, /else access\.locked_at/i);
assert.match(rpcSql, /'roleplay_detected'/i);
assert.match(rpcSql, /grant execute[\s\S]*to service_role/i);

console.log('ROLEPLAY_ACTIVITY_OK');
