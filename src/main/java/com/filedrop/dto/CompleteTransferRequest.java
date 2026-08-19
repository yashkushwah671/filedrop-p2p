package com.filedrop.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CompleteTransferRequest {
    private String roomCode;
    private Integer totalFiles;
    private Long totalBytes;
    private String status; // COMPLETED or FAILED
}
