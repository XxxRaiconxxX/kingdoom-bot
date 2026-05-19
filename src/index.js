import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleDados, handleOraculo } from './handlers/games.js';
import { registerPlayer } from './supabase.js';
import { startScheduler } from './scheduler.js';

const ADMIN = process.env.ADMIN_NUMBER;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', qr => {
  console.log('👇 Escanea este QR:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Kingdoom Bot conectado');
  startScheduler(client);
});

client.on('message', async (msg) => {
  if (msg.fromMe || msg.isStatus) return;

  const text = msg.body.trim();
  const isAdmin = msg.from === ADMIN;
  let reply = '';

  try {
    // Comandos de admin
    if (isAdmin && text.startsWith('!grant')) reply = await handleAdminCommand(msg, client);
    else if (isAdmin && text.startsWith('!broadcast')) reply = await handleAdminCommand(msg, client);
    else if (isAdmin && text.startsWith('!stats')) reply = await handleAdminCommand(msg, client);

    // Registro
    else if (text.toLowerCase().startsWith('!registrar')) {
      const username = text.split(' ').slice(1).join(' ');
      reply = await registerPlayer(msg.from, username);
    }

    // Juegos
    else if (text.toLowerCase().startsWith('!dados')) reply = await handleDados(msg);
    else if (text.toLowerCase().startsWith('!oraculo')) reply = await handleOraculo(msg);

    // Todo lo demás → handler con IA
    else reply = await handlePlayerMessage(msg);

    if (reply) await msg.reply(reply);

  } catch (err) {
    console.error('Error:', err);
    await msg.reply('⚔️ El reino está en llamas... intenta de nuevo en un momento.');
  }
});

client.initialize();
