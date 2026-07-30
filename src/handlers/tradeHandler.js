import {
  getPlayerInventory,
  searchMarketItems,
  updateGold,
  transferGold,
  getPlayer,
  supabase
} from '../supabase.js';
import { heraldCard, heraldStat } from '../formatting.js';
import { resolvePlayerTarget } from '../targetResolver.js';
import { parseGoldAmount } from '../economy.js';

// Trade proposals stored in memory (key: chatId + '_' + targetPlayerId)
const pendingTrades = new Map();

// Helper to remove/decrement an item from player_inventory
export async function removePlayerInventoryItem(playerId, itemName, quantity = 1) {
  if (!playerId || !itemName || quantity <= 0) {
    return { success: false, message: 'Parámetros inválidos.' };
  }

  const { data: items, error } = await supabase
    .from('player_inventory')
    .select('id, item_name, quantity, is_locked, item_category, item_id')
    .eq('player_id', playerId);

  if (error || !items || items.length === 0) {
    return { success: false, message: 'Tu inventario está vacío.' };
  }

  const normalizedSearch = itemName.toLowerCase().trim();
  const match = items.find(i => (i.item_name || '').toLowerCase().includes(normalizedSearch));

  if (!match) {
    return { success: false, message: `No posees el ítem *${itemName}* en tu inventario.` };
  }

  if (match.is_locked) {
    return { success: false, message: `El ítem *${match.item_name}* está 🔒 bloqueado por un plan de pago o deuda pendiente.` };
  }

  if (match.quantity < quantity) {
    return { success: false, message: `Solo tienes *${match.quantity}x ${match.item_name}* (solicitado: ${quantity}x).` };
  }

  if (match.quantity === quantity) {
    const { error: delErr } = await supabase
      .from('player_inventory')
      .delete()
      .eq('id', match.id);

    if (delErr) {
      return { success: false, message: 'Error al retirar el ítem del inventario.' };
    }
  } else {
    const { error: updErr } = await supabase
      .from('player_inventory')
      .update({ quantity: match.quantity - quantity })
      .eq('id', match.id);

    if (updErr) {
      return { success: false, message: 'Error al actualizar la cantidad del ítem.' };
    }
  }

  return { success: true, item: match };
}

// Helper to add/increment an item in player_inventory
export async function addPlayerInventoryItem(playerId, itemName, quantity = 1, category = 'Consumible', itemId = null) {
  if (!playerId || !itemName || quantity <= 0) return false;

  const { data: existing } = await supabase
    .from('player_inventory')
    .select('id, quantity')
    .eq('player_id', playerId)
    .ilike('item_name', itemName)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('player_inventory')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id);
    return !error;
  } else {
    const { error } = await supabase
      .from('player_inventory')
      .insert({
        player_id: playerId,
        item_name: itemName,
        item_id: itemId || itemName.toLowerCase().replace(/\s+/g, '-'),
        quantity: quantity,
        item_category: category,
        is_locked: false
      });
    return !error;
  }
}

// Command !items / !inventario
export async function handleItems(msg, player) {
  const inventory = await getPlayerInventory(player.id);

  if (!inventory || inventory.length === 0) {
    return heraldCard(`Mochila de ${player.username}`, [
      ' Tu inventario está totalmente vacío.',
      ' Visita el mercado con `!mercado` para adquirir equipamiento.'
    ], { icon: '🎒' });
  }

  // Fetch market items to calculate resale prices (50% of market value)
  const marketItems = await searchMarketItems('');
  const marketPriceMap = new Map();
  if (marketItems && marketItems.length > 0) {
    for (const mi of marketItems) {
      marketPriceMap.set((mi.name || '').toLowerCase(), Number(mi.price || 0));
    }
  }

  const lines = inventory.map(item => {
    const lockIcon = item.is_locked ? ' 🔒 [Bloqueado]' : '';
    const basePrice = marketPriceMap.get((item.item_name || '').toLowerCase()) || 100;
    const sellPrice = Math.floor(basePrice * 0.5);
    return `• *${item.item_name}* (${item.quantity}x)${lockIcon}\n  └ Valor de venta: 🪙 ${sellPrice.toLocaleString('es-PY')} oro c/u`;
  });

  lines.push('\n💡 _Comandos útiles:_');
  lines.push('• `!vender <item> [cantidad]` para vender a la tienda.');
  lines.push('• `!comerciar @jugador <oferta> por <pedido>` para trocar.');

  return heraldCard(`Mochila de ${player.username}`, lines, { icon: '🎒' });
}

// Command !vender <item> [cantidad]
export async function handleVenderItem(msg, player, body) {
  if (!body) {
    return `💰 *Uso del comando vender:*\n\`!vender <nombre_item> [cantidad]\`\n_Ejemplo: !vender Pocion de Vida 2_`;
  }

  const parts = body.trim().split(/\s+/);
  let quantity = 1;

  // Check if last token is numeric quantity
  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart) && parts.length > 1) {
    quantity = parseInt(lastPart, 10);
    parts.pop();
  }

  const itemName = parts.join(' ').trim();

  // Try to remove item from inventory
  const removeRes = await removePlayerInventoryItem(player.id, itemName, quantity);
  if (!removeRes.success) {
    return `❌ ${removeRes.message}`;
  }

  const matchedItem = removeRes.item;

  // Calculate market sell price (50% of market item price, or fallback 100 gold)
  const marketItems = await searchMarketItems(matchedItem.item_name);
  let unitPrice = 100;
  if (marketItems && marketItems.length > 0) {
    const exact = marketItems.find(mi => mi.name.toLowerCase() === matchedItem.item_name.toLowerCase());
    if (exact) {
      unitPrice = Math.floor(Number(exact.price || 0) * 0.5);
    } else {
      unitPrice = Math.floor(Number(marketItems[0].price || 0) * 0.5);
    }
  }

  const totalEarnedGold = unitPrice * quantity;

  // Add gold to player
  await updateGold(player.id, totalEarnedGold);

  return heraldCard('Venta Realizada en la Taberna', [
    heraldStat('Artículo vendido', `*${quantity}x ${matchedItem.item_name}*`),
    heraldStat('Precio unitario', `🪙 ${unitPrice.toLocaleString('es-PY')} oro`),
    heraldStat('Oro obtenido', `🪙 *+${totalEarnedGold.toLocaleString('es-PY')} oro*`),
    ` Tu oro ha sido acreditado en tu bolsa.`
  ], { icon: '💰' });
}

// Helper to parse trade offers (e.g. "5000 oro" or "Pocion de Vida 2" or "Espada")
function parseTradeOffer(text) {
  const trimmed = text.trim();
  const goldMatch = trimmed.match(/^(\d+(?:\.\d+)?k?)\s*oro$/i);
  if (goldMatch) {
    const gold = parseGoldAmount(goldMatch[1]);
    if (gold !== null && gold > 0) {
      return { type: 'gold', amount: gold };
    }
  }

  // Otherwise it's an item: check if ends with a number
  const parts = trimmed.split(/\s+/);
  let qty = 1;
  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart) && parts.length > 1) {
    qty = parseInt(lastPart, 10);
    parts.pop();
  }

  return { type: 'item', name: parts.join(' ').trim(), quantity: qty };
}

// Command !comerciar @jugador <oferta> por <pedido>
export async function handleComerciar(msg, player, body) {
  if (!body || !body.includes(' por ')) {
    return `🤝 *Uso de Comercio entre Aventureros:*\n` +
      `\`!comerciar @jugador <lo_que_ofreces> por <lo_que_pides>\`\n\n` +
      `*Ejemplos:*\n` +
      `• \`!comerciar @Ragnar 5000 oro por Pocion de Vida\`\n` +
      `• \`!comerciar @Ragnar Espada de Hierro por 10000 oro\`\n` +
      `• \`!comerciar @Ragnar Escudo Mágico por Pocion de Fuerza 2\``;
  }

  const [leftSide, rightSide] = body.split(/\s+por\s+/i);

  // Extract target player mention from leftSide
  const leftParts = leftSide.trim().split(/\s+/);
  const mentionPart = leftParts[0];
  const offerText = leftParts.slice(1).join(' ').trim();

  if (!offerText || !rightSide.trim()) {
    return `❌ Debes especificar lo que ofreces y lo que pides.\n_Ejemplo: !comerciar @jugador 5000 oro por Pocion de Vida_`;
  }

  // Resolve target player
  const { resolvePlayerTarget } = await import('../targetResolver.js');
  const resolved = await resolvePlayerTarget(msg, mentionPart);

  if (!resolved.ok) {
    return `❌ No se encontró al aventurero mencionado *${mentionPart}*.`;
  }

  const targetPlayer = resolved.player;

  if (targetPlayer.id === player.id) {
    return `❌ No puedes comerciar contigo mismo.`;
  }

  const offer = parseTradeOffer(offerText);
  const request = parseTradeOffer(rightSide.trim());

  // Validate sender owns what they offer
  if (offer.type === 'gold') {
    if (player.gold < offer.amount) {
      return `❌ No tienes suficiente oro. Posees *${player.gold.toLocaleString('es-PY')} oro* e intentas ofrecer *${offer.amount.toLocaleString('es-PY')} oro*.`;
    }
  } else {
    // Check inventory
    const inv = await getPlayerInventory(player.id);
    const itemMatch = inv?.find(i => i.item_name.toLowerCase().includes(offer.name.toLowerCase()));
    if (!itemMatch) {
      return `❌ No posees el ítem *${offer.name}* en tu inventario.`;
    }
    if (itemMatch.is_locked) {
      return `❌ El ítem *${itemMatch.item_name}* está 🔒 bloqueado por un plan de pago.`;
    }
    if (itemMatch.quantity < offer.quantity) {
      return `❌ Solo posees ${itemMatch.quantity}x de *${itemMatch.item_name}*.`;
    }
    offer.name = itemMatch.item_name; // Normalize exact name
    offer.category = itemMatch.item_category;
  }

  // Save pending trade proposal in memory
  const tradeKey = `${msg.from}_${targetPlayer.id}`;
  pendingTrades.set(tradeKey, {
    tradeKey,
    senderPlayer: player,
    targetPlayer: targetPlayer,
    offer,
    request,
    createdAt: Date.now()
  });

  const offerStr = offer.type === 'gold' ? `🪙 ${offer.amount.toLocaleString('es-PY')} oro` : `📦 ${offer.quantity}x ${offer.name}`;
  const reqStr = request.type === 'gold' ? `🪙 ${request.amount.toLocaleString('es-PY')} oro` : `📦 ${request.quantity}x ${request.name}`;

  return heraldCard('Propuesta de Comercio', [
    `🤝 *${player.username}* ofrece un trato a *${targetPlayer.username}*:`,
    `──────────────`,
    ` Ofrece: *${offerStr}*`,
    ` Pide a cambio: *${reqStr}*`,
    `──────────────`,
    ` @${targetPlayer.username}, escribe \`!aceptarcomercio\` para concretar o \`!cancelarcomercio\` para rechazar.`
  ], { icon: '🤝' });
}

// Command !aceptarcomercio
export async function handleAceptarComercio(msg, player) {
  const tradeKey = `${msg.from}_${player.id}`;
  const trade = pendingTrades.get(tradeKey);

  if (!trade) {
    return `❌ No tienes ninguna propuesta de comercio pendiente en este chat.`;
  }

  // Check trade expiration (10 mins)
  if (Date.now() - trade.createdAt > 10 * 60 * 1000) {
    pendingTrades.delete(tradeKey);
    return `⌛ La propuesta de comercio ha expirado.`;
  }

  const { senderPlayer, targetPlayer, offer, request } = trade;

  // Refresh latest player profiles
  const freshSender = await getPlayer(senderPlayer.id);
  const freshTarget = await getPlayer(targetPlayer.id);

  if (!freshSender || !freshTarget) {
    return `❌ Error al verificar las cuentas de los jugadores.`;
  }

  // Re-verify sender offer resources
  if (offer.type === 'gold') {
    if (freshSender.gold < offer.amount) {
      pendingTrades.delete(tradeKey);
      return `❌ Comercio fallido: *${freshSender.username}* ya no tiene suficiente oro.`;
    }
  } else {
    const rem = await removePlayerInventoryItem(freshSender.id, offer.name, offer.quantity);
    if (!rem.success) {
      pendingTrades.delete(tradeKey);
      return `❌ Comercio fallido: *${freshSender.username}* no pudo entregar *${offer.name}* (${rem.message}).`;
    }
    offer.category = rem.item.item_category;
  }

  // Re-verify target requested resources
  if (request.type === 'gold') {
    if (freshTarget.gold < request.amount) {
      // Revert sender item if already taken
      if (offer.type === 'item') {
        await addPlayerInventoryItem(freshSender.id, offer.name, offer.quantity, offer.category);
      }
      pendingTrades.delete(tradeKey);
      return `❌ Comercio fallido: *${freshTarget.username}* no tiene suficiente oro (${request.amount.toLocaleString('es-PY')} oro).`;
    }
  } else {
    const rem = await removePlayerInventoryItem(freshTarget.id, request.name, request.quantity);
    if (!rem.success) {
      // Revert sender item if taken
      if (offer.type === 'item') {
        await addPlayerInventoryItem(freshSender.id, offer.name, offer.quantity, offer.category);
      }
      pendingTrades.delete(tradeKey);
      return `❌ Comercio fallido: *${freshTarget.username}* no pudo entregar *${request.name}* (${rem.message}).`;
    }
    request.category = rem.item.item_category;
  }

  // Complete transfer: Sender offer -> Target, Target request -> Sender
  if (offer.type === 'gold') {
    await transferGold(freshSender.id, freshTarget.id, offer.amount);
  } else {
    await addPlayerInventoryItem(freshTarget.id, offer.name, offer.quantity, offer.category);
  }

  if (request.type === 'gold') {
    await transferGold(freshTarget.id, freshSender.id, request.amount);
  } else {
    await addPlayerInventoryItem(freshSender.id, request.name, request.quantity, request.category);
  }

  pendingTrades.delete(tradeKey);

  const offerStr = offer.type === 'gold' ? `🪙 ${offer.amount.toLocaleString('es-PY')} oro` : `📦 ${offer.quantity}x ${offer.name}`;
  const reqStr = request.type === 'gold' ? `🪙 ${request.amount.toLocaleString('es-PY')} oro` : `📦 ${request.quantity}x ${request.name}`;

  return heraldCard(' Trato Concretado con Éxito', [
    `El intercambio entre *${freshSender.username}* y *${freshTarget.username}* se completó exitosamente.`,
    `──────────────`,
    ` *${freshSender.username}* entregó: ${offerStr}`,
    ` *${freshTarget.username}* entregó: ${reqStr}`,
    `──────────────`,
    ` Los objetos y el oro se han transferido a las respectivas mochilas.`
  ], { icon: '⚔️' });
}

// Command !cancelarcomercio
export async function handleCancelarComercio(msg, player) {
  const tradeKey = `${msg.from}_${player.id}`;
  if (pendingTrades.has(tradeKey)) {
    pendingTrades.delete(tradeKey);
    return `✅ Has rechazado y cancelado la propuesta de comercio.`;
  }

  // Also check if sender cancels their own proposal
  for (const [key, trade] of pendingTrades.entries()) {
    if (trade.senderPlayer.id === player.id && key.startsWith(msg.from)) {
      pendingTrades.delete(key);
      return `✅ Has cancelado tu propuesta de comercio.`;
    }
  }

  return `❌ No hay propuesta de comercio pendiente para cancelar.`;
}
