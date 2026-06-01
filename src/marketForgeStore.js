import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePhone } from './adminStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.join(__dirname, 'data', 'market_forge_sessions.json');

function ensureStore() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, '{}', 'utf-8');
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  } catch (error) {
    console.error('[marketForgeStore.read]', error);
    return {};
  }
}

function writeStore(data) {
  ensureStore();
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('[marketForgeStore.write]', error);
    return false;
  }
}

function buildKey(chatId, whatsappNumber) {
  return `${String(chatId || '').trim()}::${normalizePhone(whatsappNumber)}`;
}

export function getMarketForgeSession(chatId, whatsappNumber) {
  const key = buildKey(chatId, whatsappNumber);
  const data = readStore();
  return data[key] || null;
}

export function setMarketForgeSession(chatId, whatsappNumber, session) {
  const key = buildKey(chatId, whatsappNumber);
  const data = readStore();
  data[key] = {
    draftId: session.draftId,
    actorRole: session.actorRole,
    updatedAt: new Date().toISOString(),
  };
  return writeStore(data);
}

export function clearMarketForgeSession(chatId, whatsappNumber) {
  const key = buildKey(chatId, whatsappNumber);
  const data = readStore();
  delete data[key];
  return writeStore(data);
}
