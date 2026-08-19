/**
 * UI Manager for FileDrop
 * Handles view switching, drag-and-drop, QR generation, segmented PIN input, dashboard updates, and Web Audio cues.
 */
class UIManager {
    constructor() {
        this.selectedFiles = [];
        this.currentView = 'landing';
        this.qrCodeInstance = null;
        this.audioCtx = null;

        this.initDOMElements();
        this.initEventListeners();
    }

    initDOMElements() {
        // Views
        this.viewLanding = document.getElementById('viewLanding');
        this.viewCreate = document.getElementById('viewCreate');
        this.viewJoin = document.getElementById('viewJoin');
        this.viewDashboard = document.getElementById('viewDashboard');

        // Badges & Status
        this.wsStatusDot = document.getElementById('wsStatusDot');
        this.wsStatusText = document.getElementById('wsStatusText');

        // Create View elements
        this.roomCodeDigits = document.getElementById('roomCodeDigits');
        this.qrCodeCanvas = document.getElementById('qrCodeCanvas');
        this.btnCopyCode = document.getElementById('btnCopyCode');
        this.btnCopyLink = document.getElementById('btnCopyLink');
        this.createDropzone = document.getElementById('createDropzone');
        this.fileInput = document.getElementById('fileInput');
        this.fileListPreview = document.getElementById('fileListPreview');
        this.btnStartTransfer = document.getElementById('btnStartTransfer');
        this.inputRoomPin = document.getElementById('inputRoomPin');

        // Join View elements
        this.pinBoxes = document.querySelectorAll('.pin-digit-box');
        this.joinPinInput = document.getElementById('joinPinInput');
        this.btnSubmitJoin = document.getElementById('btnSubmitJoin');

        // Dashboard elements
        this.dashRoomCode = document.getElementById('dashRoomCode');
        this.dashRoleBadge = document.getElementById('dashRoleBadge');
        this.peerStatusText = document.getElementById('peerStatusText');
        this.metricSpeed = document.getElementById('metricSpeed');
        this.metricETA = document.getElementById('metricETA');
        this.metricChunks = document.getElementById('metricChunks');
        this.metricProgress = document.getElementById('metricProgress');
        this.currentFileName = document.getElementById('currentFileName');
        this.fileProgressBar = document.getElementById('fileProgressBar');
        this.fileProgressPercent = document.getElementById('fileProgressPercent');
        this.batchProgressBar = document.getElementById('batchProgressBar');
        this.batchProgressPercent = document.getElementById('batchProgressPercent');
        this.transferQueueList = document.getElementById('transferQueueList');
        this.eventLogFeed = document.getElementById('eventLogFeed');
        this.btnCancelTransfer = document.getElementById('btnCancelTransfer');
        this.btnNewTransfer = document.getElementById('btnNewTransfer');
        this.toastContainer = document.getElementById('toastContainer');
    }

    initEventListeners() {
        // Navigation buttons
        document.getElementById('btnNavCreate')?.addEventListener('click', () => this.switchView('create'));
        document.getElementById('btnNavJoin')?.addEventListener('click', () => this.switchView('join'));
        document.getElementById('btnBackFromCreate')?.addEventListener('click', () => this.switchView('landing'));
        document.getElementById('btnBackFromJoin')?.addEventListener('click', () => this.switchView('landing'));
        document.getElementById('logoBrand')?.addEventListener('click', () => this.switchView('landing'));

        // Copy Room Code & Link
        this.btnCopyCode?.addEventListener('click', () => {
            const code = this.roomCodeDigits?.getAttribute('data-code') || '';
            if (code) {
                navigator.clipboard.writeText(code);
                this.showToast(`Room code ${code} copied to clipboard!`, 'success');
            }
        });

        this.btnCopyLink?.addEventListener('click', () => {
            const code = this.roomCodeDigits?.getAttribute('data-code') || '';
            if (code) {
                const url = `${window.location.origin}/?room=${code}`;
                navigator.clipboard.writeText(url);
                this.showToast('Shareable join link copied to clipboard!', 'success');
            }
        });

        // Dropzone & File picker
        this.createDropzone?.addEventListener('click', () => this.fileInput?.click());
        this.fileInput?.addEventListener('change', (e) => this.handleFileSelection(e.target.files));

        ['dragenter', 'dragover'].forEach(name => {
            this.createDropzone?.addEventListener(name, (e) => {
                e.preventDefault();
                this.createDropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            this.createDropzone?.addEventListener(name, (e) => {
                e.preventDefault();
                this.createDropzone.classList.remove('dragover');
            });
        });

        this.createDropzone?.addEventListener('drop', (e) => {
            if (e.dataTransfer?.files?.length) {
                this.handleFileSelection(e.dataTransfer.files);
            }
        });

        // Segmented PIN Box auto-focus navigation
        this.pinBoxes.forEach((box, index) => {
            box.addEventListener('input', (e) => {
                const val = e.target.value;
                if (val.length >= 1) {
                    box.value = val.charAt(val.length - 1).toUpperCase();
                    if (index < this.pinBoxes.length - 1) {
                        this.pinBoxes[index + 1].focus();
                    }
                }
            });

            box.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !box.value && index > 0) {
                    this.pinBoxes[index - 1].focus();
                } else if (e.key === 'Enter') {
                    this.btnSubmitJoin?.click();
                }
            });

            box.addEventListener('paste', (e) => {
                e.preventDefault();
                const paste = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
                if (paste) {
                    const chars = paste.replace(/[^A-Z0-9]/gi, '').split('');
                    this.pinBoxes.forEach((b, i) => {
                        b.value = chars[i] || '';
                    });
                    const lastFilled = Math.min(chars.length, this.pinBoxes.length - 1);
                    this.pinBoxes[lastFilled]?.focus();
                }
            });
        });
    }

    switchView(viewName) {
        this.currentView = viewName;
        [this.viewLanding, this.viewCreate, this.viewJoin, this.viewDashboard].forEach(v => {
            if (v) v.classList.remove('active');
        });

        switch (viewName) {
            case 'landing':
                this.viewLanding?.classList.add('active');
                break;
            case 'create':
                this.viewCreate?.classList.add('active');
                break;
            case 'join':
                this.viewJoin?.classList.add('active');
                this.pinBoxes[0]?.focus();
                break;
            case 'dashboard':
                this.viewDashboard?.classList.add('active');
                break;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderRoomCode(code) {
        if (!this.roomCodeDigits) return;
        this.roomCodeDigits.setAttribute('data-code', code);
        this.roomCodeDigits.innerHTML = '';
        code.split('').forEach(char => {
            const digitSpan = document.createElement('span');
            digitSpan.className = 'code-digit';
            digitSpan.textContent = char;
            this.roomCodeDigits.appendChild(digitSpan);
        });

        // Generate QR code for mobile join
        const joinUrl = `${window.location.origin}/?room=${code}`;
        if (this.qrCodeCanvas && window.QRCode) {
            this.qrCodeCanvas.innerHTML = '';
            this.qrCodeInstance = new window.QRCode(this.qrCodeCanvas, {
                text: joinUrl,
                width: 150,
                height: 150,
                colorDark: '#090d16',
                colorLight: '#ffffff',
                correctLevel: window.QRCode.CorrectLevel.M
            });
        }
    }

    handleFileSelection(files) {
        const newFiles = Array.from(files);
        this.selectedFiles.push(...newFiles);
        this.renderFileList();
    }

    renderFileList() {
        if (!this.fileListPreview) return;
        this.fileListPreview.innerHTML = '';

        if (this.selectedFiles.length === 0) {
            this.btnStartTransfer.disabled = true;
            return;
        }

        this.btnStartTransfer.disabled = false;

        this.selectedFiles.forEach((file, index) => {
            const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';
            const card = document.createElement('div');
            card.className = 'file-preview-card';
            card.innerHTML = `
                <div class="file-info-group">
                    <div class="file-type-icon">${ext.slice(0, 4)}</div>
                    <div class="file-meta-text">
                        <div class="file-name-text" title="${file.name}">${file.name}</div>
                        <div class="file-size-text">${this.formatBytes(file.size)}</div>
                    </div>
                </div>
                <button class="btn-remove-file" title="Remove file" data-index="${index}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;

            card.querySelector('.btn-remove-file').addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectedFiles.splice(index, 1);
                this.renderFileList();
            });

            this.fileListPreview.appendChild(card);
        });
    }

    getEnteredRoomCode() {
        let code = '';
        this.pinBoxes.forEach(b => code += b.value.trim());
        return code.toUpperCase();
    }

    setEnteredRoomCode(code) {
        if (!code) return;
        const chars = code.trim().toUpperCase().split('');
        this.pinBoxes.forEach((b, i) => {
            b.value = chars[i] || '';
        });
    }

    // =========================================================================
    // DASHBOARD RENDERING
    // =========================================================================

    initDashboard(role, roomCode, files) {
        this.switchView('dashboard');
        if (this.dashRoomCode) this.dashRoomCode.textContent = roomCode;
        if (this.dashRoleBadge) {
            this.dashRoleBadge.textContent = role.toUpperCase();
            this.dashRoleBadge.className = `file-status-tag ${role === 'sender' ? 'transferring' : 'waiting'}`;
        }
        if (this.peerStatusText) this.peerStatusText.textContent = 'Connecting via WebRTC STUN...';

        this.renderQueue(files);
        this.logEvent(`Connected to room ${roomCode} as ${role}.`, 'info');
    }

    renderQueue(files) {
        if (!this.transferQueueList) return;
        this.transferQueueList.innerHTML = '';

        files.forEach((f, idx) => {
            const card = document.createElement('div');
            card.className = 'queue-item-card';
            card.id = `queue-item-${idx}`;
            card.innerHTML = `
                <div class="file-info-group">
                    <div class="file-type-icon">${(f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}</div>
                    <div class="file-meta-text">
                        <div class="file-name-text" title="${f.name}">${f.name}</div>
                        <div class="file-size-text">${this.formatBytes(f.size)}</div>
                    </div>
                </div>
                <div id="queue-status-${idx}">
                    <span class="file-status-tag waiting">Waiting</span>
                </div>
            `;
            this.transferQueueList.appendChild(card);
        });
    }

    updateTelemetryUI(telemetry) {
        if (this.metricSpeed) this.metricSpeed.textContent = telemetry.speedFormatted;
        if (this.metricETA) this.metricETA.textContent = telemetry.etaFormatted;
        if (this.metricChunks) this.metricChunks.textContent = `${telemetry.chunksTransferred} / ${telemetry.totalChunks}`;
        if (this.metricProgress) this.metricProgress.textContent = `${telemetry.batchPercent}%`;

        if (this.currentFileName) this.currentFileName.textContent = telemetry.fileName;
        if (this.fileProgressBar) this.fileProgressBar.style.width = `${telemetry.filePercent}%`;
        if (this.fileProgressPercent) this.fileProgressPercent.textContent = `${telemetry.filePercent}%`;

        if (this.batchProgressBar) this.batchProgressBar.style.width = `${telemetry.batchPercent}%`;
        if (this.batchProgressPercent) this.batchProgressPercent.textContent = `${telemetry.batchPercent}%`;

        // Highlight active queue item
        const queueCard = document.getElementById(`queue-item-${telemetry.fileIndex}`);
        const queueStatus = document.getElementById(`queue-status-${telemetry.fileIndex}`);
        if (queueCard && !queueCard.classList.contains('active-transfer')) {
            document.querySelectorAll('.queue-item-card').forEach(c => c.classList.remove('active-transfer'));
            queueCard.classList.add('active-transfer');
            if (queueStatus) queueStatus.innerHTML = `<span class="file-status-tag transferring">${telemetry.filePercent}%</span>`;
        } else if (queueStatus) {
            queueStatus.innerHTML = `<span class="file-status-tag transferring">${telemetry.filePercent}%</span>`;
        }
    }

    markFileCompleted(fileIndex, fileRecord = null) {
        const queueCard = document.getElementById(`queue-item-${fileIndex}`);
        const queueStatus = document.getElementById(`queue-status-${fileIndex}`);
        if (queueCard) {
            queueCard.classList.remove('active-transfer');
            queueCard.classList.add('done-transfer');
        }

        if (queueStatus) {
            if (fileRecord && fileRecord.url) {
                // Receiver gets download button
                queueStatus.innerHTML = `
                    <a href="${fileRecord.url}" download="${fileRecord.name}" class="btn-download-file">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download
                    </a>
                `;
            } else {
                queueStatus.innerHTML = `<span class="file-status-tag completed">Transferred</span>`;
            }
        }

        this.playAudioCue('file-complete');
    }

    markTransferFinished(totalFiles, totalBytes) {
        if (this.fileProgressBar) {
            this.fileProgressBar.style.width = '100%';
            this.fileProgressBar.classList.add('completed');
        }
        if (this.batchProgressBar) {
            this.batchProgressBar.style.width = '100%';
            this.batchProgressBar.classList.add('completed');
        }
        if (this.peerStatusText) this.peerStatusText.textContent = 'Transfer Complete!';
        this.logEvent(`Successfully transferred ${totalFiles} files (${this.formatBytes(totalBytes)}) directly peer-to-peer!`, 'success');
        this.showToast('Transfer completed successfully!', 'success');
        this.playAudioCue('success');
    }

    logEvent(text, level = 'info') {
        if (!this.eventLogFeed) return;
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        entry.textContent = `[${time}] ${text}`;
        this.eventLogFeed.appendChild(entry);
        this.eventLogFeed.scrollTop = this.eventLogFeed.scrollHeight;
    }

    showToast(message, type = 'info') {
        if (!this.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    playAudioCue(type) {
        try {
            if (!this.audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) this.audioCtx = new AudioContext();
            }
            if (!this.audioCtx) return;

            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            const now = this.audioCtx.currentTime;

            if (type === 'connect') {
                osc.frequency.setValueAtTime(440, now); // A4
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'file-complete') {
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5
                gain.gain.setValueAtTime(0.06, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
            } else if (type === 'success') {
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
                osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
            }
        } catch (e) {
            // Audio context not allowed before user interaction, safely ignore
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
