import { supabase } from '../supabase.js';
import { waitForMessageServerAck } from '../whatsappDelivery.js';
import { heraldCard, heraldCommand, heraldSection, heraldStat } from '../formatting.js';

const MAX_COMPLETION_ANNOUNCEMENTS = 1000;
const REALTIME_HEALTH_WAIT_MS = 10 * 60 * 1000;
const claimedCompletionAnnouncements = new Set();

export function claimCompletedAuctionAnnouncement(oldAuction, newAuction) {
  const auctionId = String(newAuction?.id ?? '').trim();
  if (!auctionId || newAuction?.status !== 'completed' || oldAuction?.status === 'completed') {
    return false;
  }

  if (claimedCompletionAnnouncements.has(auctionId)) {
    return false;
  }

  claimedCompletionAnnouncements.add(auctionId);
  if (claimedCompletionAnnouncements.size > MAX_COMPLETION_ANNOUNCEMENTS) {
    claimedCompletionAnnouncements.delete(claimedCompletionAnnouncements.values().next().value);
  }
  return true;
}

export function releaseCompletedAuctionAnnouncement(auctionId) {
  claimedCompletionAnnouncements.delete(String(auctionId ?? '').trim());
}

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

async function sendRealtimeAnnouncement(client, isClientReady, chatId, message) {
  const deadline = Date.now() + REALTIME_HEALTH_WAIT_MS;
  while (!isClientReady() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (!isClientReady()) {
    const error = new Error('WhatsApp functional health is not ready for realtime delivery');
    error.code = 'WHATSAPP_NOT_HEALTHY';
    throw error;
  }

  const sentMessage = await client.sendMessage(chatId, message);
  await waitForMessageServerAck(client, sentMessage);
}

export function startAuctionsRealtime(client, isClientReady = () => Boolean(client?.info)) {
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
          console.log('[Realtime] Nueva subasta recibida.');
          const chatId = newAuction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          const msg = heraldCard('Nueva subasta en el Reino', [
            `> _Se abrio la contienda por *${newAuction.item_name}* · ${newAuction.item_rarity.toUpperCase()}._`,
            newAuction.item_description ? `> _${newAuction.item_description}_` : '',
            heraldStat('Precio inicial', `🪙 ${newAuction.start_price.toLocaleString('es-PY')} oro`),
            heraldStat('Incremento minimo', `🪙 ${newAuction.min_increment.toLocaleString('es-PY')} oro`),
            heraldStat('Expira en', formatTimeRemaining(newAuction.expires_at)),
            heraldCommand('!subastas', 'Consulta todos los detalles.'),
            heraldCommand('!pujar <item> <monto>', 'Entra en la contienda.'),
          ].filter(Boolean), { icon: '📢' });

          await sendRealtimeAnnouncement(client, isClientReady, chatId, msg);
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
          console.log('[Realtime] Nueva puja recibida.');

          const [{ data: bidder }, { data: auction }] = await Promise.all([
            supabase.from('players').select('username').eq('id', newBid.player_id).single(),
            supabase
              .from('market_auctions')
              .select('item_name, item_rarity, whatsapp_chat_id')
              .eq('id', newBid.auction_id)
              .single(),
          ]);

          if (!bidder || !auction) return;

          const chatId = auction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          const msg = heraldCard('Nueva puja registrada', [
            `> _*${bidder.username}* entro en la contienda por *${auction.item_name}* · ${auction.item_rarity.toUpperCase()}._`,
            heraldStat('Puja acumulada', `🪙 ${newBid.amount.toLocaleString('es-PY')} oro`),
            heraldStat('Lider actual', bidder.username),
            heraldSection('Reglas de subasta'),
            '- El oro queda bloqueado mientras lideras y se devuelve si superan tu oferta.',
            '- La comision unica del 25% del valor base no es reembolsable.',
            '_El fuego de la subasta sigue ardiendo. ¿Quien se atrevera a superarlo?_',
          ], { icon: '⚖️' });

          await sendRealtimeAnnouncement(client, isClientReady, chatId, msg);
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
        const oldAuction = payload.old;
        const newAuction = payload.new;
        if (!claimCompletedAuctionAnnouncement(oldAuction, newAuction)) return;

        try {
          console.log('[Realtime] Subasta completada recibida.');

          let winnerName = 'Nadie';
          if (newAuction.highest_bidder_id) {
            const { data: winner } = await supabase.from('players').select('username').eq('id', newAuction.highest_bidder_id).single();
            if (winner) winnerName = winner.username;
          }

          const chatId = newAuction.whatsapp_chat_id || '595971938097-1618930274@g.us';
          const lines = [`> _La subasta de *${newAuction.item_name}* ha concluido._`];

          if (newAuction.highest_bidder_id) {
            lines.push(
              heraldStat('Ganador', `*${winnerName}*`),
              heraldStat('Oferta final', `🪙 ${newAuction.highest_bid.toLocaleString('es-PY')} oro`),
              '_El articulo fue entregado al inventario del vencedor._'
            );
          } else {
            lines.push('💨 La subasta termino sin pujadores. El articulo vuelve a las sombras del reino.');
          }

          const msg = heraldCard('Subasta finalizada', lines, { icon: '🏆' });
          await sendRealtimeAnnouncement(client, isClientReady, chatId, msg);
        } catch (err) {
          releaseCompletedAuctionAnnouncement(newAuction?.id);
          console.error('[Realtime resolve] Error:', err);
        }
      }
    )
    .subscribe();

  console.log('📡 Realtime listeners for auctions started.');
  return channel;
}
