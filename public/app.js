// Check for token in URL (from QR code)
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
  localStorage.setItem('nanoClaw_token', urlToken);
  // Clean URL without reloading
  window.history.replaceState({}, document.title, window.location.pathname);
}

// App State
const state = {
  token: localStorage.getItem('nanoClaw_token'),
  currentConversation: null,
  conversations: [],
  messages: new Map(), // Map<jid, messages[]>
  ws: null,
  lastMessageTimestamp: new Map(), // Map<jid, timestamp>
};

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menu-btn');
const closeSidebarBtn = document.getElementById('close-sidebar');
const logoutBtn = document.getElementById('logout-btn');
const conversationsList = document.getElementById('conversations-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const chatTitle = document.getElementById('chat-title');
const connectionStatus = document.getElementById('connection-status');
const refreshBtn = document.getElementById('refresh-btn');

// Markdown configuration
marked.setOptions({
  highlight: function(code, lang) {
    return code; // Basic highlighting, can be enhanced with highlight.js
  },
  breaks: true,
  gfm: true,
});

// Initialize app
function init() {
  if (state.token) {
    showChatScreen();
    connectWebSocket();
    loadConversations();
  } else {
    showLoginScreen();
  }

  setupEventListeners();
}

function setupEventListeners() {
  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  menuBtn.addEventListener('click', toggleSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sendBtn.addEventListener('click', handleSendMessage);
  messageInput.addEventListener('keydown', handleInputKeydown);
  messageInput.addEventListener('input', autoResizeTextarea);
  refreshBtn.addEventListener('click', handleRefresh);

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('Service worker registration failed:', err);
    });
  }
}

// Auth
async function handleLogin(e) {
  e.preventDefault();
  const tokenOrPassword = document.getElementById('password').value;

  // Try as direct token first
  try {
    const response = await fetch('/api/conversations', {
      headers: {
        'Authorization': `Bearer ${tokenOrPassword}`,
      },
    });

    if (response.ok) {
      // It's a valid token!
      state.token = tokenOrPassword;
      localStorage.setItem('nanoClaw_token', tokenOrPassword);
      showChatScreen();
      connectWebSocket();
      loadConversations();
      return;
    }
  } catch (err) {
    // Not a valid token, try as password
  }

  // Try as password to generate token
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: tokenOrPassword, deviceName: 'PWA' }),
    });

    const data = await response.json();

    if (!response.ok) {
      loginError.textContent = 'Token invalide';
      return;
    }

    state.token = data.token;
    localStorage.setItem('nanoClaw_token', data.token);
    showChatScreen();
    connectWebSocket();
    loadConversations();
  } catch (err) {
    console.error('Login error:', err);
    loginError.textContent = 'Erreur de connexion au serveur';
  }
}

function handleLogout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    state.token = null;
    localStorage.removeItem('nanoClaw_token');
    if (state.ws) {
      state.ws.close();
    }
    showLoginScreen();
  }
}

function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
}

function showChatScreen() {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

// WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${state.token}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
    connectionStatus.classList.add('connected');
  };

  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
    connectionStatus.classList.remove('connected');
    // Reconnect after 3 seconds
    setTimeout(() => {
      if (state.token) {
        connectWebSocket();
      }
    }, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    connectionStatus.classList.remove('connected');
  };

  state.ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };

  // Send ping every 30 seconds to keep connection alive
  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'connected':
      console.log('WebSocket connection established');
      break;

    case 'message':
      handleNewMessage(message.data);
      break;

    case 'pong':
      // Keep-alive response
      break;

    default:
      console.log('Unknown message type:', message.type);
  }
}

function handleNewMessage(message) {
  const { chat_jid, sender_name, content, timestamp } = message;

  // Add to messages map
  if (!state.messages.has(chat_jid)) {
    state.messages.set(chat_jid, []);
  }
  state.messages.get(chat_jid).push(message);
  state.lastMessageTimestamp.set(chat_jid, timestamp);

  // Update UI if this is the current conversation
  if (state.currentConversation?.jid === chat_jid) {
    appendMessage(message);
    scrollToBottom();
  }

  // Show notification if not focused and not from user
  if (document.hidden && sender_name !== 'You') {
    showNotification(sender_name, content);
  }

  // Play sound
  playNotificationSound();
}

// Conversations
async function loadConversations() {
  try {
    const response = await fetch('/api/conversations', {
      headers: {
        'Authorization': `Bearer ${state.token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        handleLogout();
        return;
      }
      throw new Error('Failed to load conversations');
    }

    const data = await response.json();
    state.conversations = data.conversations;
    renderConversations();
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

function renderConversations() {
  conversationsList.innerHTML = '';

  if (state.conversations.length === 0) {
    conversationsList.innerHTML = '<p style="padding: 1rem; color: var(--text-secondary);">Aucune conversation</p>';
    return;
  }

  state.conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (state.currentConversation?.jid === conv.jid) {
      item.classList.add('active');
    }

    item.innerHTML = `
      <h4>${escapeHtml(conv.name)}</h4>
      <p>${new Date(conv.lastActivity).toLocaleString('fr-FR')}</p>
    `;

    item.addEventListener('click', () => selectConversation(conv));
    conversationsList.appendChild(item);
  });

  // Auto-select first conversation if none selected
  if (!state.currentConversation && state.conversations.length > 0) {
    selectConversation(state.conversations[0]);
  }
}

async function selectConversation(conv) {
  state.currentConversation = conv;
  chatTitle.textContent = conv.name;
  messageInput.disabled = false;
  sendBtn.disabled = false;

  // Update active state
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.classList.remove('active');
  });
  if (event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    closeSidebar();
  }

  // Load messages
  await loadMessages(conv.jid);
}

async function loadMessages(jid) {
  try {
    const since = state.lastMessageTimestamp.get(jid) || '';
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(jid)}/messages?since=${encodeURIComponent(since)}`,
      {
        headers: {
          'Authorization': `Bearer ${state.token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load messages');
    }

    const data = await response.json();

    // Store messages
    if (!state.messages.has(jid)) {
      state.messages.set(jid, []);
    }

    // Add new messages
    const existingMessages = state.messages.get(jid);
    data.messages.forEach(msg => {
      if (!existingMessages.find(m => m.id === msg.id)) {
        existingMessages.push(msg);
      }
    });

    // Update last timestamp
    if (data.messages.length > 0) {
      const lastMsg = data.messages[data.messages.length - 1];
      state.lastMessageTimestamp.set(jid, lastMsg.timestamp);
    }

    // Render messages
    renderMessages(jid);
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function renderMessages(jid) {
  messagesContainer.innerHTML = '';

  const messages = state.messages.get(jid) || [];

  if (messages.length === 0) {
    messagesContainer.innerHTML = '<div class="empty-state"><p>Aucun message</p></div>';
    return;
  }

  messages.forEach(msg => appendMessage(msg));
  scrollToBottom();
}

function appendMessage(msg) {
  const messageDiv = document.createElement('div');

  const isUser = msg.sender_name === 'You' || msg.is_from_me;
  const isAssistant = msg.content.startsWith('Jimmy:') || msg.content.startsWith('Andy:');

  let messageType = 'other';
  let displayName = msg.sender_name;
  let content = msg.content;

  if (isUser) {
    messageType = 'user';
  } else if (isAssistant) {
    messageType = 'assistant';
    // Extract assistant name and content
    const match = content.match(/^(\w+):\s*(.+)$/s);
    if (match) {
      displayName = match[1];
      content = match[2];
    }
  }

  messageDiv.className = `message ${messageType}`;

  const avatar = getInitials(displayName);
  const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Render markdown with code highlighting
  const htmlContent = marked.parse(content);
  const sanitizedContent = DOMPurify.sanitize(htmlContent);

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-sender">${escapeHtml(displayName)}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-text">${sanitizedContent}</div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
}

function getInitials(name) {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

// Send message
async function handleSendMessage() {
  const content = messageInput.value.trim();

  if (!content || !state.currentConversation) {
    return;
  }

  const jid = state.currentConversation.jid;

  // Clear input immediately
  messageInput.value = '';
  autoResizeTextarea();

  // Add user message to UI immediately (optimistic update)
  const msg = {
    id: Date.now().toString(),
    chat_jid: jid,
    sender_name: 'You',
    content,
    timestamp: new Date().toISOString(),
    is_from_me: true,
  };

  if (!state.messages.has(jid)) {
    state.messages.set(jid, []);
  }
  state.messages.get(jid).push(msg);

  appendMessage(msg);
  scrollToBottom();

  // Send to API in background
  try {
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(jid)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    // Message sent successfully - response will come via WebSocket
  } catch (err) {
    console.error('Error sending message:', err);
    alert('Échec de l\'envoi du message');
    // TODO: Remove the optimistic message or mark as failed
  }
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
}

function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}

// UI helpers
function toggleSidebar() {
  sidebar.classList.toggle('closed');
}

function closeSidebar() {
  sidebar.classList.add('closed');
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function handleRefresh() {
  await loadConversations();
  if (state.currentConversation) {
    await loadMessages(state.currentConversation.jid);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Notifications
function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body.substring(0, 100),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'nanoclaw-message',
    });
  }
}

function playNotificationSound() {
  // Simple beep using Web Audio API
  if ('AudioContext' in window) {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
