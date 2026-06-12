import { supabase } from '../supabase.js';

function formatTimeRemaining(expiresAt) {
  const diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return 'Expirado';
  const totalSecs = Math.floor(diffMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const totalHours = Math.floor(totalMins / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (days === 0 && hours === 0 && mins === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

export function startAuctionsRealtime(client) {
  const channel = supabase
    .channel('auctions_realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'market_auctions',
      },
      async (payload) => {
        try {
          const newAuction = payload.new;
          console.log('[Realtime] Nueva subasta creada:', newAuction);
          const chatId = newAuction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          const msg = `📢 *NUEVA SUBASTA EN EL REINO* ⚖️\n\n` +
                      `Se ha abierto la puja por *${newAuction.item_name}* [${newAuction.item_rarity.toUpperCase()}]\n` +
                      (newAuction.item_description ? `📜 _${newAuction.item_description}_\n` : '') +
                      `💰 Precio Inicial: *🪙 ${newAuction.start_price.toLocaleString('es-PY')} oro*\n` +
                      `⚙️ Incremento Minimo: *🪙 ${newAuction.min_increment.toLocaleString('es-PY')} oro*\n` +
                      `⏱️ Duracion: Expira en ${formatTimeRemaining(newAuction.expires_at)}\n\n` +
                      `👉 Escribe \`!subastas\` para ver los detalles, o \`!pujar <nombre / numero> <monto>\` para participar.`;

          await client.sendMessage(chatId, msg);
        } catch (err) {
          console.error('[Realtime auctions] Error:', err);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'market_auction_bids',
      },
      async (payload) => {
        try {
          const newBid = payload.new;
          console.log('[Realtime] Nueva puja:', newBid);

          // Fetch bidder username and auction details
          const { data: bidder } = await supabase.from('players').select('username').eq('id', newBid.player_id).single();
          const { data: auction } = await supabase.from('market_auctions').select('*').eq('id', newBid.auction_id).single();

          if (!bidder || !auction) return;

          const chatId = auction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          const msg = `╔════════════════════════════╗\n` +
                      `⚖️  *NUEVA PUJA REGISTRADA*  ⚖️\n` +
                      `╚════════════════════════════╝\n\n` +
                      `El osado aventurero *${bidder.username}* ha entrado a la contienda por:\n` +
                      `📦 *${auction.item_name}* [${auction.item_rarity.toUpperCase()}]\n\n` +
                      `💰 *Puja Acumulada:* 🪙 ${newBid.amount.toLocaleString('es-PY')} oro\n` +
                      `👑 *Líder Actual:* ${bidder.username}\n\n` +
                      `────────────────────────\n` +
                      `⚠️ *REGLA DE CONTIENDA (FONDO PERDIDO):*\n` +
                      `Cada puja descuenta el oro *inmediatamente y de forma permanente*. Si eres superado, el oro *no se devuelve*. ¡Sube la oferta con sabiduría!\n` +
                      `────────────────────────\n\n` +
                      `_¡El fuego de la subasta sigue ardiendo! ¿Quién se atreverá a superarlo?_`;

          await client.sendMessage(chatId, msg);
        } catch (err) {
          console.error('[Realtime bids] Error:', err);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'market_auctions',
      },
      async (payload) => {
        try {
          const oldAuction = payload.old;
          const newAuction = payload.new;

          // Only announce if status just changed to completed
          if (newAuction.status !== 'completed' || (oldAuction && oldAuction.status === 'completed')) return;

          console.log('[Realtime] Subasta completada:', newAuction);

          let winnerName = 'Nadie';
          if (newAuction.highest_bidder_id) {
            const { data: winner } = await supabase.from('players').select('username').eq('id', newAuction.highest_bidder_id).single();
            if (winner) winnerName = winner.username;
          }

          const chatId = newAuction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          let msg = `🏆 *SUBASTA FINALIZADA* ⚖️\n\n` +
                    `La subasta de *${newAuction.item_name}* ha concluido.\n`;

          if (newAuction.highest_bidder_id) {
            msg += `👑 Ganador: *${winnerName}*\n` +
                   `💰 Oferta Final: *🪙 ${newAuction.highest_bid.toLocaleString('es-PY')} oro*\n\n` +
                   `_El item ha sido entregado en el inventario del vencedor. ¡Felicidades!_`;
          } else {
            msg += `💨 La subasta termino sin pujadores. El articulo vuelve a las sombras del reino.`;
          }

          await client.sendMessage(chatId, msg);
        } catch (err) {
          console.error('[Realtime resolve] Error:', err);
        }
      }
    )
    .subscribe();

  console.log('📡 Realtime listeners for auctions started.');
  return channel;
}
