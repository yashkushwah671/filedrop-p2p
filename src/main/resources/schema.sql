-- ===================================================================
-- FileDrop MySQL Database Schema
-- Database: filedrop
-- Note: This application only stores room and transfer audit metadata.
-- Actual file data is NEVER stored in the database.
-- ===================================================================

CREATE DATABASE IF NOT EXISTS `filedrop` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `filedrop`;

-- Rooms table
CREATE TABLE IF NOT EXISTS `rooms` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `room_code` VARCHAR(16) NOT NULL UNIQUE,
    `pin_hash` VARCHAR(255) DEFAULT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'WAITING',
    `sender_session_id` VARCHAR(128) DEFAULT NULL,
    `receiver_session_id` VARCHAR(128) DEFAULT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `expires_at` TIMESTAMP NOT NULL,
    INDEX `idx_rooms_code` (`room_code`),
    INDEX `idx_rooms_status` (`status`),
    INDEX `idx_rooms_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Transfer sessions audit/telemetry table
CREATE TABLE IF NOT EXISTS `transfer_sessions` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `room_code` VARCHAR(16) NOT NULL,
    `total_files` INT NOT NULL DEFAULT 1,
    `total_bytes` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(32) NOT NULL DEFAULT 'INITIALIZED',
    `started_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `completed_at` TIMESTAMP NULL DEFAULT NULL,
    INDEX `idx_transfers_room_code` (`room_code`),
    INDEX `idx_transfers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
