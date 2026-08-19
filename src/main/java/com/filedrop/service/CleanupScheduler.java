package com.filedrop.service;

import com.filedrop.entity.RoomStatus;
import com.filedrop.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Component
@RequiredArgsConstructor
@Slf4j
public class CleanupScheduler {

    private final RoomRepository roomRepository;

    // Run every 5 minutes
    @Scheduled(fixedRate = 300000)
    @Transactional
    public void cleanupExpiredRooms() {
        LocalDateTime now = LocalDateTime.now();
        int expiredCount = roomRepository.expireOldRooms(now, RoomStatus.EXPIRED);
        if (expiredCount > 0) {
            log.info("CleanupScheduler: Expired {} inactive rooms.", expiredCount);
        }
    }
}
