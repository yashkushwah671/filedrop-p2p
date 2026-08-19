package com.filedrop.repository;

import com.filedrop.entity.TransferSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface TransferSessionRepository extends JpaRepository<TransferSession, Long> {

    Optional<TransferSession> findTopByRoomCodeOrderByIdDesc(String roomCode);

    long countByStatus(String status);

    @Query("SELECT COALESCE(SUM(t.totalBytes), 0) FROM TransferSession t WHERE t.status = 'COMPLETED'")
    Long sumTotalBytesTransferred();
}
