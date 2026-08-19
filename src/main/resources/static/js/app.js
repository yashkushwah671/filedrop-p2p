/**
 * FileDrop - Main Application Controller
 * Orchestrates Signaling, WebRTC, File Transfer Engine, and UI.
 */
class FileDropApp {
    constructor() {
        this.ui = new UIManager();
        this.signaling = new SignalingClient();
        this.webrtc = null;
        this.fileEngine = null;

        this.role = null; // 'sender' or 'receiver'
        this.roomCode = null;
        this.pin = null;

        this.init();
    }

    async init() {
        console.log('[FileDrop] Initializing application...');

        // Connect WebSocket Signaling
        try {
            await this.signaling.connect();
            this.updateConnectionStatus(true);
        } catch (e) {
            console.error('[FileDrop] Initial signaling connection failed:', e);
            this.updateConnectionStatus(false);
        }

        this.setupSignalingEvents();
        this.setupUIEvents();
        this.checkUrlParams();
    }

    updateConnectionStatus(connected) {
        if (this.ui.wsStatusDot && this.ui.wsStatusText) {
            if (connected) {
                this.ui.wsStatusDot.className = 'status-dot';
                this.ui.wsStatusText.textContent = 'Signaling Online';
            } else {
                this.ui.wsStatusDot.className = 'status-dot disconnected';
                this.ui.wsStatusText.textContent = 'Signaling Disconnected';
            }
        }
    }

    setupSignalingEvents() {
        this.signaling.on('close', () => {
            this.updateConnectionStatus(false);
            this.ui.showToast('Signaling server disconnected. Reconnecting...', 'warning');
            setTimeout(() => {
                this.signaling.connect().then(() => this.updateConnectionStatus(true)).catch(() => {});
            }, 3000);
        });

        this.signaling.on('error', (err) => {
            this.ui.showToast(err.message || 'Signaling error', 'error');
            this.ui.logEvent(`Signaling Error: ${err.message}`, 'error');
        });

        this.signaling.on('joined', (msg) => {
            console.log('[FileDrop] Joined room successfully:', msg);
            this.ui.logEvent(`Registered as ${msg.role} in room ${msg.roomId}`, 'info');
        });
    }

    setupUIEvents() {
        // Create Room Button on Landing
        document.getElementById('btnStartCreateFlow')?.addEventListener('click', () => {
            this.startCreateFlow();
        });

        // Join Room Button on Landing
        document.getElementById('btnStartJoinFlow')?.addEventListener('click', () => {
            this.ui.switchView('join');
        });

        // Submit Join Room Button
        this.ui.btnSubmitJoin?.addEventListener('click', () => {
            this.joinExistingRoom();
        });

        // Start Transfer (Sender clicks after selecting files)
        this.ui.btnStartTransfer?.addEventListener('click', () => {
            this.confirmSenderFiles();
        });

        // Cancel / New Transfer Buttons in Dashboard
        this.ui.btnCancelTransfer?.addEventListener('click', () => {
            if (this.fileEngine) {
                this.fileEngine.cancelTransfer();
            }
            this.ui.showToast('Transfer cancelled.', 'warning');
        });

        this.ui.btnNewTransfer?.addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        let roomParam = urlParams.get('room');
        
        // Also check if path has /join/CODE
        const pathMatch = window.location.pathname.match(/\/join\/([A-Za-z0-9]+)/);
        if (pathMatch && pathMatch[1]) {
            roomParam = pathMatch[1];
        }

        if (roomParam) {
            console.log('[FileDrop] Found room code in URL:', roomParam);
            this.ui.setEnteredRoomCode(roomParam);
            this.ui.switchView('join');
            this.ui.showToast(`Room code ${roomParam} detected! Click Join to connect.`, 'info');
        }
    }

    // =========================================================================
    // SENDER WORKFLOW
    // =========================================================================

    async startCreateFlow() {
        try {
            const pin = this.ui.inputRoomPin?.value.trim() || null;
            const res = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: pin })
            });

            if (!res.ok) throw new Error('Failed to generate room code.');
            const roomData = await res.json();

            this.roomCode = roomData.roomCode;
            this.role = 'sender';
            this.pin = pin;

            this.ui.renderRoomCode(this.roomCode);
            this.ui.switchView('create');

            // Join the signaling room as sender
            if (!this.signaling.isConnected) {
                await this.signaling.connect();
            }
            this.signaling.join(this.roomCode, 'sender', this.pin);

            // Initialize WebRTC as initiator
            this.setupWebRTC(true);

        } catch (e) {
            console.error('[FileDrop] Error creating room:', e);
            this.ui.showToast(e.message || 'Error creating room', 'error');
        }
    }

    confirmSenderFiles() {
        if (this.ui.selectedFiles.length === 0) {
            this.ui.showToast('Please select at least one file to transfer.', 'warning');
            return;
        }

        this.ui.showToast('Waiting for receiver to connect...', 'info');
        this.ui.logEvent(`Ready to transfer ${this.ui.selectedFiles.length} file(s). Awaiting receiver.`, 'info');
    }

    // =========================================================================
    // RECEIVER WORKFLOW
    // =========================================================================

    async joinExistingRoom() {
        const code = this.ui.getEnteredRoomCode();
        if (!code || code.length < 4) {
            this.ui.showToast('Please enter a valid room code.', 'warning');
            return;
        }

        const pin = this.ui.joinPinInput?.value.trim() || null;
        this.roomCode = code;
        this.role = 'receiver';
        this.pin = pin;

        try {
            // Verify room with backend
            const verifyRes = await fetch(`/api/rooms/${this.roomCode}${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`);
            if (!verifyRes.ok) {
                const errData = await verifyRes.json();
                throw new Error(errData.message || 'Invalid or expired room code.');
            }

            if (!this.signaling.isConnected) {
                await this.signaling.connect();
            }

            // Setup WebRTC as non-initiator
            this.setupWebRTC(false);

            // Join signaling room
            this.signaling.join(this.roomCode, 'receiver', this.pin);
            this.ui.showToast(`Joining room ${this.roomCode}...`, 'info');

        } catch (e) {
            console.error('[FileDrop] Join error:', e);
            this.ui.showToast(e.message, 'error');
        }
    }

    // =========================================================================
    // WEBRTC & DATACHANNEL SETUP
    // =========================================================================

    setupWebRTC(isInitiator) {
        if (this.webrtc) {
            this.webrtc.close();
        }

        this.webrtc = new WebRTCManager(this.signaling, isInitiator);

        this.webrtc.on('connection-state-change', (state) => {
            console.log('[FileDrop] WebRTC Connection State:', state);
            if (this.ui.peerStatusText) {
                this.ui.peerStatusText.textContent = `P2P State: ${state.toUpperCase()}`;
            }
            if (state === 'connected') {
                this.ui.playAudioCue('connect');
                this.ui.logEvent('WebRTC P2P direct connection established!', 'success');
            } else if (state === 'failed' || state === 'disconnected') {
                this.ui.logEvent('WebRTC peer disconnected.', 'warn');
                this.ui.showToast('Peer disconnected.', 'warning');
            }
        });

        this.webrtc.on('datachannel-open', (dataChannel) => {
            console.log('[FileDrop] DataChannel OPENED! Starting FileTransferEngine.');
            this.ui.playAudioCue('connect');
            this.ui.showToast('P2P DataChannel Connected!', 'success');
            this.ui.logEvent('Encrypted WebRTC DataChannel ready for file stream.', 'success');

            this.fileEngine = new FileTransferEngine(dataChannel);
            this.bindFileEngineEvents();

            if (this.role === 'sender') {
                // Switch sender to dashboard and begin streaming selected files
                this.ui.initDashboard('sender', this.roomCode, this.ui.selectedFiles);
                this.fileEngine.sendFiles(this.ui.selectedFiles).catch(err => {
                    console.error('[FileDrop] File send error:', err);
                    this.ui.showToast(`Transfer error: ${err.message}`, 'error');
                });
            } else {
                // Switch receiver to dashboard
                this.ui.initDashboard('receiver', this.roomCode, []);
            }
        });

        this.webrtc.on('peer-disconnected', () => {
            this.ui.logEvent('Peer closed connection.', 'warn');
            this.ui.showToast('Remote peer disconnected.', 'warning');
        });
    }

    bindFileEngineEvents() {
        this.fileEngine.on('batch-start', (msg) => {
            console.log('[FileDrop] Receiver got batch start:', msg);
            this.ui.renderQueue(msg.files || []);
            this.ui.logEvent(`Incoming transfer of ${msg.fileCount} file(s) (${this.ui.formatBytes(msg.totalBytes)})...`, 'info');
        });

        this.fileEngine.on('file-start', (fileInfo) => {
            this.ui.logEvent(`Transferring file ${fileInfo.index + 1}: ${fileInfo.name}`, 'info');
        });

        this.fileEngine.on('progress', (telemetry) => {
            this.ui.updateTelemetryUI(telemetry);
        });

        this.fileEngine.on('file-received', (fileRecord) => {
            console.log('[FileDrop] Receiver reconstructed file:', fileRecord.name);
            this.ui.markFileCompleted(fileRecord.index, fileRecord);
            this.ui.logEvent(`Finished downloading ${fileRecord.name}`, 'success');
        });

        this.fileEngine.on('transfer-complete', (info) => {
            this.ui.markTransferFinished(info.totalFiles, info.totalBytes);

            // Notify backend transfer audit
            fetch('/api/transfers/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomCode: this.roomCode,
                    totalFiles: info.totalFiles,
                    totalBytes: info.totalBytes,
                    status: 'COMPLETED'
                })
            }).catch(() => {});
        });

        this.fileEngine.on('transfer-cancelled', () => {
            this.ui.showToast('Transfer was cancelled by remote peer.', 'warning');
            this.ui.logEvent('Transfer cancelled.', 'warn');
        });
    }
}

// Bootstrap Application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new FileDropApp();
});
