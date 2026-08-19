package com.filedrop.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "transfer_sessions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TransferSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "room_code", nullable = false, length = 16)
    private String roomCode;

    @Column(name = "total_files", nullable = false)
    private Integer totalFiles;

    @Column(name = "total_bytes", nullable = false)
    private Long totalBytes;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @PrePersist
    public void prePersist() {
        if (this.startedAt == null) {
            this.startedAt = LocalDateTime.now();
        }
        if (this.status == null) {
            this.status = "INITIALIZED";
        }
        if (this.totalFiles == null) {
            this.totalFiles = 1;
        }
        if (this.totalBytes == null) {
            this.totalBytes = 0L;
        }
    }
}
