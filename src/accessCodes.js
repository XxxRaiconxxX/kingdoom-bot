import { supabase } from './supabase.js';
import { createAccessCode, hashAccessCode } from './accessCodeUtils.js';

const CODE_TTL_MS = 10 * 60 * 1000;

export async function issuePlayerAccessCode(playerId) {
  const code = createAccessCode();
  const { error } = await supabase.from('player_access_codes').insert({
    player_id: playerId,
    code_hash: hashAccessCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  if (error) {
    throw new Error(`No se pudo guardar el codigo de acceso: ${error.message}`);
  }

  return { code, expiresAt: new Date(Date.now() + CODE_TTL_MS) };
}
