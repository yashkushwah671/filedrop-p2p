package com.filedrop.dto;

import com.filedrop.entity.RoomStatus;
import lombok.*;
import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoomResponse {

    private String roomCode;
    private RoomStatus status;
    private boolean requiresPin;
    private boolean senderConnected;
    private boolean receiverConnected;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}
