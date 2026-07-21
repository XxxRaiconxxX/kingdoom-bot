import assert from 'node:assert/strict';
import { handleGroupWelcome } from './src/handlers/welcome.js';

console.log('--- STARTING WELCOME FLOW TESTS ---');

// Mock client
const mockClient = {
  info: { wid: { _serialized: 'bot_id@c.us' } },
  async getContactById(id) {
    if (id === 'error@c.us') throw new Error('getContactById failed');
    return {
      id: { _serialized: id },
      number: id.split('@')[0],
      pushname: 'Player_' + id.split('@')[0]
    };
  }
};

// Test 1: Disabled configuration returns immediately
{
  let getChatCalled = false;
  const mockNotification = {
    async getChat() {
      getChatCalled = true;
      return {};
    }
  };
  await handleGroupWelcome(mockNotification, mockClient, { enabled: false });
  assert.equal(getChatCalled, false, 'Disabled welcome config should not call getChat');
}

// Test 2: Filters mismatch returns immediately
{
  let getRecipientsCalled = false;
  const mockNotification = {
    chatId: 'wrong_group@g.us',
    async getChat() {
      return {
        id: { _serialized: 'wrong_group@g.us' },
        name: 'Wrong Group'
      };
    },
    async getRecipients() {
      getRecipientsCalled = true;
      return [];
    }
  };
  await handleGroupWelcome(mockNotification, mockClient, {
    enabled: true,
    groupId: 'welcome_group@g.us',
    groupName: 'welcome group'
  });
  assert.equal(getRecipientsCalled, false, 'Filter mismatch should exit early');
}

// Test 3: Filter match proceeds and sends welcome message with correct mentions
{
  const sentMessages = [];
  const mockNotification = {
    chatId: 'welcome_group@g.us',
    async getChat() {
      return {
        id: { _serialized: 'welcome_group@g.us' },
        name: 'Welcome Group',
        async sendMessage(text, options) {
          sentMessages.push({ text, options });
          return { id: { _serialized: 'msg_id' } };
        }
      };
    },
    async getRecipients() {
      return [
        { id: { _serialized: 'player1@c.us' }, number: 'player1', pushname: 'Raicon' },
        { id: { _serialized: 'bot_id@c.us' }, number: 'bot_id' } // Should filter out bot
      ];
    }
  };

  // Mock sendLatestApk dependency check by intercepting console
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleGroupWelcome(mockNotification, mockClient, {
      enabled: true,
      groupId: 'welcome_group@g.us',
      groupName: 'welcome group'
    });
  } finally {
    console.error = originalError;
  }

  assert.ok(sentMessages.length >= 1, 'Should send at least the first welcome message');
  assert.match(sentMessages[0].text, /REINO DE LAS SOMBRAS/);
  assert.match(sentMessages[0].text, /@player1/);
  
  const mentions = sentMessages[0].options?.mentions;
  assert.ok(Array.isArray(mentions), 'Mentions options should be an array');
  assert.equal(mentions.length, 1);
  // We want to test that we pass JID strings
  assert.equal(mentions[0], 'player1@c.us');
}

// Test 4: Fallback recipients parsing when getRecipients fails
{
  const sentMessages = [];
  const mockNotification = {
    chatId: 'welcome_group@g.us',
    recipientIds: ['player2@c.us', 'error@c.us'],
    async getChat() {
      return {
        id: { _serialized: 'welcome_group@g.us' },
        name: 'Welcome Group',
        async sendMessage(text, options) {
          sentMessages.push({ text, options });
          return { id: { _serialized: 'msg_id' } };
        }
      };
    },
    async getRecipients() {
      throw new Error('getRecipients failed');
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    await handleGroupWelcome(mockNotification, mockClient, {
      enabled: true,
      groupId: 'welcome_group@g.us'
    });
  } finally {
    console.error = originalError;
  }

  assert.ok(sentMessages.length >= 1, 'Should send welcome message using fallback');
  const mentions = sentMessages[0].options?.mentions;
  assert.ok(Array.isArray(mentions));
  assert.equal(mentions.length, 2);
  assert.deepEqual(mentions.sort(), ['error@c.us', 'player2@c.us'].sort());
}

console.log('--- ALL WELCOME TESTS PASSED SUCCESSFULLY ---');
