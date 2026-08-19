package com.filedrop.controller;

import com.filedrop.dto.*;
import com.filedrop.service.RoomService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Slf4j
public class RoomController {

    private final RoomService roomService;

    @PostMapping("/rooms")
    public ResponseEntity<RoomResponse> createRoom(@RequestBody(required = false) @Valid CreateRoomRequest request) {
        RoomResponse response = roomService.createRoom(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping("/rooms/{roomCode}")
    public ResponseEntity<RoomResponse> getRoom(
            @PathVariable String roomCode,
            @RequestParam(required = false) String pin) {
        RoomResponse response = roomService.getRoomStatus(roomCode, pin);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/rooms/{roomCode}/validate")
    public ResponseEntity<Map<String, Object>> validatePin(
            @PathVariable String roomCode,
            @RequestBody(required = false) JoinRoomRequest request) {
        String pin = request != null ? request.getPin() : null;
        boolean valid = roomService.validateRoomAccess(roomCode, pin);
        return ResponseEntity.ok(Map.of(
                "valid", valid,
                "roomCode", roomCode
        ));
    }

    @PostMapping("/transfers/complete")
    public ResponseEntity<Map<String, String>> completeTransfer(@RequestBody CompleteTransferRequest request) {
        roomService.completeTransfer(request);
        return ResponseEntity.ok(Map.of("status", "SUCCESS", "message", "Transfer marked as complete"));
    }

    @DeleteMapping("/rooms/{roomCode}")
    public ResponseEntity<Map<String, String>> deleteRoom(@PathVariable String roomCode) {
        roomService.deleteRoom(roomCode);
        return ResponseEntity.ok(Map.of("status", "SUCCESS", "message", "Room closed"));
    }

    @GetMapping("/stats")
    public ResponseEntity<StatsResponse> getStats() {
        return ResponseEntity.ok(roomService.getStats());
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "FileDrop WebRTC Signaling",
                "timestamp", System.currentTimeMillis()
        ));
    }
}
