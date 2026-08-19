/**
 * WebSocket Signaling Client for FileDrop
 * Manages WebSocket connection to Spring Boot signaling server (/ws).
 */
class SignalingClient {
    constructor() {
        this.ws = null;
        this.roomId = null;
        this.role = null; // 'sender' or 'receiver'
        this.pin = null;
        this.isConnected = false;
        this.handlers = new Map();
        this.pingInterval = null;
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;

            console.log(`[Signaling] Connecting to ${wsUrl}...`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[Signaling] WebSocket connected.');
                this.isConnected = true;
                this.startHeartbeat();
                if (this.roomId && this.role) {
                    console.log(`[Signaling] Automatically rejoining room ${this.roomId} as ${this.role}`);
                    this.join(this.roomId, this.role, this.pin);
                }
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (e) {
                    console.error('[Signaling] Failed to parse message:', event.data, e);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[Signaling] WebSocket error:', error);
                this.isConnected = false;
                this.emit('error', { message: 'WebSocket signaling connection failed.' });
            };

            this.ws.onclose = (event) => {
                console.log('[Signaling] WebSocket closed:', event.code, event.reason);
                this.isConnected = false;
                this.stopHeartbeat();
                this.emit('close', event);
            };
        });
    }

    removeAllListeners(type) {
        if (type) {
            this.handlers.delete(type.toLowerCase());
        } else {
            this.handlers.clear();
        }
    }

    join(roomId, role, pin = null) {
        this.roomId = roomId.toUpperCase();
        this.role = role;
        this.pin = pin;

        this.send({
            type: 'join',
            roomId: this.roomId,
            role: this.role,
            pin: this.pin
        });
    }

    sendSignal(type, payload = null) {
        this.send({
            type: type,
            roomId: this.roomId,
            role: this.role,
            payload: payload
        });
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            data.timestamp = Date.now();
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('[Signaling] Cannot send message, WebSocket not OPEN:', data);
        }
    }

    handleMessage(msg) {
        const type = msg.type ? msg.type.toLowerCase() : '';
        if (type === 'pong') return; // Heartbeat reply

        console.log(`[Signaling] Received '${type}' for room ${msg.roomId}:`, msg);

        // Call registered handlers
        if (this.handlers.has(type)) {
            const callbacks = this.handlers.get(type);
            callbacks.forEach(cb => {
                try { cb(msg); } catch (e) { console.error(`Error in signaling handler '${type}':`, e); }
            });
        }

        // Also emit general 'message'
        if (this.handlers.has('message')) {
            this.handlers.get('message').forEach(cb => cb(msg));
        }
    }

    on(type, callback) {
        const key = type.toLowerCase();
        if (!this.handlers.has(key)) {
            this.handlers.set(key, []);
        }
        this.handlers.get(key).push(callback);
    }

    off(type, callback) {
        const key = type.toLowerCase();
        if (this.handlers.has(key)) {
            const list = this.handlers.get(key).filter(cb => cb !== callback);
            this.handlers.set(key, list);
        }
    }

    emit(type, data) {
        const key = type.toLowerCase();
        if (this.handlers.has(key)) {
            this.handlers.get(key).forEach(cb => cb(data));
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, 20000);
    }

    stopHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    disconnect() {
        this.stopHeartbeat();
        if (this.ws) {
            try {
                if (this.roomId) {
                    this.send({ type: 'leave', roomId: this.roomId });
                }
                this.ws.close();
            } catch (e) {
                console.warn('[Signaling] Error during close:', e);
            }
            this.ws = null;
        }
        this.isConnected = false;
    }
}
