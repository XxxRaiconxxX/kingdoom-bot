import http from 'http';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleDados, handleOraculo } from './handlers/games.js';
import { buildWelcomeConfig, handleGroupWelcome } from './handlers/welcome.js';
import { registerPlayer, getPlayer, getPlayersByPhone, touchPlayerActivity } from './supabase.js';
import { startScheduler } from './scheduler.js';
import { isAdminUser } from './adminStore.js';

const { Client, LocalAuth } = pkg;

const PORT = process.env.PORT || 3000;

let latestQrDataUrl = '';
const welcomeConfig = buildWelcomeConfig();

function normalizeCommandText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseCommand(value) {
  const normalized = normalizeCommandText(value);
  if (!normalized) {
    return { normalized, hasPrefix: false, command: '', body: '' };
  }

  const hasPrefix = normalized.startsWith('!');
  const sanitized = hasPrefix ? normalized.slice(1) : normalized;
  const [command = '', ...rest] = sanitized.split(/\s+/);

  return {
    normalized,
    hasPrefix,
    command,
    body: rest.join(' ').trim(),
  };
}

function ensurePrefixedBody(command, originalBody, parsedBody) {
  if (normalizeCommandText(originalBody).startsWith('!')) {
    return originalBody;
  }

  return `!${command}${parsedBody ? ` ${parsedBody}` : ''}`;
}

http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  if (latestQrDataUrl) {
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Escanear QR</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #121214;
              color: #ffffff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .container {
              text-align: center;
              background: #1a1a1e;
              padding: 30px;
              border-radius: 16px;
              box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
              max-width: 90%;
              width: 360px;
            }
            h2 {
              margin-top: 0;
              color: #f5f5f7;
            }
            .qr-wrapper {
              background: #ffffff;
              padding: 15px;
              border-radius: 12px;
              display: inline-block;
              margin: 20px 0;
            }
            img {
              width: 250px;
              height: 250px;
              display: block;
            }
            p {
              color: #a3a3a8;
              font-size: 14px;
              margin: 10px 0 0 0;
            }
          </style>
          <script>
            setTimeout(() => {
              window.location.reload();
            }, 10000);
          </script>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Escanea este codigo QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img src="${latestQrDataUrl}" />
            </div>
            <p style="color: #ffc107; font-weight: 500;">El QR se actualiza automaticamente cada 10 segundos.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.end(`
    <html>
      <head>
        <title>Kingdoom Bot - Activo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #121214;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .container {
            text-align: center;
            background: #1a1a1e;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
            max-width: 90%;
            width: 360px;
          }
          h2 {
            margin-top: 0;
            color: #4cd964;
          }
          p {
            color: #a3a3a8;
            font-size: 16px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Bot Conectado</h2>
          <p>El Archivista confirma que <strong>Kingdoom Bot</strong> esta activo y respondiendo mensajes en WhatsApp.</p>
        </div>
      </body>
    </html>
  `);
}).listen(PORT, () => {
  console.log(`Servidor web activo en puerto ${PORT}`);
});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
  authTimeoutMs: 60000,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-accelerated-2d-canvas',
    ],
  },
});

client.on('qr', async (qr) => {
  console.log('Escanea este QR:');
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr);
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
  }
});

client.on('ready', () => {
  console.log('Kingdoom Bot conectado');
  latestQrDataUrl = '';
  startScheduler(client);
});

client.on('group_join', async (notification) => {
  try {
    await handleGroupWelcome(notification, client, welcomeConfig);
  } catch (error) {
    console.error('[group_join]', error.message);
  }
});

client.on('message', async (msg) => {
  if (msg.fromMe || msg.isStatus) return;

  const text = msg.body.trim();
  const { command, body, hasPrefix } = parseCommand(text);
  if (!hasPrefix) return; // Only respond when explicit commands starting with '!' are used

  const sender = msg.author || msg.from;
  
  getPlayer(sender).then(player => {
    if (player && player.id) {
      touchPlayerActivity(player.id).catch(console.error);
    }
  }).catch(console.error);
  
  const checkIsAdmin = async (user) => {
    if (isAdminUser(user)) return true;
    try {
      const players = await getPlayersByPhone(user);
      return players.some((player) => player?.is_admin === true);
    } catch (err) {
      console.error('[checkIsAdmin] Error checking DB:', err);
      return false;
    }
  };

  const isAdmin = await checkIsAdmin(sender);
  let reply = '';

  const wrapMsg = (originalMsg, newBody) => {
    const wrapped = Object.create(originalMsg);
    wrapped.body = newBody;
    return wrapped;
  };

  try {
    if (isAdmin && ['grant', 'quitar', 'stats', 'ban', 'registrar', 'verificarnumero', 'add', 'remove', 'admin', 'censo', 'fichas', 'pendientes', 'pendiente', 'purga', 'actividad', 'inactivos', 'groupid', 'grupos', 'grupoactual', 'staff', 'bitacora', 'data'].includes(command)) {
      reply = await handleAdminCommand(
        wrapMsg(msg, ensurePrefixedBody(command, text, body)),
        client
      );
    } else if (command === 'registrar') {
      reply = `❌ El comando *!registrar* está restringido únicamente a los Administradores del Reino.`;
    } else if (command === 'dados') {
      reply = await handleDados(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
    } else if (command === 'oraculo') {
      reply = await handleOraculo(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
    } else if (
      [
        'oro',
        'gold',
        'perfil',
        'estado',
        'vinculo',
        'nuevo',
        'verificar',
        'ranking',
        'top',
        'ricos',
        'fortunas',
        'mercado',
        'item',
        'mision',
        'evento',
        'reino',
        'resumen',
        'ayuda',
        'help',
      ].includes(command)
    ) {
      reply = await handlePlayerMessage(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
    } else {
      reply = await handlePlayerMessage(msg);
    }

    if (reply) await msg.reply(reply);
  } catch (err) {
    console.error('Error:', err);
    await msg.reply('⚔️ El reino esta en llamas... intenta de nuevo en un momento.');
  }
});

client.initialize().catch(err => {
  console.error('Failed to initialize client:', err);
});
