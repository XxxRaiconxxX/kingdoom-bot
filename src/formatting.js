function toLineArray(lines) {
  return lines
    .flatMap((line) => String(line ?? '').split('\n'))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

const COMMAND_THEMES = {
  dados: ['Dados del destino', '🎲'],
  cofre: ['Cofre del Reino', '🎁'],
  trampa: ['Trampa del Reino', '🕸️'],
  oraculo: ['El Oraculo', '🔮'],
  '21': ['21 · Blackjack', '🃏'],
  oro: ['Fortuna del Reino', '🪙'],
  gold: ['Fortuna del Reino', '🪙'],
  perfil: ['Perfil del aventurero', '🛡️'],
  estado: ['Perfil del aventurero', '🛡️'],
  vinculo: ['Vinculo con el Reino', '🔗'],
  verificar: ['Vinculo con el Reino', '🔗'],
  cambiarcuenta: ['Perfil activo', '🔄'],
  nuevo: ['Primeros pasos', '🏰'],
  ranking: ['Ranking del Reino', '🏆'],
  top: ['Ranking del Reino', '🏆'],
  ricos: ['Fortunas del Reino', '👑'],
  fortunas: ['Fortunas del Reino', '👑'],
  mercado: ['Mercado de Kingdoom', '🏪'],
  item: ['Objeto del Reino', '🗡️'],
  mision: ['Misiones del Reino', '🎯'],
  evento: ['Eventos del Reino', '🎪'],
  reino: ['Estado del Reino', '🏰'],
  resumen: ['Estado del Reino', '🏰'],
  ayuda: ['Compendio de comandos', '📜'],
  help: ['Compendio de comandos', '📜'],
  subasta: ['Subastas del Reino', '⚖️'],
  subastas: ['Subastas del Reino', '⚖️'],
  pujar: ['Subastas del Reino', '⚖️'],
  puja: ['Subastas del Reino', '⚖️'],
  retirarse: ['Subastas del Reino', '⚖️'],
  apk: ['Aplicacion de Kingdoom', '📲'],
  app: ['Aplicacion de Kingdoom', '📲'],
  forjaritem: ['Forja del Mercado', '⚒️'],
};

const COUNCIL_COMMANDS = new Set([
  'add',
  'remove',
  'admin',
  'registrar',
  'grant',
  'quitar',
  'ban',
  'verificarnumero',
  'desvincular',
  'stats',
  'censo',
  'fichas',
  'pendientes',
  'pendiente',
  'purga',
  'actividad',
  'inactivos',
  'groupid',
  'grupos',
  'grupoactual',
  'staff',
  'bitacora',
  'data',
  'misionstart',
  'misioneson',
  'misionoff',
  'misioncompleta',
  'faltasgrupo',
  'fichasrecicladas',
  'asignarficha',
  'rolestado',
  'rolbloquear',
  'roldesbloquear',
  'rolgracia',
  'rolforzaractividad',
]);

export function heraldCard(title, lines = [], options = {}) {
  const icon = options.icon ? `${options.icon} ` : '';
  const bodyPrefix = options.bodyPrefix ?? '';
  const footer = options.footer ?? '╰─ _Heraldo de Kingdoom_';
  const header = `╭─ ${icon}*${title}*`;
  const body = toLineArray(lines).map((line) => `${bodyPrefix}${line}`).join('\n');
  return body ? `${header}\n\n${body}\n\n${footer}` : `${header}\n${footer}`;
}

export function heraldList(items = [], prefix = '-') {
  return items
    .filter(Boolean)
    .map((item) => `${prefix} ${item}`)
    .join('\n');
}

export function heraldStat(label, value) {
  return `✦ *${label}* · ${value}`;
}

export function heraldCommand(command, description) {
  return `\`${command}\` · ${description}`;
}

export function heraldSection(title) {
  return `◆ *${title}*`;
}

export function decorateCommandReply(command, text) {
  const value = String(text ?? '').trim();
  if (!value || /^(?:╭─|╔═)/u.test(value)) return value;

  const normalizedCommand = String(command ?? '')
    .trim()
    .replace(/^!/, '')
    .toLowerCase();
  const theme = COMMAND_THEMES[normalizedCommand]
    ?? (COUNCIL_COMMANDS.has(normalizedCommand) ? ['Consejo del Reino', '🛡️'] : null)
    ?? ['Respuesta del Heraldo', '⚜️'];

  return heraldCard(theme[0], toLineArray([value]), { icon: theme[1] });
}
