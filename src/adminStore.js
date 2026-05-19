import fs from 'fs';
import path from 'path';

const OWNER_NUMBER = '595987273405';
const ADMINS_FILE = '/app/.wwebjs_auth/admins.json';

// In-memory cache of admin numbers (excluding @c.us)
let adminsCache = null;

export function normalizePhone(phone) {
  return String(phone ?? '').replace('@c.us', '').replace(/\D/g, '').trim();
}

export function loadAdmins() {
  if (adminsCache !== null) return adminsCache;

  const defaultAdmins = [];
  // Also load default admin from env if present
  if (process.env.ADMIN_NUMBER) {
    defaultAdmins.push(normalizePhone(process.env.ADMIN_NUMBER));
  }

  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const loaded = JSON.parse(data);
      if (Array.isArray(loaded)) {
        adminsCache = [...new Set([...defaultAdmins, ...loaded.map(normalizePhone)])];
        return adminsCache;
      }
    }
  } catch (err) {
    console.error('[loadAdmins] Error loading admins:', err);
  }

  adminsCache = defaultAdmins;
  return adminsCache;
}

export function saveAdmins(adminsList) {
  try {
    const normalizedList = [...new Set(adminsList.map(normalizePhone))];
    const dir = path.dirname(ADMINS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(normalizedList, null, 2), 'utf8');
    adminsCache = normalizedList;
    return true;
  } catch (err) {
    console.error('[saveAdmins] Error saving admins:', err);
    return false;
  }
}

export function isOwner(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  const envOwner = process.env.OWNER_NUMBER ? normalizePhone(process.env.OWNER_NUMBER) : null;
  const envAdmin = process.env.ADMIN_NUMBER ? normalizePhone(process.env.ADMIN_NUMBER) : null;
  
  return phone === '595987273405' || 
         phone === '5959987273405' || 
         (envOwner && phone === envOwner) || 
         (envAdmin && phone === envAdmin);
}

export function isAdminUser(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (isOwner(whatsappNumber)) return true;
  const list = loadAdmins();
  return list.includes(phone);
}

export function addAdmin(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (!phone) return false;
  const list = loadAdmins();
  if (list.includes(phone)) return true;
  list.push(phone);
  return saveAdmins(list);
}

export function removeAdmin(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (!phone) return false;
  let list = loadAdmins();
  if (!list.includes(phone)) return true;
  list = list.filter(p => p !== phone);
  return saveAdmins(list);
}
