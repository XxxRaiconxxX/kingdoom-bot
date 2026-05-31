import { supabase } from './supabase.js';

const TRACKER_DOC_ID = 'bot-pending-tracker';

export async function getTrackerData() {
  try {
    const { data, error } = await supabase
      .from('knowledge_documents')
      .select('content')
      .eq('id', TRACKER_DOC_ID)
      .maybeSingle();
      
    if (error && error.code !== 'PGRST116') {
      console.error("Supabase error reading tracker:", error.message);
    }
      
    if (data && data.content) {
      return JSON.parse(data.content);
    }
  } catch (err) {
    console.error("Error parsing tracker from Supabase:", err);
  }
  return {};
}

export async function saveTrackerData(data) {
  try {
    const { error } = await supabase
      .from('knowledge_documents')
      .upsert({
        id: TRACKER_DOC_ID,
        title: 'Bot Pending Tracker Data',
        type: 'other',
        content: JSON.stringify(data),
        updated_at: new Date().toISOString()
      });
      
    if (error) {
      console.error("Error writing tracker to Supabase:", error.message);
    }
  } catch (err) {
    console.error("Error writing tracker to Supabase:", err);
  }
}

export async function trackUnregisteredUsers(phones) {
  const data = await getTrackerData();
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

  if (modified) await saveTrackerData(data);
  return data;
}
