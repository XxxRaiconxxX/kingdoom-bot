import { handleGroupWelcome } from '../src/handlers/welcome.js';

console.log('=== SIMULACIÓN EN VIVO DEL MENSAJE DE BIENVENIDA ===\n');

// Mock client
const mockClient = {
  info: { wid: { _serialized: 'bot_id@c.us' } },
  async getContactById(id) {
    return {
      id: { _serialized: id },
      number: id.split('@')[0],
      pushname: 'AventureroEspectral'
    };
  }
};

// Mock notification
const mockNotification = {
  chatId: 'welcome_group@g.us',
  async getChat() {
    return {
      id: { _serialized: 'welcome_group@g.us' },
      name: 'Taberna del Reino',
      async sendMessage(text, options) {
        console.log(`\n--- [MENSAJE ENVIADO A WHATSAPP] ---`);
        console.log(`Destinatario: Taberna del Reino`);
        if (options && options.mentions) {
          console.log(`Menciones en metadatos:`, options.mentions);
        }
        console.log(`Contenido:\n`);
        console.log(text);
        console.log(`------------------------------------\n`);
        return { id: { _serialized: 'msg_id' } };
      }
    };
  },
  async getRecipients() {
    return [
      { id: { _serialized: '595971123456@c.us' }, number: '595971123456', pushname: 'Raicon' }
    ];
  }
};

// Run simulation
await handleGroupWelcome(mockNotification, mockClient, {
  enabled: true,
  groupId: 'welcome_group@g.us'
});
