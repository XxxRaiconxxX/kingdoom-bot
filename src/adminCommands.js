export const ADMIN_COMMANDS = new Set([
  'grant',
  'quitar',
  'stats',
  'ban',
  'eliminar',
  'kick',
  'registrar',
  'verificarnumero',
  'desvincular',
  'add',
  'remove',
  'admin',
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
]);

export const PRIVILEGED_COMMANDS = new Set([
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

export const OWNER_ONLY_COMMANDS = new Set(['add', 'remove', 'grupos', 'grupoactual']);

export function normalizeAdminCommand(command) {
  return String(command ?? '').trim().toLowerCase().replace(/^!/, '');
}

export function isKnownAdminCommand(command) {
  const normalized = normalizeAdminCommand(command);
  return ADMIN_COMMANDS.has(normalized) || PRIVILEGED_COMMANDS.has(normalized);
}

export function canRunAdminCommand(command, privileges = {}) {
  const normalized = normalizeAdminCommand(command);
  const isOwner = privileges.isOwner === true;
  const isAdmin = isOwner || privileges.isAdmin === true;
  const isStaff = isAdmin || privileges.isStaff === true;

  if (OWNER_ONLY_COMMANDS.has(normalized)) return isOwner;
  if (ADMIN_COMMANDS.has(normalized)) return isAdmin;
  if (PRIVILEGED_COMMANDS.has(normalized)) return isStaff;
  return false;
}
