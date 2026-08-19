/**
 * WebRTC PeerConnection Manager for FileDrop
 * Handles RTCPeerConnection lifecycle, STUN server ICE gathering, SDP Offer/Answer negotiation, and DataChannel.
 */
class WebRTCManager {
    constructor(signalingClient, isInitiator = false) {
        this.signaling = signalingClient;
        this.isInitiator = isInitiator;
        this.peerConnection = null;
        this.dataChannel = null;
        this.iceCandidatesQueue = [];
        this.handlers = new Map();

        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        this.signalingListeners = [];
        this.setupSignalingListeners();
    }

    setupSignalingListeners() {
        this.cleanupSignalingListeners();

        const addListener = (type, handler) => {
            this.signaling.on(type, handler);
            this.signalingListeners.push({ type, handler });
        };

        // When peer joins and we are the sender (initiator), create and send Offer
        addListener('peer-joined', async (msg) => {
            console.log('[WebRTC] Peer joined room:', msg);
            if (this.isInitiator) {
                await this.initiateOffer();
            }
        });

        // Handle incoming SDP Offer
        addListener('offer', async (msg) => {
            console.log('[WebRTC] Received remote SDP Offer');
            await this.handleRemoteOffer(msg.payload);
        });

        // Handle incoming SDP Answer
        addListener('answer', async (msg) => {
            console.log('[WebRTC] Received remote SDP Answer');
            await this.handleRemoteAnswer(msg.payload);
        });

        // Handle incoming ICE Candidate
        addListener('ice-candidate', async (msg) => {
            await this.handleRemoteIceCandidate(msg.payload);
        });

        // Handle peer left
        addListener('peer-left', (msg) => {
            console.warn('[WebRTC] Peer left room:', msg);
            this.emit('peer-disconnected', msg);
            this.close();
        });
    }

    cleanupSignalingListeners() {
        if (this.signalingListeners && this.signalingListeners.length > 0) {
            this.signalingListeners.forEach(({ type, handler }) => {
                this.signaling.off(type, handler);
            });
            this.signalingListeners = [];
        }
    }

    initializePeerConnection() {
        if (this.peerConnection) {
            try { this.peerConnection.close(); } catch (e) {}
            this.peerConnection = null;
        }

        console.log('[WebRTC] Initializing RTCPeerConnection...');
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        // ICE candidate handler
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[WebRTC] Generated ICE candidate:', event.candidate.candidate);
                this.signaling.sendSignal('ice-candidate', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
            }
        };

        // Connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection ? this.peerConnection.connectionState : 'closed';
            console.log('[WebRTC] Connection state changed to:', state);
            this.emit('connection-state-change', state);
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const iceState = this.peerConnection ? this.peerConnection.iceConnectionState : 'closed';
            console.log('[WebRTC] ICE connection state changed to:', iceState);
            this.emit('ice-state-change', iceState);
        };

        if (this.isInitiator) {
            // Sender creates the DataChannel
            console.log('[WebRTC] Creating DataChannel as initiator...');
            const dc = this.peerConnection.createDataChannel('filedrop-data-channel', {
                ordered: true
            });
            this.setupDataChannel(dc);
        } else {
            // Receiver listens for DataChannel
            this.peerConnection.ondatachannel = (event) => {
                console.log('[WebRTC] Received remote DataChannel:', event.channel.label);
                this.setupDataChannel(event.channel);
            };
        }
    }

    setupDataChannel(dataChannel) {
        this.dataChannel = dataChannel;
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            console.log('[WebRTC] RTCDataChannel is OPEN and ready for P2P transfer!');
            this.emit('datachannel-open', this.dataChannel);
        };

        this.dataChannel.onclose = () => {
            console.log('[WebRTC] RTCDataChannel is CLOSED.');
            this.emit('datachannel-close');
        };

        this.dataChannel.onerror = (err) => {
            console.error('[WebRTC] RTCDataChannel error:', err);
            this.emit('datachannel-error', err);
        };

        this.dataChannel.onmessage = (event) => {
            this.emit('datachannel-message', event.data);
        };
    }

    async initiateOffer() {
        try {
            this.initializePeerConnection();
            console.log('[WebRTC] Creating SDP Offer...');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            console.log('[WebRTC] Sending SDP Offer via signaling...');
            this.signaling.sendSignal('offer', {
                type: offer.type,
                sdp: offer.sdp
            });
        } catch (err) {
            console.error('[WebRTC] Error initiating offer:', err);
            this.emit('error', err);
        }
    }

    async handleRemoteOffer(offerData) {
        try {
            this.initializePeerConnection();
            console.log('[WebRTC] Setting Remote Description (Offer)...');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));

            // Drain queued ICE candidates if any
            await this.drainIceQueue();

            console.log('[WebRTC] Creating SDP Answer...');
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            console.log('[WebRTC] Sending SDP Answer via signaling...');
            this.signaling.sendSignal('answer', {
                type: answer.type,
                sdp: answer.sdp
            });
        } catch (err) {
            console.error('[WebRTC] Error handling remote offer:', err);
            this.emit('error', err);
        }
    }

    async handleRemoteAnswer(answerData) {
        try {
            console.log('[WebRTC] Setting Remote Description (Answer)...');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));
            await this.drainIceQueue();
        } catch (err) {
            console.error('[WebRTC] Error handling remote answer:', err);
            this.emit('error', err);
        }
    }

    async handleRemoteIceCandidate(candidateData) {
        if (!candidateData) return;
        try {
            const candidate = new RTCIceCandidate(candidateData);
            if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
                await this.peerConnection.addIceCandidate(candidate);
                console.log('[WebRTC] Added remote ICE candidate successfully.');
            } else {
                console.log('[WebRTC] Queuing ICE candidate (remote description not ready yet).');
                this.iceCandidatesQueue.push(candidate);
            }
        } catch (err) {
            console.error('[WebRTC] Error adding remote ICE candidate:', err);
        }
    }

    async drainIceQueue() {
        while (this.iceCandidatesQueue.length > 0) {
            const candidate = this.iceCandidatesQueue.shift();
            try {
                await this.peerConnection.addIceCandidate(candidate);
                console.log('[WebRTC] Drained queued ICE candidate successfully.');
            } catch (err) {
                console.error('[WebRTC] Error draining queued ICE candidate:', err);
            }
        }
    }

    on(event, callback) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(callback);
    }

    emit(event, data) {
        if (this.handlers.has(event)) {
            this.handlers.get(event).forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Error in WebRTC event handler '${event}':`, e); }
            });
        }
    }

    close() {
        this.cleanupSignalingListeners();
        if (this.dataChannel) {
            try { this.dataChannel.close(); } catch (e) {}
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            try { this.peerConnection.close(); } catch (e) {}
            this.peerConnection = null;
        }
        this.iceCandidatesQueue = [];
    }
}
