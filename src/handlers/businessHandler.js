import {
  getPlayerBusinesses,
  collectPlayerBusinessesGold,
  getPlayer
} from '../supabase.js';
import { heraldCard, heraldStat } from '../formatting.js';

// Command !negocios / !misnegocios / !negocio
export async function handleNegocios(msg, player) {
  const businesses = await getPlayerBusinesses(player.id);

  if (!businesses || businesses.length === 0) {
    return heraldCard(`Negocios de ${player.username}`, [
      ' Aún no tienes negocios ni propiedades activas en el reino.',
      ' Revisa las propuestas del staff en la web para abrir tu primer negocio.'
    ], { icon: '🏪' });
  }

  let totalCollectible = 0;
  const lines = businesses.map(b => {
    totalCollectible += b.stored_gold;
    const statusStr = b.capped ? '🔴 *[Lleno - Tope alcanzado]*' : '🟢 *[Generando]*';
    const icon = b.icon || '🏪';
    return `${icon} *${b.name}* (${b.business_type})\n` +
      `  ├ Producción: 🪙 ${b.gold_per_hour.toLocaleString('es-PY')}/h\n` +
      `  ├ Acumulado: 🪙 *${b.stored_gold.toLocaleString('es-PY')}* / ${b.max_storage.toLocaleString('es-PY')} oro\n` +
      `  └ Estado: ${statusStr}`;
  });

  lines.push('\n──────────────');
  lines.push(`💰 Total listo para recolectar: *🪙 ${totalCollectible.toLocaleString('es-PY')} oro*`);
  lines.push('\n💡 _Escribe `!cobrar` o `!recolectar` para retirar las ganancias a tu bolsa._');

  return heraldCard(`Negocios de ${player.username}`, lines, { icon: '🏪' });
}

// Command !cobrar / !recolectar / !recolectarnegocios / !cobrarnegocio
export async function handleCobrarNegocios(msg, player, body) {
  const result = await collectPlayerBusinessesGold(player.id);

  if (!result.success) {
    return `❌ ${result.message}`;
  }

  const freshPlayer = await getPlayer(player.id);
  const newGoldStr = freshPlayer ? freshPlayer.gold.toLocaleString('es-PY') : (result.newBalance ? result.newBalance.toLocaleString('es-PY') : '-');

  return heraldCard('Recolección de Negocios', [
    heraldStat('Oro Recolectado', `🪙 *+${result.totalCollected.toLocaleString('es-PY')} oro*`),
    heraldStat('Nuevo Saldo', `🪙 *${newGoldStr} oro*`),
    ' El oro ha sido transferido directamente a tu bolsa real.'
  ], { icon: '💰' });
}
