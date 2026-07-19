import {
  getActiveEvents,
  getActiveMissions,
  getEventDetails,
  getGoldLeaderboard,
  getLinkStatusByWhatsapp,
  getLeaderboard,
  getMarketItemDetails,
  getMissionDetails,
  getPlayer,
  getRealmSnapshot,
  searchMarketItems,
  transferGold,
  verifyAndLinkPlayer,
  getPlayersByPhone,
} from '../supabase.js';
import { setActiveProfile } from '../activeProfileStore.js';
import { askKingdoomAI } from '../ai.js';
import { isAdminUser, isOwner, isStaffUser, normalizePhone } from '../adminStore.js';
import { heraldCard, heraldCommand, heraldList, heraldSection, heraldStat } from '../formatting.js';
import { handleSubastas, handlePujar, handleRetirarse } from './auctions.js';

const SYSTEM_PROMPT = `Eres el Heraldo del Reino de Kingdoom - Reino de las Sombras.
Hablas con tono medieval, misterioso y epico. Usas emojis de espadas, coronas y fuego.
Eres conciso en WhatsApp (maximo 4 lineas). Nunca rompas el personaje.
Fecha actual: ${new Date().toLocaleDateString('es-PY')}`;

const chatHistory = new Map();

setInterval(() => {
  chatHistory.clear();
  console.log('[player] chatHistory limpiado');
}, 1000 * 60 * 60 * 6);

function clipText(value, max = 140) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function normalizeCommandText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseCommand(value) {
  const normalized = normalizeCommandText(value);
  if (!normalized) {
    return { normalized, hasPrefix: false, command: '', body: '' };
  }

  const hasPrefix = normalized.startsWith('!');
  const sanitized = hasPrefix ? normalized.slice(1).trim() : normalized;
  const [command = '', ...rest] = sanitized.split(/\s+/);

  return {
    normalized,
    hasPrefix,
    command,
    body: rest.join(' ').trim(),
  };
}

function formatStatus(value) {
  return String(value ?? '')
    .replace(/-/g, ' ')
    .toUpperCase();
}

function formatMarketItem(item) {
  const rarity = item.rarity ? ` - ${String(item.rarity).toUpperCase()}` : '';
  const price = Number(item.price ?? 0).toLocaleString('es-PY');
  return `• *${item.name}*${rarity} - 🪙 ${price} oro`;
}

function formatStock(item) {
  const status = formatStatus(item.stock_status ?? item.stockStatus ?? 'available');
  const limit = item.stock_limit ?? item.stockLimit ?? 0;
  const sold = item.stock_sold ?? item.stockSold ?? 0;

  if (limit > 0) {
    const remaining = Math.max(0, limit - sold);
    return `${status} (${remaining}/${limit})`;
  }

  return status;
}

function formatMissionRow(mission) {
  return `• *${mission.title}* - ${String(mission.difficulty).toUpperCase()} - 🪙 ${Number(mission.reward_gold ?? 0).toLocaleString('es-PY')}`;
}

function formatEventRow(event) {
  return `• *${event.title}* - ${formatStatus(event.status)} - 🎁 ${Number(event.participation_reward_gold ?? 0).toLocaleString('es-PY')} oro`;
}

export async function handlePlayerMessage(msg) {
  const sender = msg.author || msg.from;
  const chatId = msg.from;
  const rawText = String(msg.body ?? '').trim();
  const { command, body } = parseCommand(rawText);

  if (command === 'nuevo') {
    return heraldCard('Primeros pasos en Kingdoom', [
      '1. Pide tu registro al staff.',
      '2. Vincula tu WhatsApp con `!verificar usuario_o_id`.',
      '3. Revisa la web del reino y crea tu ficha.',
      '4. Usa `!ayuda` para ver los comandos del Heraldo.',
    ], { icon: '🏰' });
  }

  if (command === 'reclamar') {
    return `⚠️ *El Heraldo te instruye:* Para reclamar un Tesoro Errante, debes mantener presionado o deslizar el mensaje del tesoro, seleccionar *Responder* y escribir únicamente *reclamar* (sin prefijo ni signos).`;
  }

  if (command === 'vinculo') {
    const link = await getLinkStatusByWhatsapp(sender);
    if (!link.linked || !link.player) {
      return heraldCard('Vinculo no encontrado', [
        'Tu numero aun no esta vinculado a ningun perfil web.',
        'Usa `!verificar usuario_o_id` cuando el staff te habilite la cuenta.',
      ], { icon: '🔗' });
    }

    return heraldCard('Vinculo confirmado', [
      heraldStat('Aventurero', `*${link.player.username}*`),
      heraldStat('Numero', `*${link.phone}*`),
      heraldStat('Oro actual', `*${Number(link.player.gold ?? 0).toLocaleString('es-PY')}*`),
    ], { icon: '🔗' });
  }

  if (command === 'ayuda' || command === 'help') {
    const isSenderOwner = isOwner(sender);
    let isSenderAdmin = isAdminUser(sender);
    const isSenderStaff = isStaffUser(sender);

    const player = await getPlayer(sender);
    if (player?.is_admin === true) {
      isSenderAdmin = true;
    }

    let identityName = 'Jugador';
    if (isSenderOwner) identityName = '👑 Señor Owner';
    else if (isSenderAdmin) identityName = '🛡️ Administrador';
    else if (isSenderStaff) identityName = '🧾 Staff';

    const menuLines = [
      '> _Bienvenido al compendio del Reino de las Sombras._',
      heraldSection('Comandos del reino'),
      heraldList([
        heraldCommand('!oro [monto] [@user]', 'Consulta o envia oro.'),
        heraldCommand('!perfil', 'Muestra tu estado de aventurero.'),
        heraldCommand('!cambiarcuenta [nombre]', 'Cambia de personaje activo.'),
        heraldCommand('!vinculo', 'Revisa tu enlace con la web.'),
        heraldCommand('!nuevo', 'Abre la guia para comenzar.'),
        heraldCommand('!verificar <usuario_o_id>', 'Vincula tu WhatsApp al reino.'),
        heraldCommand('!ranking', 'Consulta el poder semanal.'),
        heraldCommand('!reino', 'Muestra el estado publico del reino.'),
        heraldCommand('!ricos', 'Consulta las mayores fortunas.'),
        heraldCommand('!mercado [nombre]', 'Explora articulos del mercado.'),
        heraldCommand('!item <nombre>', 'Consulta la ficha de un objeto.'),
        heraldCommand('!mision [nombre]', 'Lista o inspecciona misiones.'),
        heraldCommand('!evento [nombre]', 'Lista o inspecciona eventos.'),
        heraldCommand('!subastas', 'Muestra las subastas activas.'),
        heraldCommand('!pujar <item> <monto>', 'Presenta una oferta acumulada.'),
        heraldCommand('!retirarse <item>', 'Abandona una subasta.'),
        heraldCommand('!dados <monto> [x4]', 'Apuesta en los dados del destino.'),
        heraldCommand('!cofre [xN]', 'Abre uno o varios cofres.'),
        heraldCommand('!trampa <monto> [xN]', 'Arriesga oro en una trampa.'),
        heraldCommand('!21 <monto>', 'Juega Blackjack.'),
        heraldCommand('!oraculo <pregunta>', 'Consulta al Oraculo.'),
        heraldCommand('!ayuda', 'Abre este compendio.'),
      ]),
      '⚠️ `!cofre`, `!trampa` y `!21` se juegan por privado con el bot.',
    ];

    if (isSenderOwner || isSenderAdmin || isSenderStaff) {
      const staffCommands = [
        heraldCommand('!registrar <nombre> [oro]', 'Registra un aventurero.'),
        heraldCommand('!grant <objetivo> <monto>', 'Entrega oro.'),
        heraldCommand('!quitar <objetivo> <monto>', 'Descuenta oro.'),
        heraldCommand('!ban <objetivo>', 'Destierra un jugador.'),
        heraldCommand('!verificarnumero <objetivo>', 'Fuerza una vinculacion.'),
        heraldCommand('!desvincular <objetivo>', 'Retira los numeros de un perfil.'),
        heraldCommand('!stats', 'Muestra el resumen general.'),
        heraldCommand('!censo', 'Genera el censo del reino.'),
        heraldCommand('!pendientes', 'Lista jugadores pendientes.'),
        heraldCommand('!purga', 'Expulsa pendientes inactivos.'),
        heraldCommand('!actividad', 'Genera el reporte de actividad.'),
        heraldCommand('!groupid', 'Muestra el ID del grupo.'),
        heraldCommand('!staff', 'Abre la vista operativa.'),
        heraldCommand('!bitacora', 'Consulta acciones recientes.'),
        heraldCommand('!misionstart <ID> <@jugadores>', 'Inicia el seguimiento de una mision.'),
        heraldCommand('!misioncompleta <dificultad> <@jugadores>', 'Otorga puntos de temporada.'),
        heraldCommand('!admin', 'Abre el menu del consejo.'),
      ];

      if (isSenderOwner) {
        staffCommands.unshift(
          heraldCommand('!add admin <objetivo>', 'Otorga rango de administrador.'),
          heraldCommand('!remove admin <objetivo>', 'Revoca rango de administrador.')
        );
        staffCommands.splice(
          13,
          0,
          heraldCommand('!grupos', 'Lista los grupos vinculados.'),
          heraldCommand('!grupoactual', 'Inspecciona el grupo actual.'),
          heraldCommand('!data [titulo]', 'Carga un archivo de conocimiento adjunto.')
        );
      }

      menuLines.push(
        heraldSection(isSenderOwner ? 'Comandos del soberano' : isSenderAdmin ? 'Comandos de administrador' : 'Comandos de staff'),
        heraldList(staffCommands)
      );
    }

    menuLines.push(
      heraldSection('Tu identidad'),
      heraldStat('Rango', identityName),
      heraldStat('Telefono', `\`${normalizePhone(sender)}\``)
    );

    if (!player) {
      if (isSenderOwner || isSenderAdmin) {
        menuLines.push('⚠️ Aun no tienes personaje forjado. Usa `!registrar <tu_nombre> [oro]`.');
      } else {
        menuLines.push('⚠️ Aun no estas registrado. Pidele al staff que use `!registrar` para darte entrada.');
      }
    }

    return heraldCard('Kingdoom · Reino de las Sombras', menuLines, {
      icon: '⚔️',
      footer: '╰─ _Que el oro fluya y el reino prospere_',
    });

  }

  if (command === 'verificar') {
    const result = await verifyAndLinkPlayer(sender, body);
    return result.message;
  }

  if (command === 'cambiarcuenta') {
    const searchKey = String(body ?? '').trim().toLowerCase();
    const linkedPlayers = await getPlayersByPhone(sender);
    
    if (linkedPlayers.length <= 1) {
      return `⚠️ Solo tienes una cuenta vinculada a este número de WhatsApp.`;
    }

    if (!searchKey) {
      const names = linkedPlayers.map(p => `*${p.username}*`).join(', ');
      return `Tienes varias cuentas vinculadas:\n${names}\n\nUsa \`!cambiarcuenta <nombre>\` para elegir cuál usar.`;
    }

    const targetPlayer = linkedPlayers.find(p => p.username.toLowerCase() === searchKey || p.id.toLowerCase().startsWith(searchKey));
    if (!targetPlayer) {
      return `❌ No tienes ninguna cuenta vinculada que coincida con "${searchKey}".`;
    }

    setActiveProfile(sender, targetPlayer.id);
    return `✅ ¡Cambio exitoso! Ahora estás usando la cuenta de *${targetPlayer.username}* en el bot.`;
  }

  const player = await getPlayer(sender);

  if (!player) {
    return `⚔️ *Viajero desconocido*, no estas registrado en el reino.\n\nEscribe *!registrar TuNombre* para unirte a Kingdoom.`;
  }

  if (command === 'oro' || command === 'gold') {
    if (!body) {
      return heraldCard(`Fortuna de ${player.username}`, [
        heraldStat('Oro actual', `*${player.gold.toLocaleString('es-PY')} oro*`),
        '_El oro es el aliento del reino._',
      ], { icon: '👑' });
    }

    const parts = body.split(/\s+/);
    const amount = parseInt(parts[0].replace(/\./g, ''));
    
    if (isNaN(amount) || amount <= 0) {
      return `❌ *Uso correcto para enviar oro:*\n\`!oro <monto> <@usuario>\``;
    }

    if (amount > player.gold) {
      return `❌ No tienes suficiente oro para transferir.\n🪙 Tu oro actual: *${player.gold.toLocaleString('es-PY')}*`;
    }

    let identifier = '';
    if (msg.hasQuotedMsg) {
      identifier = ''; // resolvePlayerTarget handles quoted msg when identifier is empty
    } else {
      identifier = parts.slice(1).join(' ').trim();
    }

    if (!identifier && !msg.hasQuotedMsg) {
      return `❌ *Uso correcto para enviar oro:*\n\`!oro <monto> <@usuario>\``;
    }

    const { resolvePlayerTarget } = await import('../targetResolver.js');
    const resolved = await resolvePlayerTarget(msg, identifier);
    
    if (!resolved.ok) {
      if (resolved?.reason === 'ambiguous') {
        return `⚠️ Hay varias coincidencias. Usa el celular, cita el mensaje o menciona al jugador directamente.`;
      }
      return `❌ Jugador no encontrado en el reino.`;
    }

    const targetPlayer = resolved.player;

    if (targetPlayer.id === player.id) {
      return `❌ No puedes enviarte oro a ti mismo.`;
    }

    try {
      const transferResult = await transferGold(player.id, targetPlayer.id, amount);
      const reportedTotal = Number(transferResult.sender_gold);
      const nuevoTotal = Number.isFinite(reportedTotal) ? reportedTotal : player.gold - amount;
      return `✅ Has enviado *${amount.toLocaleString('es-PY')} oro* a *${targetPlayer.username}*.\n🪙 Tu nuevo total: *${nuevoTotal.toLocaleString('es-PY')}*`;
    } catch (err) {
      console.error('[oro transfer error]', err);
      return `❌ Hubo un error al procesar la transferencia de oro. Inténtalo de nuevo.`;
    }
  }

  if (command === 'perfil' || command === 'estado') {
    let targetPlayer = player;

    if (body) {
      if (isOwner(sender) || isAdminUser(sender) || player?.is_admin) {
        const { resolvePlayerTarget } = await import('../targetResolver.js');
        const resolved = await resolvePlayerTarget(msg, body);
        if (!resolved.ok) {
          if (resolved?.reason === 'ambiguous') {
            return `⚠️ Hay varias coincidencias para "${body}". Especifica el nombre completo o usa el ID.`;
          }
          return `❌ Jugador no encontrado en el reino.`;
        }
        targetPlayer = resolved.player;
      } else {
        return `❌ Solo los administradores pueden ver el perfil de otros viajeros.`;
      }
    }

    const phoneList = (targetPlayer.phone || '').split(',').map(n => n.trim()).filter(Boolean);
    const ids = phoneList.filter(n => n.length >= 15);
    const phones = phoneList.filter(n => n.length < 15);

    const stats = [
      heraldStat('Nombre', `*${targetPlayer.username}*`),
      heraldStat('Oro total', `*${targetPlayer.gold.toLocaleString('es-PY')}*`),
      heraldStat('Oro semanal', `*${(targetPlayer.weekly_gold ?? 0).toLocaleString('es-PY')}*`),
      heraldStat('ID Web', `*${targetPlayer.id}*`),
      heraldStat('ID WhatsApp', `*${ids.length > 0 ? ids.join(', ') : 'Ninguno'}*`),
      heraldStat('Telefono', `*${phones.length > 0 ? phones.join(', ') : 'Ninguno'}*`),
    ];

    return heraldCard('Perfil del aventurero', stats, { icon: '🛡️' });
  }

  if (command === 'ranking' || command === 'top') {
    const board = await getLeaderboard();
    if (!board.length) return `📊 Aun no hay guerreros en el ranking.`;

    const lines = board.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
      return `${medal} *${entry.username}* - ${entry.weekly_gold.toLocaleString('es-PY')} oro`;
    }).join('\n');

    return heraldCard('Ranking semanal del reino', [lines], { icon: '⚔️' });
  }

  if (command === 'ricos' || command === 'fortunas') {
    const board = await getGoldLeaderboard();
    if (!board.length) return `👑 Nadie ha amasado fortuna todavia.`;

    const lines = board.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
      return `${medal} *${entry.username}* - ${entry.gold.toLocaleString('es-PY')} oro`;
    }).join('\n');

    return heraldCard('Grandes fortunas del reino', [lines], { icon: '👑' });
  }

  if (command === 'mercado') {
    const items = await searchMarketItems(body);

    if (!items.length) {
      return body
        ? `🏪 No halle articulos para *${body}* en el mercado del reino.`
        : `🏪 El mercado esta vacio hoy, viajero.`;
    }

    const maxItems = body ? 8 : 12;
    const lines = items.slice(0, maxItems).map(formatMarketItem).join('\n');

    return body
      ? heraldCard(`Mercado: ${body.toUpperCase()}`, [lines], { icon: '🔎' })
      : heraldCard('Mercado de Kingdoom', [lines], { icon: '🏪' });
  }

  if (command === 'item') {
    if (!body) return `🗡️ Usa: *!item Nombre del arma*`;

    const item = await getMarketItemDetails(body);
    if (!item) return `🗡️ No encontre un item llamado *${body}* en el mercado del reino.`;

    const lines = [
      `🗡️ *${item.name}*`,
      `${String(item.rarity ?? 'common').toUpperCase()} - ${String(item.category ?? 'others').toUpperCase()} - 🪙 ${Number(item.price ?? 0).toLocaleString('es-PY')}`,
      `Estado: *${formatStock(item)}*`,
    ];

    if (item.ability) {
      lines.push(`Habilidad: ${clipText(item.ability, 500)}`);
    } else {
      lines.push(clipText(item.description, 500));
    }

    return heraldCard(item.name, lines.slice(1), { icon: '🗡️' });
  }

  if (command === 'mision' && !body) {
    const missions = await getActiveMissions();
    if (!missions.length) return `📜 No hay misiones abiertas en este momento.`;
    return heraldCard('Misiones abiertas', [
      missions.map(formatMissionRow).join('\n'),
      'Usa `!mision nombre` para verla en detalle.',
    ], { icon: '📜' });
  }

  if (command === 'mision' && body) {
    const mission = await getMissionDetails(body);
    if (!mission) return `📜 No encontre una mision llamada *${body}*.`;

    return heraldCard(mission.title, [
      `${String(mission.difficulty).toUpperCase()} - ${String(mission.type).toUpperCase()} - 🪙 ${Number(mission.reward_gold ?? 0).toLocaleString('es-PY')}`,
      `Cupo: *${mission.max_participants ?? 1}* - Estado: *${formatStatus(mission.status)}*`,
      clipText(mission.description || mission.instructions, 500),
    ], { icon: '📜' });
  }

  if (command === 'evento' && !body) {
    const events = await getActiveEvents();
    if (!events.length) return `🎭 No hay eventos abiertos ni en produccion ahora mismo.`;
    return heraldCard('Eventos del reino', [
      events.map(formatEventRow).join('\n'),
      'Usa `!evento nombre` para verlo en detalle.',
    ], { icon: '🎭' });
  }

  if (command === 'evento' && body) {
    const event = await getEventDetails(body);
    if (!event) return `🎭 No encontre un evento llamado *${body}*.`;

    return heraldCard(event.title, [
      `${formatStatus(event.status)} - Inicio: *${event.start_date || '-'}*`,
      `Cierre: *${event.end_date || '-'}* - 🎁 ${Number(event.participation_reward_gold ?? 0).toLocaleString('es-PY')} oro`,
      clipText(event.description || event.long_description || event.rewards, 500),
    ], { icon: '🎭' });
  }

  if (command === 'subasta' || command === 'subastas') {
    return await handleSubastas(msg, player, body);
  }

  if (command === 'pujar' || command === 'puja') {
    return await handlePujar(msg, player, body);
  }

  if (command === 'retirarse') {
    return await handleRetirarse(msg, player, body);
  }

  if (command === 'reino' || command === 'resumen') {
    const snapshot = await getRealmSnapshot();
    return heraldCard('Estado del reino', [
      heraldStat('Aventureros', `*${snapshot.totalPlayers}*`),
      heraldStat('Mercado activo', `*${snapshot.availableItems}* articulos`),
      heraldStat('Mas rico', `*${snapshot.richest?.username ?? '-'}* (${(snapshot.richest?.gold ?? 0).toLocaleString('es-PY')} oro)`),
      heraldStat('Lider semanal', `*${snapshot.weeklyChampion?.username ?? '-'}* (${(snapshot.weeklyChampion?.weekly_gold ?? 0).toLocaleString('es-PY')} oro)`),
    ], { icon: '🏰' });
  }

  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  const contextMsg = `[Jugador: ${player.username} | Oro: ${player.gold}]\n\nMensaje: ${msg.body}`;
  history.push({ role: 'user', content: contextMsg });

  if (history.length > 16) history.splice(0, 2);

  try {
    const reply = await askKingdoomAI(history, SYSTEM_PROMPT);
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    console.error('[handlePlayerMessage IA]', err.message);
    history.pop();
    return `🔥 El oraculo no responde en este momento. Intenta de nuevo.`;
  }
}
