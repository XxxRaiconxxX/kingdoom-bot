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

export async function handleSubastas(msg, player, body) {
  const { data: auctions, error } = await supabase
    .from('market_auctions')
    .select(`
      *,
      highest_bidder:players!highest_bidder_id(username)
    `)
    .eq('status', 'active')
    .order('expires_at', { ascending: true });

  if (error) {
    console.error('[handleSubastas] Error fetching auctions:', error.message);
    return '❌ Hubo un error al leer las subastas del reino.';
  }

  if (!auctions || auctions.length === 0) {
    return '🔔 *No hay subastas activas en el reino en este momento.*';
  }

  let response = `╔════════════════════════════╗\n`;
  response += `⚖️  *SUBASTAS DEL REINO*  ⚖️\n`;
  response += `╚════════════════════════════╝\n`;
  response += `_El mercado negro esta en ebullicion. ¡Pujan oro a fondo perdido!_\n\n`;

  auctions.forEach((auc, index) => {
    const timeRemaining = formatTimeRemaining(auc.expires_at);
    const highestBidStr = auc.highest_bid > 0
      ? `🪙 ${auc.highest_bid.toLocaleString('es-PY')} oro (${auc.highest_bidder?.username || 'Desconocido'})`
      : `🪙 0 oro (Sin pujas)`;

    response += `*${index + 1}. ${auc.item_name}* [${auc.item_rarity.toUpperCase()}]\n`;
    if (auc.item_description) {
      response += `📜 _${auc.item_description}_\n`;
    }
    response += `💰 Precio Inicial: 🪙 ${auc.start_price.toLocaleString('es-PY')} oro\n`;
    response += `💰 Puja Acumulada: ${highestBidStr}\n`;
    response += `⏱️ Expira en: ${timeRemaining}\n`;
    response += `⚙️ Pujar con: \`!pujar ${index + 1} <monto>\`\n`;
    response += `────────────────────────\n`;
  });

  response += `⚠️ _Recuerda: El oro de tu puja se bloquea mientras seas el líder. Si eres superado, se te **reembolsará** de inmediato. Se cobra una única **comisión del 25% del precio base del ítem** al realizar tu primera puja (no reembolsable)._`;
  return response;
}

export async function handlePujar(msg, player, body) {
  const parts = String(body ?? '').trim().split(/\s+/);
  if (parts.length < 2) {
    return `❌ *Uso correcto:* \`!pujar <nombre_item / #lista> <monto_de_oro>\``;
  }

  const amountStr = parts[parts.length - 1];
  const amount = parseInt(amountStr.replace(/\./g, ''), 10);
  if (isNaN(amount) || amount <= 0) {
    return `❌ El monto de oro "${amountStr}" no es valido.`;
  }

  const identifier = parts.slice(0, -1).join(' ').trim();
  if (!identifier) {
    return `❌ Debes especificar que item deseas pujar.`;
  }

  // Fetch active auctions to match identifier
  const { data: auctions, error } = await supabase
    .from('market_auctions')
    .select('*')
    .eq('status', 'active')
    .order('expires_at', { ascending: true });

  if (error || !auctions) {
    console.error('[handlePujar] Error fetching active auctions:', error?.message);
    return '❌ No pude consultar las subastas en este momento.';
  }

  let targetAuction = null;
  const listNum = parseInt(identifier, 10);

  if (!isNaN(listNum) && listNum >= 1 && listNum <= auctions.length) {
    targetAuction = auctions[listNum - 1];
  } else {
    // Try UUID match
    targetAuction = auctions.find(a => a.id === identifier);
    if (!targetAuction) {
      // Try name match
      targetAuction = auctions.find(a => a.item_name.toLowerCase().includes(identifier.toLowerCase()));
    }
  }

  if (!targetAuction) {
    return `❌ No se encontro ninguna subasta activa que coincida con "${identifier}".`;
  }

  const currentPrice = targetAuction.highest_bid > 0 ? targetAuction.highest_bid : targetAuction.start_price;
  let targetAmount = amount;
  
  // If the user input amount is smaller than the current price (or base price),
  // treat it as an increment on top of the current price.
  if (amount < currentPrice) {
    targetAmount = currentPrice + amount;
  }

  // Check funds locally first to avoid unnecessary database lock
  if (player.gold < targetAmount) {
    return `❌ No tienes suficiente oro. Tienes *🪙 ${player.gold.toLocaleString('es-PY')} oro* y quieres pujar un total acumulado de *🪙 ${targetAmount.toLocaleString('es-PY')}*.`;
  }

  // Call the database function to place bid
  const { data, error: rpcError } = await supabase.rpc('place_auction_bid', {
    p_player_id: player.id,
    p_auction_id: targetAuction.id,
    p_amount: targetAmount
  });

  if (rpcError) {
    return `❌ *El Heraldo rechaza tu puja:*\n${rpcError.message}`;
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return `❌ La puja no devolvio datos confirmatorios.`;
  }

  const remaining = result.remaining_gold ?? (player.gold - targetAmount);

  return `╔════════════════════════════╗\n` +
         `⚖️  *PUJA CONFIRMADA*  ⚖️\n` +
         `╚════════════════════════════╝\n\n` +
         `Has registrado tu puja por *${targetAuction.item_name}*.\n\n` +
         `💰 *Puja Acumulada:* 🪙 ${targetAmount.toLocaleString('es-PY')} oro\n` +
         `👛 Tu oro restante: *🪙 ${remaining.toLocaleString('es-PY')}*\n\n` +
         `⚠️ _El oro de la puja se bloquea mientras seas líder. Si eres superado, se te devolverá. Se descuenta una única comisión del 25% del valor base del ítem no reembolsable por ingresar a la subasta._\n\n` +
         `_La subasta sigue ardiendo en el grupo de anuncios. ¿Podrás defender tu oferta?_`;
}

export async function handleRetirarse(msg, player, body) {
  const identifier = String(body ?? '').trim();
  if (!identifier) {
    return `❌ *Uso correcto:* \`!retirarse <nombre_item / #lista>\``;
  }

  // Fetch active auctions to match identifier
  const { data: auctions, error } = await supabase
    .from('market_auctions')
    .select('*')
    .eq('status', 'active')
    .order('expires_at', { ascending: true });

  if (error || !auctions) {
    console.error('[handleRetirarse] Error fetching active auctions:', error?.message);
    return '❌ No pude consultar las subastas en este momento.';
  }

  let targetAuction = null;
  const listNum = parseInt(identifier, 10);

  if (!isNaN(listNum) && listNum >= 1 && listNum <= auctions.length) {
    targetAuction = auctions[listNum - 1];
  } else {
    // Try UUID match
    targetAuction = auctions.find(a => a.id === identifier);
    if (!targetAuction) {
      // Try name match
      targetAuction = auctions.find(a => a.item_name.toLowerCase().includes(identifier.toLowerCase()));
    }
  }

  if (!targetAuction) {
    return `❌ No se encontro ninguna subasta activa que coincida con "${identifier}".`;
  }

  const { data, error: rpcError } = await supabase.rpc('withdraw_from_auction', {
    p_player_id: player.id,
    p_auction_id: targetAuction.id
  });

  if (rpcError) {
    return `❌ *Error al retirarse:*\n${rpcError.message}`;
  }

  return `🏳️ *Te has retirado de la subasta por ${targetAuction.item_name}.*\n` +
         `_Ya no podras realizar mas pujas en este articulo. El oro que hayas pujado previamente se ha perdido en el vacio._`;
}
