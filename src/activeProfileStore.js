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

export function getActiveProfile(whatsappNumber) {
  initStore();
  try {
    const phone = normalizePhone(whatsappNumber);
    const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    return data[phone] || null;
  } catch (err) {
    console.error("Error reading active profiles:", err);
    return null;
  }
}

export function setActiveProfile(whatsappNumber, playerId) {
  initStore();
  try {
    const phone = normalizePhone(whatsappNumber);
    const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    data[phone] = playerId;
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error writing active profiles:", err);
    return false;
  }
}
