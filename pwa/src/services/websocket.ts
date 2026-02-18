import type { WsMessage } from '../types/websocket';

type WsMessageHandler = (message: WsMessage) => void;
type WsStatusHandler = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

const PING_INTERVAL = 30_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

class WebSocketService {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private onMessage: WsMessageHandler | null = null;
  private onStatus: WsStatusHandler | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect(token: string, onMessage: WsMessageHandler, onStatus: WsStatusHandler): void {
    this.token = token;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
  }

  private open(): void {
    if (this.ws) {
      this.cleanup();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${this.token}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        this.onMessage?.(message);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (!this.intentionalClose) {
        this.onStatus?.('disconnected');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]!;
    this.reconnectAttempt++;
    this.onStatus?.('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.open();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

export const wsService = new WebSocketService();
