import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trackerPath = path.join(__dirname, 'data', 'pending_tracker.json');

// Ensure directory and file exist
function initTracker() {
  const dir = path.dirname(trackerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(trackerPath)) fs.writeFileSync(trackerPath, '{}', 'utf-8');
}

export function getTrackerData() {
  initTracker();
  try {
    return JSON.parse(fs.readFileSync(trackerPath, 'utf-8'));
  } catch (err) {
    console.error("Error reading tracker:", err);
    return {};
  }
}

export function saveTrackerData(data) {
  initTracker();
  try {
    fs.writeFileSync(trackerPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("Error writing tracker:", err);
  }
}

export function trackUnregisteredUsers(phones) {
  const data = getTrackerData();
  const now = Date.now();
  let modified = false;

  for (const phone of phones) {
    if (!data[phone]) {
      data[phone] = now;
      modified = true;
    }
  }

  // Cleanup: remove phones from tracker if they are no longer pending
  for (const phone of Object.keys(data)) {
    if (!phones.includes(phone)) {
      delete data[phone];
      modified = true;
    }
  }

  if (modified) saveTrackerData(data);
  return data;
}
