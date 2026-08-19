package com.filedrop.dto;

import jakarta.validation.constraints.Size;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CreateRoomRequest {

    @Size(max = 32, message = "PIN cannot exceed 32 characters")
    private String pin;

    private Integer totalFiles;

    private Long totalBytes;
}
