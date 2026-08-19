package com.filedrop.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StatsResponse {
    private long totalRoomsCreated;
    private long totalTransfersCompleted;
    private long totalBytesTransferred;
    private long activeRooms;
}
