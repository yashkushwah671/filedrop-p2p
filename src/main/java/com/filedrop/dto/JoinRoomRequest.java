package com.filedrop.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class JoinRoomRequest {

    @NotBlank(message = "Room code is required")
    private String roomCode;

    private String pin;
}
