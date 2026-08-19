package com.filedrop.service;

import com.filedrop.FileDropApplication;
import com.filedrop.dto.CreateRoomRequest;
import com.filedrop.dto.RoomResponse;
import com.filedrop.entity.Room;
import com.filedrop.entity.RoomStatus;
import com.filedrop.exception.InvalidPinException;
import com.filedrop.exception.RoomFullException;
import com.filedrop.exception.RoomNotFoundException;
import com.filedrop.repository.RoomRepository;
import com.filedrop.repository.TransferSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(classes = FileDropApplication.class)
@Transactional
public class RoomServiceTest {

    @Autowired
    private RoomService roomService;

    @Autowired
    private RoomRepository roomRepository;

    @Autowired
    private TransferSessionRepository transferSessionRepository;

    @BeforeEach
    void setUp() {
        roomRepository.deleteAll();
        transferSessionRepository.deleteAll();
    }

    @Test
    void testCreateRoom_Success() {
        CreateRoomRequest request = CreateRoomRequest.builder()
                .pin("1234")
                .totalFiles(2)
                .totalBytes(1048576L)
                .build();

        RoomResponse response = roomService.createRoom(request);

        assertThat(response).isNotNull();
        assertThat(response.getRoomCode()).hasSize(6);
        assertThat(response.getStatus()).isEqualTo(RoomStatus.WAITING);
        assertThat(response.isRequiresPin()).isTrue();
    }

    @Test
    void testGetRoomStatus_WithValidPin() {
        CreateRoomRequest request = CreateRoomRequest.builder()
                .pin("SECRET")
                .build();
        RoomResponse created = roomService.createRoom(request);

        RoomResponse fetched = roomService.getRoomStatus(created.getRoomCode(), "SECRET");
        assertThat(fetched.getRoomCode()).isEqualTo(created.getRoomCode());
    }

    @Test
    void testGetRoomStatus_WithInvalidPin() {
        CreateRoomRequest request = CreateRoomRequest.builder()
                .pin("SECRET")
                .build();
        RoomResponse created = roomService.createRoom(request);

        assertThatThrownBy(() -> roomService.getRoomStatus(created.getRoomCode(), "WRONG"))
                .isInstanceOf(InvalidPinException.class);
    }

    @Test
    void testRegisterPeers_AndFullRoomException() {
        RoomResponse created = roomService.createRoom(new CreateRoomRequest());
        String code = created.getRoomCode();

        // Sender connects
        Room room = roomService.registerPeerConnection(code, "sender", "sess-sender-1");
        assertThat(room.getSenderSessionId()).isEqualTo("sess-sender-1");

        // Receiver connects
        room = roomService.registerPeerConnection(code, "receiver", "sess-receiver-1");
        assertThat(room.getReceiverSessionId()).isEqualTo("sess-receiver-1");
        assertThat(room.getStatus()).isEqualTo(RoomStatus.CONNECTED);

        // Third peer attempts to join as receiver -> should throw RoomFullException
        assertThatThrownBy(() -> roomService.registerPeerConnection(code, "receiver", "sess-receiver-2"))
                .isInstanceOf(RoomFullException.class);
    }

    @Test
    void testNonExistentRoom() {
        assertThatThrownBy(() -> roomService.getRoomStatus("NONEXISTENT", null))
                .isInstanceOf(RoomNotFoundException.class);
    }
}
