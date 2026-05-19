import http from 'http';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleDados, handleOraculo } from './handlers/games.js';
import { registerPlayer } from './supabase.js';
import { startScheduler } from './scheduler.js';

const ADMIN = process.env.ADMIN_NUMBER;
const PORT = process.env.PORT || 3000;

let latestQrDataUrl = '';

// Servidor web interactivo para mostrar el código QR en el navegador
http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (latestQrDataUrl) {
    res.end(`
      <html>
        <head>
          <title>🏰 Kingdoom Bot - Escanear QR</title>
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
            // Auto recargar cada 10 segundos para actualizar el QR si expira
            setTimeout(() => {
              window.location.reload();
            }, 10000);
          </script>
        </head>
        <body>
          <div class="container">
            <h2>🏰 Kingdoom Bot</h2>
            <p>Escanea este código QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img src="${latestQrDataUrl}" />
            </div>
            <p style="color: #ffc107; font-weight: 500;">El QR se actualiza automáticamente cada 10 segundos.</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.end(`
      <html>
        <head>
          <title>🏰 Kingdoom Bot - Activo</title>
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
            <h2>✅ Bot Conectado</h2>
            <p>¡El Archivista confirma que <strong>Kingdoom Bot</strong> está activo y respondiendo mensajes en WhatsApp!</p>
          </div>
        </body>
      </html>
    `);
  }
}).listen(PORT, () => {
  console.log(`📡 Servidor web activo en puerto ${PORT}`);
});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-accelerated-2d-canvas'
    ]
  }
});

client.on('qr', async (qr) => {
  console.log('👇 Escanea este QR:');
  qrcode.generate(qr, { small: true });
  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr);
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
  }
});

client.on('ready', () => {
  console.log('✅ Kingdoom Bot conectado');
  latestQrDataUrl = ''; // Limpiar QR una vez conectado
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
