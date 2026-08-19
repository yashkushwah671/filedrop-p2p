package com.filedrop.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.filedrop.FileDropApplication;
import com.filedrop.dto.CreateRoomRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = FileDropApplication.class)
@AutoConfigureMockMvc
public class RoomControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void testCreateRoomEndpoint() throws Exception {
        CreateRoomRequest request = CreateRoomRequest.builder()
                .pin("9999")
                .totalFiles(3)
                .totalBytes(5000000L)
                .build();

        mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.roomCode").isString())
                .andExpect(jsonPath("$.status").value("WAITING"))
                .andExpect(jsonPath("$.requiresPin").value(true));
    }

    @Test
    void testHealthEndpoint() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.service").value("FileDrop WebRTC Signaling"));
    }

    @Test
    void testStatsEndpoint() throws Exception {
        mockMvc.perform(get("/api/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalRoomsCreated").isNumber())
                .andExpect(jsonPath("$.activeRooms").isNumber());
    }
}
