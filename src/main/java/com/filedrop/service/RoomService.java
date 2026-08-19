package com.filedrop.service;

import com.filedrop.dto.*;
import com.filedrop.entity.Room;
import com.filedrop.entity.RoomStatus;
import com.filedrop.entity.TransferSession;
import com.filedrop.exception.InvalidPinException;
import com.filedrop.exception.RoomFullException;
import com.filedrop.exception.RoomNotFoundException;
import com.filedrop.repository.RoomRepository;
import com.filedrop.repository.TransferSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class RoomService {

    private final RoomRepository roomRepository;
    private final TransferSessionRepository transferSessionRepository;

    @Value("${filedrop.room.expiration-minutes:60}")
    private int expirationMinutes;

    private static final String CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final int CODE_LENGTH = 6;
    private final SecureRandom secureRandom = new SecureRandom();

    @Transactional
    public RoomResponse createRoom(CreateRoomRequest request) {
        String roomCode = generateUniqueRoomCode();
        String pinHash = (request != null && request.getPin() != null && !request.getPin().trim().isEmpty())
                ? hashPin(request.getPin().trim())
                : null;

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expiresAt = now.plusMinutes(expirationMinutes);

        Room room = Room.builder()
                .roomCode(roomCode)
                .pinHash(pinHash)
                .status(RoomStatus.WAITING)
                .createdAt(now)
                .updatedAt(now)
                .expiresAt(expiresAt)
                .build();

        room = roomRepository.save(room);
        log.info("Created new transfer room: {} (expires: {})", roomCode, expiresAt);

        // Record initial transfer audit entry
        TransferSession session = TransferSession.builder()
                .roomCode(roomCode)
                .totalFiles((request != null && request.getTotalFiles() != null) ? request.getTotalFiles() : 1)
                .totalBytes((request != null && request.getTotalBytes() != null) ? request.getTotalBytes() : 0L)
                .status("INITIALIZED")
                .startedAt(now)
                .build();
        transferSessionRepository.save(session);

        return mapToResponse(room);
    }

    @Transactional(readOnly = true)
    public RoomResponse getRoomStatus(String roomCode, String pin) {
        Room room = findActiveRoomOrThrow(roomCode);

        // If room is protected with PIN, verify it
        if (room.getPinHash() != null) {
            if (pin == null || !hashPin(pin.trim()).equals(room.getPinHash())) {
                throw new InvalidPinException("Invalid PIN for room: " + roomCode);
            }
        }

        return mapToResponse(room);
    }

    @Transactional(readOnly = true)
    public boolean validateRoomAccess(String roomCode, String pin) {
        Room room = findActiveRoomOrThrow(roomCode);
        if (room.getPinHash() == null) {
            return true;
        }
        if (pin == null || pin.trim().isEmpty()) {
            return false;
        }
        return hashPin(pin.trim()).equals(room.getPinHash());
    }

    @Transactional
    public Room registerPeerConnection(String roomCode, String role, String sessionId) {
        Room room = findActiveRoomOrThrow(roomCode);

        if ("sender".equalsIgnoreCase(role)) {
            room.setSenderSessionId(sessionId);
        } else if ("receiver".equalsIgnoreCase(role)) {
            if (room.getReceiverSessionId() != null && !room.getReceiverSessionId().equals(sessionId)) {
                throw new RoomFullException("Room " + roomCode + " already has a connected receiver.");
            }
            room.setReceiverSessionId(sessionId);
        }

        if (room.getSenderSessionId() != null && room.getReceiverSessionId() != null) {
            room.setStatus(RoomStatus.CONNECTED);
        }

        return roomRepository.save(room);
    }

    @Transactional
    public void unregisterPeerConnection(String sessionId) {
        // Find any room having this session id
        for (Room room : roomRepository.findAll()) {
            boolean changed = false;
            if (sessionId.equals(room.getSenderSessionId())) {
                room.setSenderSessionId(null);
                changed = true;
            }
            if (sessionId.equals(room.getReceiverSessionId())) {
                room.setReceiverSessionId(null);
                changed = true;
            }
            if (changed) {
                if (room.getSenderSessionId() == null && room.getReceiverSessionId() == null) {
                    room.setStatus(RoomStatus.DISCONNECTED);
                } else {
                    room.setStatus(RoomStatus.WAITING);
                }
                roomRepository.save(room);
                log.info("Session {} disconnected from room {}", sessionId, room.getRoomCode());
            }
        }
    }

    @Transactional
    public void updateRoomStatus(String roomCode, RoomStatus newStatus) {
        roomRepository.findByRoomCode(roomCode.toUpperCase()).ifPresent(room -> {
            room.setStatus(newStatus);
            roomRepository.save(room);
            log.info("Room {} status updated to {}", roomCode, newStatus);
        });
    }

    @Transactional
    public void completeTransfer(CompleteTransferRequest request) {
        String code = request.getRoomCode().toUpperCase();
        roomRepository.findByRoomCode(code).ifPresent(room -> {
            room.setStatus(RoomStatus.COMPLETED);
            roomRepository.save(room);
        });

        Optional<TransferSession> sessionOpt = transferSessionRepository.findTopByRoomCodeOrderByIdDesc(code);
        if (sessionOpt.isPresent()) {
            TransferSession session = sessionOpt.get();
            session.setStatus(request.getStatus() != null ? request.getStatus() : "COMPLETED");
            if (request.getTotalBytes() != null && request.getTotalBytes() > 0) {
                session.setTotalBytes(request.getTotalBytes());
            }
            if (request.getTotalFiles() != null && request.getTotalFiles() > 0) {
                session.setTotalFiles(request.getTotalFiles());
            }
            session.setCompletedAt(LocalDateTime.now());
            transferSessionRepository.save(session);
        }
    }

    @Transactional
    public void deleteRoom(String roomCode) {
        Room room = findActiveRoomOrThrow(roomCode);
        room.setStatus(RoomStatus.DISCONNECTED);
        roomRepository.save(room);
    }

    @Transactional(readOnly = true)
    public StatsResponse getStats() {
        long totalRooms = roomRepository.count();
        long activeRooms = roomRepository.countByStatus(RoomStatus.WAITING) + roomRepository.countByStatus(RoomStatus.CONNECTED);
        long completed = transferSessionRepository.countByStatus("COMPLETED");
        Long bytes = transferSessionRepository.sumTotalBytesTransferred();

        return StatsResponse.builder()
                .totalRoomsCreated(totalRooms)
                .activeRooms(activeRooms)
                .totalTransfersCompleted(completed)
                .totalBytesTransferred(bytes != null ? bytes : 0L)
                .build();
    }

    private Room findActiveRoomOrThrow(String roomCode) {
        String normalizedCode = roomCode.trim().toUpperCase();
        Room room = roomRepository.findByRoomCode(normalizedCode)
                .orElseThrow(() -> new RoomNotFoundException("Room not found: " + normalizedCode));

        if (room.getStatus() == RoomStatus.EXPIRED || (room.getExpiresAt() != null && room.getExpiresAt().isBefore(LocalDateTime.now()))) {
            room.setStatus(RoomStatus.EXPIRED);
            roomRepository.save(room);
            throw new RoomNotFoundException("Room " + normalizedCode + " has expired.");
        }

        return room;
    }

    private String generateUniqueRoomCode() {
        for (int i = 0; i < 20; i++) {
            StringBuilder sb = new StringBuilder(CODE_LENGTH);
            for (int j = 0; j < CODE_LENGTH; j++) {
                int index = secureRandom.nextInt(CODE_CHARS.length());
                sb.append(CODE_CHARS.charAt(index));
            }
            String code = sb.toString();
            if (!roomRepository.existsByRoomCode(code)) {
                return code;
            }
        }
        return "FD" + System.currentTimeMillis() % 10000;
    }

    private String hashPin(String pin) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(pin.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    private RoomResponse mapToResponse(Room room) {
        return RoomResponse.builder()
                .roomCode(room.getRoomCode())
                .status(room.getStatus())
                .requiresPin(room.getPinHash() != null && !room.getPinHash().isEmpty())
                .senderConnected(room.getSenderSessionId() != null)
                .receiverConnected(room.getReceiverSessionId() != null)
                .createdAt(room.getCreatedAt())
                .expiresAt(room.getExpiresAt())
                .build();
    }
}
