package com.filedrop.repository;

import com.filedrop.entity.Room;
import com.filedrop.entity.RoomStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface RoomRepository extends JpaRepository<Room, Long> {

    Optional<Room> findByRoomCode(String roomCode);

    Optional<Room> findByRoomCodeAndStatus(String roomCode, RoomStatus status);

    boolean existsByRoomCode(String roomCode);

    List<Room> findByExpiresAtBeforeAndStatusNot(LocalDateTime threshold, RoomStatus status);

    long countByStatus(RoomStatus status);

    @Modifying
    @Query("UPDATE Room r SET r.status = :status WHERE r.expiresAt < :now AND r.status != 'EXPIRED'")
    int expireOldRooms(@Param("now") LocalDateTime now, @Param("status") RoomStatus status);
}
