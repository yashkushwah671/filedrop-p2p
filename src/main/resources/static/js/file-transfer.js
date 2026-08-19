/**
 * FileTransfer Engine for FileDrop
 * Handles chunked streaming over WebRTC RTCDataChannel with backpressure flow control.
 */
class FileTransferEngine {
    constructor(dataChannel) {
        this.dataChannel = dataChannel;
        this.CHUNK_SIZE = 32 * 1024; // 32 KB chunk size (optimal for WebRTC)
        this.BUFFER_THRESHOLD = 64 * 1024; // 64 KB low water mark
        this.MAX_BUFFER_AMOUNT = 256 * 1024; // 256 KB high water mark

        this.handlers = new Map();
        this.isTransferring = false;
        this.isPaused = false;
        this.isCancelled = false;

        // Receiver state
        this.currentReceivingFile = null;
        this.receivedChunks = [];
        this.receivedBytes = 0;
        this.totalReceivedBatchBytes = 0;
        this.totalBatchSize = 0;
        this.batchFilesInfo = [];
        this.receivedFiles = [];

        // Sender state
        this.filesToSend = [];
        this.totalSentBatchBytes = 0;
        this.totalBatchBytes = 0;
        this.currentFileIndex = 0;

        // Performance telemetry
        this.startTime = 0;
        this.lastTelemetryTime = 0;
        this.lastTransferredBytes = 0;
        this.currentSpeedBps = 0;

        if (this.dataChannel) {
            this.attachDataChannel(this.dataChannel);
        }
    }

    attachDataChannel(dataChannel) {
        this.dataChannel = dataChannel;
        this.dataChannel.binaryType = 'arraybuffer';
        this.dataChannel.bufferedAmountLowThreshold = this.BUFFER_THRESHOLD;

        this.dataChannel.onmessage = (event) => this.handleIncomingMessage(event.data);
        this.dataChannel.onerror = (err) => console.error('[FileTransfer] DataChannel error:', err);
    }

    // =========================================================================
    // SENDER PIPELINE
    // =========================================================================

    async sendFiles(fileList) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('DataChannel is not open. Cannot initiate file transfer.');
        }

        this.filesToSend = Array.from(fileList);
        this.totalBatchBytes = this.filesToSend.reduce((acc, f) => acc + f.size, 0);
        this.totalSentBatchBytes = 0;
        this.currentFileIndex = 0;
        this.isTransferring = true;
        this.isCancelled = false;
        this.isPaused = false;
        this.startTime = Date.now();
        this.lastTelemetryTime = this.startTime;
        this.lastTransferredBytes = 0;

        console.log(`[FileTransfer] Starting batch transfer: ${this.filesToSend.length} files, ${this.formatBytes(this.totalBatchBytes)}`);

        // Send Batch Announcement
        this.sendControlMessage({
            type: 'batch-start',
            fileCount: this.filesToSend.length,
            totalBytes: this.totalBatchBytes,
            files: this.filesToSend.map((f, i) => ({ index: i, name: f.name, size: f.size, type: f.type }))
        });

        for (let i = 0; i < this.filesToSend.length; i++) {
            if (this.isCancelled) {
                console.warn('[FileTransfer] Transfer cancelled by user.');
                this.sendControlMessage({ type: 'transfer-cancelled' });
                break;
            }

            this.currentFileIndex = i;
            const file = this.filesToSend[i];
            await this.sendFile(file, i);
        }

        if (!this.isCancelled) {
            this.sendControlMessage({ type: 'batch-complete' });
            this.isTransferring = false;
            this.emit('transfer-complete', {
                totalFiles: this.filesToSend.length,
                totalBytes: this.totalBatchBytes
            });
        }
    }

    async sendFile(file, fileIndex) {
        const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
        console.log(`[FileTransfer] Streaming file [${fileIndex + 1}/${this.filesToSend.length}]: ${file.name} (${this.formatBytes(file.size)}, ${totalChunks} chunks)`);

        // Announce File Start
        this.sendControlMessage({
            type: 'file-start',
            index: fileIndex,
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
            totalChunks: totalChunks
        });

        let offset = 0;
        let chunkIndex = 0;
        let fileSentBytes = 0;

        while (offset < file.size) {
            if (this.isCancelled) break;

            // Backpressure Flow Control
            if (this.dataChannel.bufferedAmount > this.MAX_BUFFER_AMOUNT) {
                await this.waitForBufferDrain();
            }

            // Slice next chunk without loading whole file into RAM
            const slice = file.slice(offset, offset + this.CHUNK_SIZE);
            const arrayBuffer = await this.readSliceAsArrayBuffer(slice);

            // Transmit raw ArrayBuffer directly over RTCDataChannel
            this.dataChannel.send(arrayBuffer);

            offset += slice.size;
            fileSentBytes += slice.size;
            this.totalSentBatchBytes += slice.size;
            chunkIndex++;

            // Update Progress & Telemetry
            this.updateTelemetry(file, fileIndex, fileSentBytes, this.totalSentBatchBytes, chunkIndex, totalChunks);
        }

        if (!this.isCancelled) {
            // Announce File Complete
            this.sendControlMessage({
                type: 'file-end',
                index: fileIndex,
                name: file.name
            });
        }
    }

    waitForBufferDrain() {
        return new Promise((resolve) => {
            const onLow = () => {
                this.dataChannel.removeEventListener('bufferedamountlow', onLow);
                resolve();
            };
            this.dataChannel.addEventListener('bufferedamountlow', onLow);
            // Fallback timeout in case event is missed
            setTimeout(resolve, 200);
        });
    }

    readSliceAsArrayBuffer(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsArrayBuffer(blob);
        });
    }

    // =========================================================================
    // RECEIVER PIPELINE
    // =========================================================================

    handleIncomingMessage(data) {
        if (typeof data === 'string') {
            // Control message (JSON)
            try {
                const msg = JSON.parse(data);
                this.handleControlMessage(msg);
            } catch (e) {
                console.error('[FileTransfer] Error parsing control message:', e);
            }
        } else if (data instanceof ArrayBuffer) {
            // Binary Chunk Payload
            this.handleIncomingChunk(data);
        }
    }

    handleControlMessage(msg) {
        switch (msg.type) {
            case 'batch-start':
                console.log('[FileTransfer] Received batch start:', msg);
                this.totalBatchSize = msg.totalBytes;
                this.batchFilesInfo = msg.files || [];
                this.totalReceivedBatchBytes = 0;
                this.receivedFiles = [];
                this.startTime = Date.now();
                this.lastTelemetryTime = this.startTime;
                this.lastTransferredBytes = 0;
                this.emit('batch-start', msg);
                break;

            case 'file-start':
                console.log('[FileTransfer] Receiving file:', msg.name, `(${this.formatBytes(msg.size)})`);
                this.currentReceivingFile = {
                    index: msg.index,
                    name: msg.name,
                    size: msg.size,
                    mime: msg.mime,
                    totalChunks: msg.totalChunks
                };
                this.receivedChunks = [];
                this.receivedBytes = 0;
                this.emit('file-start', this.currentReceivingFile);
                break;

            case 'file-end':
                console.log('[FileTransfer] File transfer finished:', msg.name);
                this.finalizeReceivedFile();
                break;

            case 'batch-complete':
                console.log('[FileTransfer] Batch transfer complete!');
                this.emit('transfer-complete', {
                    totalFiles: this.receivedFiles.length,
                    totalBytes: this.totalReceivedBatchBytes,
                    files: this.receivedFiles
                });
                break;

            case 'transfer-cancelled':
                console.warn('[FileTransfer] Remote peer cancelled transfer.');
                this.emit('transfer-cancelled');
                break;
        }
    }

    handleIncomingChunk(arrayBuffer) {
        if (!this.currentReceivingFile) {
            console.warn('[FileTransfer] Received chunk without active file metadata.');
            return;
        }

        this.receivedChunks.push(arrayBuffer);
        this.receivedBytes += arrayBuffer.byteLength;
        this.totalReceivedBatchBytes += arrayBuffer.byteLength;

        const currentChunks = this.receivedChunks.length;
        const totalChunks = this.currentReceivingFile.totalChunks;

        this.updateTelemetry(
            this.currentReceivingFile,
            this.currentReceivingFile.index,
            this.receivedBytes,
            this.totalReceivedBatchBytes,
            currentChunks,
            totalChunks
        );
    }

    finalizeReceivedFile() {
        if (!this.currentReceivingFile) return;

        // Reconstruct Blob from binary chunks
        const blob = new Blob(this.receivedChunks, { type: this.currentReceivingFile.mime });
        const blobUrl = URL.createObjectURL(blob);

        const fileRecord = {
            index: this.currentReceivingFile.index,
            name: this.currentReceivingFile.name,
            size: this.currentReceivingFile.size,
            mime: this.currentReceivingFile.mime,
            blob: blob,
            url: blobUrl
        };

        this.receivedFiles.push(fileRecord);
        this.emit('file-received', fileRecord);

        // Reset file state
        this.currentReceivingFile = null;
        this.receivedChunks = [];
        this.receivedBytes = 0;
    }

    // =========================================================================
    // TELEMETRY & PROGRESS COMPUTATION
    // =========================================================================

    updateTelemetry(file, fileIndex, fileBytes, batchBytes, chunksTransferred, totalChunks) {
        const now = Date.now();
        const deltaMs = now - this.lastTelemetryTime;

        // Update speed calculation every 300ms
        if (deltaMs >= 300) {
            const deltaBytes = batchBytes - this.lastTransferredBytes;
            this.currentSpeedBps = (deltaBytes / deltaMs) * 1000;
            this.lastTelemetryTime = now;
            this.lastTransferredBytes = batchBytes;
        }

        const totalBatchTarget = this.totalBatchBytes || this.totalBatchSize || (file ? file.size : 1);
        const filePercent = file && file.size > 0 ? Math.min(100, Math.round((fileBytes / file.size) * 100)) : 100;
        const batchPercent = totalBatchTarget > 0 ? Math.min(100, Math.round((batchBytes / totalBatchTarget) * 100)) : 0;

        const remainingBytes = Math.max(0, totalBatchTarget - batchBytes);
        let etaSeconds = 0;
        if (this.currentSpeedBps > 0) {
            etaSeconds = Math.round(remainingBytes / this.currentSpeedBps);
        }

        const telemetryData = {
            fileIndex: fileIndex,
            fileName: file ? file.name : '',
            fileSize: file ? file.size : 0,
            fileBytesTransferred: fileBytes,
            filePercent: filePercent,
            batchBytesTransferred: batchBytes,
            batchTotalBytes: totalBatchTarget,
            batchPercent: batchPercent,
            speedBps: this.currentSpeedBps,
            speedFormatted: this.formatSpeed(this.currentSpeedBps),
            etaFormatted: this.formatETA(etaSeconds),
            chunksTransferred: chunksTransferred,
            totalChunks: totalChunks
        };

        this.emit('progress', telemetryData);
    }

    sendControlMessage(msg) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(msg));
        }
    }

    cancelTransfer() {
        this.isCancelled = true;
        this.isTransferring = false;
        this.sendControlMessage({ type: 'transfer-cancelled' });
    }

    // =========================================================================
    // EVENT DISPATCHER & HELPERS
    // =========================================================================

    on(event, callback) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(callback);
    }

    emit(event, data) {
        if (this.handlers.has(event)) {
            this.handlers.get(event).forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Error in FileTransfer event '${event}':`, e); }
            });
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
        if (bytesPerSec >= 1024 * 1024) {
            return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
        }
        return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    }

    formatETA(seconds) {
        if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    }
}
