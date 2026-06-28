import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMINS_FILE = path.join(__dirname, '..', '.wwebjs_auth', 'admins.json');
const STAFF_FILE = path.join(__dirname, '..', '.wwebjs_auth', 'staff.json');

// In-memory cache of admin numbers (excluding @c.us)
let adminsCache = null;
let staffCache = null;
export function formatJid(phone) {
  const p = String(phone || '').trim();
  return p.length >= 15 ? `${p}@lid` : `${p}@c.us`;
}

export function normalizePhone(phone) {
  let cleaned = String(phone || '')
    .replace(/@c\.us$/, '')
    .replace(/@g\.us$/, '')
    .replace(/\D/g, '')
    .trim();

  // 1. Paraguayan number normalization (e.g. 5959987273405 -> 595987273405)
  if (cleaned.startsWith('5959') && cleaned.length === 13) {
    cleaned = '595' + cleaned.substring(4);
  }

  // 2. Mexican number normalization (e.g. 526645891712 -> 5216645891712)
  if (cleaned.startsWith('52') && !cleaned.startsWith('521') && cleaned.length === 12) {
    cleaned = '521' + cleaned.substring(2);
  }

  // 3. Argentine number normalization (e.g. 54341... -> 549341...)
  if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
    let rest = cleaned.substring(2);
    if (rest.startsWith('15')) {
      rest = rest.substring(2);
    }
    cleaned = '549' + rest;
  }

  const envOwner = process.env.OWNER_NUMBER !== undefined ? normalizePhoneSimple(process.env.OWNER_NUMBER) : null;
  // 4. Map owner 15-digit ID to main phone number so the same profile is used
  if (cleaned === '275162062668001' && envOwner) {
    cleaned = envOwner;
  }

  return cleaned;
}

function normalizePhoneSimple(phone) {
  let cleaned = String(phone || '')
    .replace(/@c\.us$/, '')
    .replace(/@g\.us$/, '')
    .replace(/\D/g, '')
    .trim();

  if (cleaned.startsWith('5959') && cleaned.length === 13) {
    cleaned = '595' + cleaned.substring(4);
  }

  if (cleaned.startsWith('52') && !cleaned.startsWith('521') && cleaned.length === 12) {
    cleaned = '521' + cleaned.substring(2);
  }

  if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
    let rest = cleaned.substring(2);
    if (rest.startsWith('15')) {
      rest = rest.substring(2);
    }
    cleaned = '549' + rest;
  }

  return cleaned;
}

export function loadAdmins() {
  if (adminsCache !== null) return adminsCache;

  const defaultAdmins = [];
  // Also load default admin from env if present
  if (process.env.ADMIN_NUMBER !== undefined) {
    defaultAdmins.push(normalizePhoneSimple(process.env.ADMIN_NUMBER));
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

function parseEnvPhoneList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizePhone(entry))
    .filter(Boolean);
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

export function loadStaff() {
  if (staffCache !== null) return staffCache;

  const defaultStaff = parseEnvPhoneList(process.env.STAFF_NUMBERS);

  try {
    if (fs.existsSync(STAFF_FILE)) {
      const data = fs.readFileSync(STAFF_FILE, 'utf8');
      const loaded = JSON.parse(data);
      if (Array.isArray(loaded)) {
        staffCache = [...new Set([...defaultStaff, ...loaded.map(normalizePhone)])];
        return staffCache;
      }
    }
  } catch (err) {
    console.error('[loadStaff] Error loading staff:', err);
  }

  staffCache = defaultStaff;
  return staffCache;
}

export function isOwner(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  const envOwner = process.env.OWNER_NUMBER !== undefined ? normalizePhoneSimple(process.env.OWNER_NUMBER) : null;
  const envAdmin = process.env.ADMIN_NUMBER !== undefined ? normalizePhoneSimple(process.env.ADMIN_NUMBER) : null;
  
  return (envOwner && phone === envOwner) ||
         (envAdmin && phone === envAdmin);
}

export function isAdminUser(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (isOwner(whatsappNumber)) return true;
  const list = loadAdmins();
  return list.includes(phone);
}

export function isStaffUser(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (isAdminUser(whatsappNumber)) return true;
  const list = loadStaff();
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
