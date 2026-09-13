import { normalizePhone } from '../src/adminStore.js';

console.log('Testing normalizePhone:');
console.log('1. "595981123456@c.us" =>', normalizePhone('595981123456@c.us'));
console.log('2. "595981123456:12@c.us" =>', normalizePhone('595981123456:12@c.us'));
console.log('3. "595981123456:4@s.whatsapp.net" =>', normalizePhone('595981123456:4@s.whatsapp.net'));
