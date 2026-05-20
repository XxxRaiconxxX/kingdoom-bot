import fs from 'fs';
import path from 'path';

const AUDIT_FILE = '/app/.wwebjs_auth/admin_audit_log.json';
const MAX_AUDIT_ENTRIES = 500;

function ensureAuditDir() {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readAuditEntries() {
  ensureAuditDir();

  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, '[]', 'utf8');
    return [];
  }

  try {
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[auditLog.read]', error.message);
    return [];
  }
}

function writeAuditEntries(entries) {
  ensureAuditDir();

  try {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(entries.slice(0, MAX_AUDIT_ENTRIES), null, 2), 'utf8');
  } catch (error) {
    console.error('[auditLog.write]', error.message);
  }
}

export function recordAdminAction(entry) {
  const entries = readAuditEntries();
  const nextEntry = {
    at: new Date().toISOString(),
    actorPhone: '',
    actorName: '',
    action: '',
    target: '',
    detail: '',
    chatId: '',
    ...entry,
  };

  entries.unshift(nextEntry);
  writeAuditEntries(entries);
  return nextEntry;
}

export function getRecentAdminActions(limit = 8) {
  return readAuditEntries().slice(0, Math.max(1, limit));
}
