import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePhone } from './adminStore.js';
import { getStateFilePath } from './runtimePaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyStorePath = path.join(__dirname, 'data', 'active_profiles.json');
const storePath = getStateFilePath('active_profiles.json');

function initStore() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    if (fs.existsSync(legacyStorePath)) {
      fs.copyFileSync(legacyStorePath, storePath);
    } else {
      fs.writeFileSync(storePath, '{}', 'utf-8');
    }
  }
}

let profilesMemoryCache = null;

function loadStore() {
  if (profilesMemoryCache !== null) return profilesMemoryCache;
  initStore();
  try {
    profilesMemoryCache = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  } catch (err) {
    console.error("Error reading active profiles:", err);
    profilesMemoryCache = {};
  }
  return profilesMemoryCache;
}

export function getActiveProfile(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  const data = loadStore();
  return data[phone] || null;
}

export function setActiveProfile(whatsappNumber, playerId) {
  const phone = normalizePhone(whatsappNumber);
  const data = loadStore();
  data[phone] = playerId;
  try {
    initStore();
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error writing active profiles:", err);
    return false;
  }
}
