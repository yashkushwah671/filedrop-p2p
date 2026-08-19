package com.filedrop.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.filedrop.dto.SignalMessage;
import com.filedrop.entity.RoomStatus;
import com.filedrop.service.RoomService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class SignalingWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper;
    private final RoomService roomService;

    // Room Code -> RoomSessions
    private final Map<String, RoomSessions> rooms = new ConcurrentHashMap<>();
    // Session ID -> Room Code
    private final Map<String, String> sessionToRoom = new ConcurrentHashMap<>();
    // Session ID -> Role ("sender" or "receiver")
    private final Map<String, String> sessionToRole = new ConcurrentHashMap<>();

    private static class RoomSessions {
        WebSocketSession sender;
        WebSocketSession receiver;

        synchronized boolean setSender(WebSocketSession session) {
            this.sender = session;
            return true;
        }

        synchronized boolean setReceiver(WebSocketSession session) {
            if (this.receiver != null && this.receiver.isOpen() && !this.receiver.getId().equals(session.getId())) {
                return false; // Receiver slot is already occupied!
            }
            this.receiver = session;
            return true;
        }

        synchronized WebSocketSession getOther(WebSocketSession session) {
            if (sender != null && sender.getId().equals(session.getId())) {
                return receiver;
            }
            if (receiver != null && receiver.getId().equals(session.getId())) {
                return sender;
            }
            return null;
        }

        synchronized boolean isEmpty() {
            boolean senderClosed = (sender == null || !sender.isOpen());
            boolean receiverClosed = (receiver == null || !receiver.isOpen());
            return senderClosed && receiverClosed;
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.debug("WebSocket connection opened: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        SignalMessage signal;
        try {
            signal = objectMapper.readValue(payload, SignalMessage.class);
        } catch (Exception e) {
            log.warn("Invalid signal message payload from {}: {}", session.getId(), payload);
            sendDirect(session, SignalMessage.ofError(null, "Malformed JSON message"));
            return;
        }

        String type = signal.getType() != null ? signal.getType().toLowerCase() : "";
        String roomCode = signal.getRoomId() != null ? signal.getRoomId().trim().toUpperCase() : null;

        if ("ping".equals(type)) {
            sendDirect(session, SignalMessage.builder().type("pong").timestamp(System.currentTimeMillis()).build());
            return;
        }

        if (roomCode == null || roomCode.isEmpty()) {
            sendDirect(session, SignalMessage.ofError(null, "Room code is required"));
            return;
        }

        switch (type) {
            case "join" -> handleJoin(session, signal, roomCode);
            case "offer", "answer", "ice-candidate", "ready", "file-meta", "transfer-progress", "transfer-complete" -> forwardToPeer(session, signal, roomCode);
            case "leave" -> handleLeave(session, roomCode);
            default -> log.warn("Unhandled signaling message type '{}' from session {}", type, session.getId());
        }
    }

    private void handleJoin(WebSocketSession session, SignalMessage signal, String roomCode) throws IOException {
        String role = signal.getRole() != null ? signal.getRole().toLowerCase() : "receiver";
        String pin = signal.getPin();

        // Validate access and PIN with RoomService
        try {
            boolean valid = roomService.validateRoomAccess(roomCode, pin);
            if (!valid) {
                sendDirect(session, SignalMessage.ofError(roomCode, "Invalid PIN code for room " + roomCode));
                return;
            }
        } catch (Exception e) {
            sendDirect(session, SignalMessage.ofError(roomCode, e.getMessage()));
            return;
        }

        RoomSessions roomSessions = rooms.computeIfAbsent(roomCode, k -> new RoomSessions());

        if ("sender".equals(role)) {
            roomSessions.setSender(session);
        } else {
            boolean joined = roomSessions.setReceiver(session);
            if (!joined) {
                sendDirect(session, SignalMessage.ofError(roomCode, "Room " + roomCode + " is full. Only 2 peers allowed."));
                return;
            }
        }

        sessionToRoom.put(session.getId(), roomCode);
        sessionToRole.put(session.getId(), role);

        try {
            roomService.registerPeerConnection(roomCode, role, session.getId());
        } catch (Exception e) {
            sendDirect(session, SignalMessage.ofError(roomCode, e.getMessage()));
            return;
        }

        log.info("Session {} joined room {} as {}", session.getId(), roomCode, role);

        // Notify joiner that join succeeded
        sendDirect(session, SignalMessage.builder()
                .type("joined")
                .roomId(roomCode)
                .role(role)
                .message("Joined room successfully")
                .timestamp(System.currentTimeMillis())
                .build());

        // Check if both peers are present
        if (roomSessions.sender != null && roomSessions.sender.isOpen() &&
            roomSessions.receiver != null && roomSessions.receiver.isOpen()) {
            
            log.info("Both peers connected in room {}. Initiating WebRTC handshake.", roomCode);
            
            // Notify Sender that receiver is ready to receive offer
            sendDirect(roomSessions.sender, SignalMessage.builder()
                    .type("peer-joined")
                    .roomId(roomCode)
                    .role("sender")
                    .message("Receiver has joined. You may now create SDP offer.")
                    .timestamp(System.currentTimeMillis())
                    .build());

            // Notify Receiver that sender is online
            sendDirect(roomSessions.receiver, SignalMessage.builder()
                    .type("peer-joined")
                    .roomId(roomCode)
                    .role("receiver")
                    .message("Connected to sender. Awaiting SDP offer.")
                    .timestamp(System.currentTimeMillis())
                    .build());
        }
    }

    private void forwardToPeer(WebSocketSession session, SignalMessage signal, String roomCode) throws IOException {
        RoomSessions roomSessions = rooms.get(roomCode);
        if (roomSessions == null) {
            sendDirect(session, SignalMessage.ofError(roomCode, "Room does not exist or has been closed."));
            return;
        }

        WebSocketSession peer = roomSessions.getOther(session);
        if (peer != null && peer.isOpen()) {
            sendDirect(peer, signal);
        } else {
            log.debug("No active peer in room {} to receive {}", roomCode, signal.getType());
        }
    }

    private void handleLeave(WebSocketSession session, String roomCode) {
        cleanupSession(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("WebSocket connection closed: {} (Status: {})", session.getId(), status);
        cleanupSession(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("WebSocket transport error for session {}: {}", session.getId(), exception.getMessage());
        cleanupSession(session);
    }

    private void cleanupSession(WebSocketSession session) {
        String sessionId = session.getId();
        String roomCode = sessionToRoom.remove(sessionId);
        String role = sessionToRole.remove(sessionId);

        if (roomCode != null) {
            RoomSessions roomSessions = rooms.get(roomCode);
            if (roomSessions != null) {
                WebSocketSession otherPeer = roomSessions.getOther(session);
                if (otherPeer != null && otherPeer.isOpen()) {
                    try {
                        sendDirect(otherPeer, SignalMessage.builder()
                                .type("peer-left")
                                .roomId(roomCode)
                                .role(role)
                                .message("Peer has disconnected.")
                                .timestamp(System.currentTimeMillis())
                                .build());
                    } catch (IOException e) {
                        log.warn("Failed to notify peer of disconnection: {}", e.getMessage());
                    }
                }

                if (session.equals(roomSessions.sender)) {
                    roomSessions.sender = null;
                }
                if (session.equals(roomSessions.receiver)) {
                    roomSessions.receiver = null;
                }

                if (roomSessions.isEmpty()) {
                    rooms.remove(roomCode);
                }
            }

            roomService.unregisterPeerConnection(sessionId);
        }
    }

    private void sendDirect(WebSocketSession session, SignalMessage message) throws IOException {
        if (session != null && session.isOpen()) {
            synchronized (session) {
                String text = objectMapper.writeValueAsString(message);
                session.sendMessage(new TextMessage(text));
            }
        }
    }
}
