package com.filedrop.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SignalMessage {

    private String type;        // join, joined, ready, offer, answer, ice-candidate, leave, room-status, ping, pong, error
    private String roomId;      // 6-char room code
    private String role;        // "sender" or "receiver"
    private String pin;         // optional pin during join
    private Object payload;     // SDP object, ICE candidate object, or custom metadata
    private String message;     // human-readable message or error description
    private Long timestamp;

    public static SignalMessage ofError(String roomId, String errorMessage) {
        return SignalMessage.builder()
                .type("error")
                .roomId(roomId)
                .message(errorMessage)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}
