/**
 * Popup Script - Controls UI state, Real-time Audio Visualizer,
 * Folder Configuration, AI Track Namer Controls, 1-Click Model Downloader,
 * and Recording Actions.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const folderInput = document.getElementById('folderInput');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackArtist = document.getElementById('currentTrackArtist');
  const versionBadge = document.getElementById('versionBadge');
  const recordingTimer = document.getElementById('recordingTimer');
  const tapeReelsWidget = document.getElementById('tapeReelsWidget');
  const visualizerCanvas = document.getElementById('visualizerCanvas');
  const toggleRecordBtn = document.getElementById('toggleRecordBtn');
  const recordBtnText = document.getElementById('recordBtnText');
  const cutNowBtn = document.getElementById('cutNowBtn');
  const autoCutToggle = document.getElementById('autoCutToggle');
  const silenceCutToggle = document.getElementById('silenceCutToggle');
  const autoStopSilenceToggle = document.getElementById('autoStopSilenceToggle');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  // AI DOM Elements
  const aiNamingToggle = document.getElementById('aiNamingToggle');
  const aiConfigSection = document.getElementById('aiConfigSection');
  const aiProviderSelect = document.getElementById('aiProviderSelect');
  const aiModelRow = document.getElementById('aiModelRow');
  const aiModelSelect = document.getElementById('aiModelSelect');
  const modelDownloaderDrawer = document.getElementById('modelDownloaderDrawer');
  const closeDownloaderBtn = document.getElementById('closeDownloaderBtn');
  const customModelInput = document.getElementById('customModelInput');
  const customPullBtn = document.getElementById('customPullBtn');
  const pullProgressContainer = document.getElementById('pullProgressContainer');
  const pullStatusText = document.getElementById('pullStatusText');
  const pullPercentText = document.getElementById('pullPercentText');
  const pullProgressBar = document.getElementById('pullProgressBar');
  const aiTestInput = document.getElementById('aiTestInput');
  const aiTestBtn = document.getElementById('aiTestBtn');
  const aiTestResult = document.getElementById('aiTestResult');
  const aiTestResultText = document.getElementById('aiTestResultText');

  // Canvas visualizer context
  const ctx = visualizerCanvas.getContext('2d');

  let state = {
    isRecording: false,
    folderName: 'Web_Recordings',
    aiNamingEnabled: true,
    aiProvider: 'ollama',
    aiModel: 'qwen2.5:1.5b',
    trackStartedAt: null,
    recordedTracks: []
  };

  if (versionBadge) {
    versionBadge.textContent = `v${chrome.runtime.getManifest().version} AI Auto-Cutter`;
  }

  let timerInterval = null;
  let visualizerInterval = null;

  // Format seconds to mm:ss
  function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Format file size
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Render Recorded Tracks History
  function renderHistory(tracks) {
    historyCount.textContent = tracks.length;

    if (!tracks || tracks.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          <p>No tracks recorded yet</p>
          <span>Play a playlist and start recording</span>
        </div>
      `;
      return;
    }

    historyList.innerHTML = tracks.map((t) => `
      <div class="track-item" data-download-id="${t.downloadId}">
        <div class="track-item-left">
          <div class="track-item-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
          <div class="track-item-details">
            <div class="track-item-name" title="${t.filename}">${t.filename}</div>
            <div class="track-item-meta">${formatTime(t.durationSec)} • ${formatBytes(t.sizeBytes)} • 📁 ${t.folder}</div>
          </div>
        </div>
        <div class="track-item-right">
          <button class="track-item-action show-file-btn" data-id="${t.downloadId}" title="Reveal in Downloads folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.show-file-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const downloadId = parseInt(btn.getAttribute('data-id'), 10);
        if (downloadId && chrome.downloads) {
          chrome.downloads.show(downloadId);
        }
      });
    });
  }

  // Populate models dropdown from local Ollama
  async function loadOllamaModels() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_AI_MODELS' });
      if (res && res.models && res.models.length > 0) {
        const currentVal = state.aiModel || aiModelSelect.value;
        const optionsHtml = res.models.map((m) =>
          `<option value="${m}">${m}${m === 'qwen2.5:1.5b' ? ' (Recommended)' : ''}</option>`
        ).join('');

        aiModelSelect.innerHTML = optionsHtml + `<option value="__DOWNLOAD_NEW__">📥 ＋ Download New Model...</option>`;

        if (res.models.includes(currentVal)) {
          aiModelSelect.value = currentVal;
        } else {
          aiModelSelect.value = res.models[0];
          state.aiModel = res.models[0];
        }
      } else {
        aiModelSelect.innerHTML = `
          <option value="qwen2.5:1.5b">qwen2.5:1.5b (Recommended)</option>
          <option value="qwen2.5:0.5b">qwen2.5:0.5b</option>
          <option value="__DOWNLOAD_NEW__">📥 ＋ Download New Model...</option>
        `;
      }
    } catch (e) {}
  }

  // Update UI with latest background state
  function updateUI(status) {
    state = { ...state, ...status };

    // Folder
    if (status.folderName && document.activeElement !== folderInput) {
      folderInput.value = status.folderName;
    }

    // Automation Settings
    if (status.autoCutOnTrackChange !== undefined) {
      autoCutToggle.checked = status.autoCutOnTrackChange;
    }
    if (status.autoCutOnSilence !== undefined) {
      silenceCutToggle.checked = status.autoCutOnSilence;
    }
    if (status.autoStopOnSilence !== undefined) {
      autoStopSilenceToggle.checked = status.autoStopOnSilence;
    }

    // AI Settings
    if (status.aiNamingEnabled !== undefined) {
      aiNamingToggle.checked = status.aiNamingEnabled;
      aiConfigSection.style.display = status.aiNamingEnabled ? 'flex' : 'none';
    }
    if (status.aiProvider) {
      aiProviderSelect.value = status.aiProvider;
      aiModelRow.style.display = status.aiProvider === 'heuristic' ? 'none' : 'flex';
    }
    if (status.aiModel && aiModelSelect.querySelector(`option[value="${status.aiModel}"]`)) {
      aiModelSelect.value = status.aiModel;
    }

    // Status Badge & Controls
    if (status.isRecording) {
      statusBadge.className = 'status-badge status-recording';
      statusText.textContent = 'REC ACTIVE';
      toggleRecordBtn.className = 'btn btn-primary recording-active';
      recordBtnText.textContent = 'Stop & Save All';
      cutNowBtn.disabled = false;

      if (tapeReelsWidget) tapeReelsWidget.style.display = 'inline-flex';

      if (status.currentTrack) {
        currentTrackTitle.textContent = status.currentTrack.formattedName || status.currentTrack.title || 'Playing Track...';
        currentTrackArtist.textContent = status.currentTrack.artist ? `Artist: ${status.currentTrack.artist}` : (status.recordingTabTitle || 'Tab Audio');
      } else {
        currentTrackTitle.textContent = status.recordingTabTitle || 'Recording Tab Audio';
        currentTrackArtist.textContent = 'Auto-detecting track title...';
      }

      startTimer();
      startVisualizer();
    } else {
      statusBadge.className = 'status-badge status-idle';
      statusText.textContent = 'IDLE';
      toggleRecordBtn.className = 'btn btn-primary';
      recordBtnText.textContent = 'Start Recording Tab';
      cutNowBtn.disabled = true;
      recordingTimer.textContent = '00:00';
      if (tapeReelsWidget) tapeReelsWidget.style.display = 'none';

      stopTimer();
      stopVisualizer();
      drawIdleVisualizer();
    }

    // History
    if (status.recordedTracks) {
      renderHistory(status.recordedTracks);
    }
  }

  // Timer updater
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (state.isRecording && state.trackStartedAt) {
        const elapsedSec = Math.floor((Date.now() - state.trackStartedAt) / 1000);
        recordingTimer.textContent = formatTime(elapsedSec);
      }
    }, 500);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Visualizer Mode Switcher & Rendering Engine
  const btnCycleVisualizer = document.getElementById('btnCycleVisualizer');
  const visModeIcon = document.getElementById('visModeIcon');
  const visModeName = document.getElementById('visModeName');
  const visualizerContainer = document.getElementById('visualizerContainer');

  const VISUALIZER_MODES = [
    { id: 'horizon', name: '3D Horizon', icon: '🌌' },
    { id: 'oled', name: 'OLED Bars', icon: '📊' },
    { id: 'analog', name: 'VU Meter', icon: '🕹️' },
    { id: 'radial', name: 'Dual Reactor', icon: '🌀' }
  ];
  let currentVisModeIndex = 0;

  // Visualizer Physics State
  const OLED_BAR_COUNT = 34;
  const oledBarHeights = new Float32Array(OLED_BAR_COUNT);
  const oledPeakHeights = new Float32Array(OLED_BAR_COUNT);
  const oledGhostHeights = new Float32Array(OLED_BAR_COUNT);
  const oledPeakTimers = new Float32Array(OLED_BAR_COUNT);

  let vuNeedleL = -20, vuNeedleR = -20;
  let vuVelL = 0, vuVelR = 0;
  let vuPeakLampL = 0, vuPeakLampR = 0;

  let radialSpoolAngleL = 0;
  let radialSpoolAngleR = 0;
  let radialOuterAngle = 0;
  const radialShockwaves = [];

  const HORIZON_LAYERS = 20;
  const horizonHistory = [];
  for (let i = 0; i < HORIZON_LAYERS; i++) {
    horizonHistory.push(new Float32Array(32));
  }
  let horizonGridOffset = 0;

  // Frequency Dynamics Normalizer & EQ Boost Curve with natural headroom
  function getNormalizedFrequencyData(freqArray, count) {
    const out = new Float32Array(count);
    if (!freqArray || freqArray.length === 0) return out;

    for (let i = 0; i < count; i++) {
      const normIdx = i / count;
      const srcIdx = Math.floor(Math.pow(normIdx, 1.25) * Math.min(freqArray.length - 1, 56));
      const raw = freqArray[srcIdx] || 0;
      // High-contrast power scaling + balanced EQ curve (avoids pegging the ceiling)
      const normalized = Math.pow(raw / 255, 0.82);
      const eqBoost = 1.0 + normIdx * 0.85;
      out[i] = Math.min(1.0, normalized * eqBoost * 0.88);
    }
    return out;
  }

  // Restore saved visualizer mode (defaulting to 3D Horizon Vaporwave Sunset)
  try {
    const savedVis = await chrome.storage.local.get(['visualizerMode']);
    const targetMode = savedVis.visualizerMode || 'horizon';
    const idx = VISUALIZER_MODES.findIndex((m) => m.id === targetMode);
    if (idx !== -1) currentVisModeIndex = idx;
  } catch (e) {}

  function updateVisModeButton() {
    const mode = VISUALIZER_MODES[currentVisModeIndex];
    if (visModeIcon) visModeIcon.textContent = mode.icon;
    if (visModeName) visModeName.textContent = mode.name;
  }

  function cycleVisualizerMode() {
    currentVisModeIndex = (currentVisModeIndex + 1) % VISUALIZER_MODES.length;
    updateVisModeButton();
    const mode = VISUALIZER_MODES[currentVisModeIndex];
    chrome.storage.local.set({ visualizerMode: mode.id });
    drawIdleVisualizer();
  }

  if (btnCycleVisualizer) {
    btnCycleVisualizer.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleVisualizerMode();
    });
  }

  if (visualizerContainer) {
    visualizerContainer.addEventListener('click', cycleVisualizerMode);
  }

  updateVisModeButton();

  // Idle visualizer waveform
  function drawIdleVisualizer() {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    const mode = VISUALIZER_MODES[currentVisModeIndex].id;

    if (mode === 'analog') {
      drawAnalogVUMeter(0.02, 0.02);
    } else if (mode === 'radial') {
      drawRadialOrbit(new Uint8Array(48).fill(6), 0.02);
    } else if (mode === 'horizon') {
      draw3DHorizon(new Uint8Array(32).fill(4));
    } else {
      // OLED Bars Idle
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, height - 6);
      ctx.lineTo(width, height - 6);
      ctx.stroke();
    }
  }

  // Live Audio Visualizer Loop
  function startVisualizer() {
    if (visualizerInterval) clearInterval(visualizerInterval);

    visualizerInterval = setInterval(async () => {
      if (!state.isRecording) return;

      try {
        const audioState = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_AUDIO_STATE'
        });

        if (audioState && audioState.frequencyData) {
          renderCurrentVisualizer(audioState.frequencyData, audioState.rms || 0);
        }
      } catch (e) {}
    }, 45);
  }

  function stopVisualizer() {
    if (visualizerInterval) {
      clearInterval(visualizerInterval);
      visualizerInterval = null;
    }
    drawIdleVisualizer();
  }

  function renderCurrentVisualizer(freqArray, rms) {
    const mode = VISUALIZER_MODES[currentVisModeIndex].id;

    if (mode === 'analog') {
      drawAnalogVUMeter(rms, rms * 0.95);
    } else if (mode === 'radial') {
      drawRadialOrbit(freqArray, rms);
    } else if (mode === 'horizon') {
      draw3DHorizon(freqArray);
    } else {
      drawOledBars(freqArray);
    }
  }

  // 1. Quantum Studio OLED Bars Renderer
  function drawOledBars(freqArray) {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    const normData = getNormalizedFrequencyData(freqArray, OLED_BAR_COUNT);
    const padding = 6;
    const innerW = width - padding * 2;
    const innerH = height - 8;
    const spacing = 2;
    const barWidth = Math.floor((innerW - (OLED_BAR_COUNT * spacing)) / OLED_BAR_COUNT);

    for (let i = 0; i < OLED_BAR_COUNT; i++) {
      const targetH = Math.max(3, normData[i] * innerH);

      oledBarHeights[i] = targetH > oledBarHeights[i] ? targetH : Math.max(3, oledBarHeights[i] - 0.085 * innerH);
      oledGhostHeights[i] = oledBarHeights[i] >= oledGhostHeights[i] ? oledBarHeights[i] : Math.max(3, oledGhostHeights[i] - 0.02 * innerH);

      if (oledBarHeights[i] >= oledPeakHeights[i]) {
        oledPeakHeights[i] = oledBarHeights[i];
        oledPeakTimers[i] = 16;
      } else if (oledPeakTimers[i] > 0) {
        oledPeakTimers[i]--;
      } else {
        oledPeakHeights[i] = Math.max(3, oledPeakHeights[i] - 1.4);
      }

      const x = padding + i * (barWidth + spacing);
      const numSegs = 14;
      const segH = Math.floor(innerH / numSegs);

      // Ghost Phosphor Envelope
      if (oledGhostHeights[i] > oledBarHeights[i] + 3) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.12)';
        ctx.fillRect(x, height - oledGhostHeights[i], barWidth, oledGhostHeights[i] - oledBarHeights[i]);
      }

      // Micro LED Segment Blocks
      for (let s = 0; s < numSegs; s++) {
        const segY = height - (s + 1) * segH;
        const isLit = (s * segH) <= oledBarHeights[i];

        if (isLit) {
          if (s >= 12) {
            ctx.fillStyle = '#ef4444'; // Red Clip
          } else if (s >= 8) {
            ctx.fillStyle = '#f59e0b'; // Amber
          } else if (s >= 4) {
            ctx.fillStyle = '#06b6d4'; // Cyan
          } else {
            ctx.fillStyle = '#6366f1'; // Indigo
          }
          ctx.fillRect(x, segY + 1, barWidth, segH - 2);

          // Specular Glint
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.fillRect(x, segY + 1, barWidth, 1);
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
          ctx.fillRect(x, segY + 1, barWidth, segH - 2);
        }
      }

      // Floating Peak Cap LED
      if (oledPeakHeights[i] > 4) {
        const peakY = height - oledPeakHeights[i];
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, peakY - 2, barWidth, 2);

        ctx.save();
        ctx.shadowColor = oledPeakHeights[i] > innerH * 0.88 ? '#ef4444' : '#38bdf8';
        ctx.shadowBlur = 6;
        ctx.fillStyle = oledPeakHeights[i] > innerH * 0.88 ? '#fca5a5' : '#7dd3fc';
        ctx.fillRect(x, peakY - 1, barWidth, 1.5);
        ctx.restore();
      }
    }
  }

  // 2. Master Cyber-Analog VU Meter Renderer (Calibrated with natural headroom)
  function drawAnalogVUMeter(rL, rR) {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    // Natural musical headroom: nominal levels swing in the amber zone (-7dB to -2dB); only real spikes enter red
    const normL = Math.min(1.0, Math.pow(rL * 2.2, 0.9));
    const normR = Math.min(1.0, Math.pow(rR * 2.2, 0.9));

    const targetDbL = -20 + normL * 20.8;
    const targetDbR = -20 + normR * 20.8;

    vuVelL = (vuVelL + (targetDbL - vuNeedleL) * 0.28) * 0.78;
    vuVelR = (vuVelR + (targetDbR - vuNeedleR) * 0.28) * 0.78;
    vuNeedleL = Math.max(-21, Math.min(3.5, vuNeedleL + vuVelL));
    vuNeedleR = Math.max(-21, Math.min(3.5, vuNeedleR + vuVelR));

    if (vuNeedleL >= 0) vuPeakLampL = 1.0; else vuPeakLampL = Math.max(0, vuPeakLampL - 0.04);
    if (vuNeedleR >= 0) vuPeakLampR = 1.0; else vuPeakLampR = Math.max(0, vuPeakLampR - 0.04);

    const gw = (width / 2) - 8;
    const gh = height - 6;
    drawSingleGauge(4, 3, gw, gh, vuNeedleL, vuPeakLampL, 'LEFT (CH 1)');
    drawSingleGauge(width / 2 + 4, 3, gw, gh, vuNeedleR, vuPeakLampR, 'RIGHT (CH 2)');
  }

  function drawSingleGauge(x, y, gw, gh, dbVal, lampVal, label) {
    ctx.fillStyle = '#0f1322';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, gw, gh, 6);
    ctx.fill();
    ctx.stroke();

    // Incandescent Tube Bulb Glow
    const glow = ctx.createRadialGradient(x + gw / 2, y + gh, 4, x + gw / 2, y + gh, gw * 0.75);
    glow.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    glow.addColorStop(0.6, 'rgba(217, 119, 6, 0.06)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, gw, gh);

    const pivotX = x + gw / 2;
    const pivotY = y + gh + 12;
    const radius = gh + 6;

    const minA = -Math.PI * 0.74, maxA = -Math.PI * 0.26;

    ctx.beginPath();
    ctx.arc(pivotX, pivotY, radius, minA, maxA);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const zeroA = minA + ((20 / 23) * (maxA - minA));
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, radius, zeroA, maxA);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Ticks
    const ticks = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3];
    for (const t of ticks) {
      const norm = (t + 20) / 23;
      const angle = minA + norm * (maxA - minA);
      const isMajor = (t === 0 || t === -20 || t === 3 || t === -10);
      const innerR = radius - (isMajor ? 6 : 3);
      const outerR = radius + 2;

      ctx.strokeStyle = t >= 0 ? '#ef4444' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = t === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pivotX + Math.cos(angle) * innerR, pivotY + Math.sin(angle) * innerR);
      ctx.lineTo(pivotX + Math.cos(angle) * outerR, pivotY + Math.sin(angle) * outerR);
      ctx.stroke();
    }

    const currentNorm = Math.max(0, Math.min(1, (dbVal + 20) / 23));
    const needleA = minA + currentNorm * (maxA - minA);

    // Parallax Needle Shadow
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX + 2, pivotY + 2);
    ctx.lineTo(pivotX + Math.cos(needleA) * radius + 2, pivotY + Math.sin(needleA) * radius + 2);
    ctx.stroke();

    // Physical Needle
    ctx.save();
    ctx.shadowColor = dbVal >= 0 ? '#ef4444' : '#f59e0b';
    ctx.shadowBlur = dbVal >= 0 ? 8 : 5;
    ctx.strokeStyle = dbVal >= 0 ? '#f87171' : '#fef08a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(pivotX + Math.cos(needleA) * radius, pivotY + Math.sin(needleA) * radius);
    ctx.stroke();
    ctx.restore();

    // Brushed Hub Cap
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Thermal Overload Lamp
    const lampX = x + gw - 12;
    const lampY = y + 10;
    ctx.beginPath();
    ctx.arc(lampX, lampY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = lampVal > 0.05 ? `rgba(239, 68, 68, ${lampVal})` : 'rgba(239, 68, 68, 0.15)';
    ctx.fill();

    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillText(label, x + 6, y + 12);
    ctx.fillStyle = dbVal >= 0 ? '#f87171' : '#fcd34d';
    ctx.fillText((dbVal > 0 ? '+' : '') + dbVal.toFixed(0) + ' dB', x + 6, y + gh - 6);
  }

  // 3. Widescreen Dual Cassette Reactor Spool Renderer (Radial Mode)
  function drawRadialOrbit(freqArray, rms) {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    const normData = getNormalizedFrequencyData(freqArray, 48);
    const boostedRms = Math.min(1.0, rms * 2.5);

    // Left Spool & Right Spool Centers
    const cy = height / 2;
    const cxL = width * 0.26;
    const cxR = width * 0.74;
    const baseR = 18;

    const speed = 0.015 + boostedRms * 0.045;
    radialSpoolAngleL += speed;
    radialSpoolAngleR += speed * 1.05;
    radialOuterAngle -= speed * 0.7;

    // Sub-Bass Shockwave Ripples (Only on substantial peaks)
    if (boostedRms > 0.45 && Math.random() > 0.65) {
      radialShockwaves.push({ cx: Math.random() > 0.5 ? cxL : cxR, cy, r: baseR, maxR: 50, alpha: 0.8 });
    }

    for (let i = radialShockwaves.length - 1; i >= 0; i--) {
      const sw = radialShockwaves[i];
      sw.r += 2.0;
      sw.alpha = Math.max(0, 1 - (sw.r / sw.maxR));
      ctx.strokeStyle = `rgba(236, 72, 153, ${sw.alpha * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sw.cx, sw.cy, sw.r, 0, Math.PI * 2);
      ctx.stroke();
      if (sw.r >= sw.maxR) radialShockwaves.splice(i, 1);
    }

    // Vibrating Magnetic Tape Ribbon Connecting Both Spools
    const tapeVibe = Math.sin(Date.now() * 0.025) * (1.2 + boostedRms * 2.5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cxL, cy - baseR + 2);
    ctx.quadraticCurveTo((cxL + cxR) / 2, cy - baseR + tapeVibe, cxR, cy - baseR + 2);
    ctx.moveTo(cxL, cy + baseR - 2);
    ctx.quadraticCurveTo((cxL + cxR) / 2, cy + baseR - tapeVibe, cxR, cy + baseR - 2);
    ctx.stroke();

    // Center Stereo Level VU Readout
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.textAlign = 'center';
    ctx.fillText('CASSETTE ENGINE', width / 2, cy - 8);
    ctx.fillStyle = boostedRms > 0.55 ? '#f472b6' : '#38bdf8';
    ctx.fillText(`${(boostedRms * 100).toFixed(0)}%`, width / 2, cy + 11);
    ctx.textAlign = 'left';

    // Render Left Spool (Low/Mid Spectrum)
    drawSingleReactorSpool(cxL, cy, baseR, radialSpoolAngleL, normData.slice(0, 24), boostedRms, true);

    // Render Right Spool (Mid/High Spectrum)
    drawSingleReactorSpool(cxR, cy, baseR, radialSpoolAngleR, normData.slice(24, 48), boostedRms, false);
  }

  function drawSingleReactorSpool(cx, cy, baseR, rotAngle, freqSlice, rms, isLeft) {
    const rayCount = 24;
    const step = (Math.PI * 2) / rayCount;

    // 1. Radial Equalizer Rays
    for (let i = 0; i < rayCount; i++) {
      const a = i * step + rotAngle;
      const val = freqSlice[i % freqSlice.length] || 0;
      const len = Math.max(3, val * 20);

      const x1 = cx + Math.cos(a) * (baseR + 2);
      const y1 = cy + Math.sin(a) * (baseR + 2);
      const x2 = cx + Math.cos(a) * (baseR + 2 + len);
      const y2 = cy + Math.sin(a) * (baseR + 2 + len);

      ctx.strokeStyle = val > 0.65 ? '#f472b6' : (val > 0.35 ? '#c084fc' : '#38bdf8');
      ctx.lineWidth = 2.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 2. Glowing Core
    const coreR = baseR * (0.8 + rms * 0.3);
    const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, coreR);
    coreGrad.addColorStop(0, isLeft ? '#f472b6' : '#38bdf8');
    coreGrad.addColorStop(0.6, isLeft ? '#a855f7' : '#6366f1');
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // 3. 6-Tooth Mechanical Spool Gear
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotAngle);
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    for (let t = 0; t < 6; t++) {
      const a = (t * Math.PI) / 3;
      ctx.fillStyle = rms > 0.35 ? '#f472b6' : '#64748b';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 2.0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 4. Neon Sunset 3D Outrun Horizon Renderer
  function draw3DHorizon(freqArray) {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    const normData = getNormalizedFrequencyData(freqArray, 32);
    const slice = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      slice[i] = normData[i] * 1.15;
    }

    horizonHistory.pop();
    horizonHistory.unshift(slice);

    const cx = width / 2;
    const vanishingY = 16;
    const groundY = height - 2;
    const maxL = horizonHistory.length;

    horizonGridOffset = (horizonGridOffset + 0.035) % 1.0;

    // 1. Sliced Neon Wireframe Sun
    const sunR = 13 + normData[2] * 3;
    const sunGrad = ctx.createLinearGradient(cx, vanishingY - sunR, cx, vanishingY + sunR);
    sunGrad.addColorStop(0, '#fef08a');
    sunGrad.addColorStop(0.5, '#f43f5e');
    sunGrad.addColorStop(1, '#a855f7');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(cx, vanishingY, sunR, Math.PI, 0, false);
    ctx.fill();

    // Laser Slices
    for (let s = 1; s <= 3; s++) {
      const sy = vanishingY - s * (sunR / 4);
      ctx.fillStyle = '#06080f';
      ctx.fillRect(cx - sunR - 2, sy, sunR * 2 + 4, 1.4);
    }

    // 2. Moving Perspective Highway Scanlines
    for (let l = 0; l < 8; l++) {
      const p = Math.pow((l + horizonGridOffset) / 8, 2.2);
      const y = vanishingY + p * (groundY - vanishingY);
      ctx.strokeStyle = `rgba(168, 85, 247, ${p * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - (width / 2) * p, y);
      ctx.lineTo(cx + (width / 2) * p, y);
      ctx.stroke();
    }

    // 3. Cascading Horizon Waveform Ribbons
    for (let l = maxL - 1; l >= 0; l--) {
      const cur = horizonHistory[l];
      const p = (maxL - l) / maxL;
      const yBase = vanishingY + Math.pow(p, 1.7) * (groundY - vanishingY);
      const lw = (width - 16) * p;
      const sx = cx - lw / 2;
      const stepX = lw / (32 - 1);

      ctx.beginPath();
      ctx.moveTo(sx, yBase);
      for (let i = 0; i < 32; i++) {
        const edgeFactor = Math.abs(i - 16) / 16;
        const bh = cur[i] * (14 + edgeFactor * 18) * p;
        ctx.lineTo(sx + i * stepX, yBase - bh);
      }

      ctx.strokeStyle = l === 0 ? '#38bdf8' : `rgba(236, 72, 153, ${p * 0.75})`;
      ctx.lineWidth = l === 0 ? 2 : 1;
      ctx.stroke();

      if (l === 0) {
        ctx.lineTo(cx + lw / 2, yBase);
        ctx.lineTo(sx, yBase);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.1)';
        ctx.fill();
      }
    }
  }

  // Initial status fetch & model population
  const initialStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  updateUI(initialStatus);
  drawIdleVisualizer();
  await loadOllamaModels();

  // If idle, show active tab title as target preview
  if (!initialStatus.isRecording) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.title && !activeTab.url?.startsWith('chrome://')) {
        currentTrackTitle.textContent = activeTab.title;
        currentTrackArtist.textContent = 'Target Tab • Click Start to record';
      }
    } catch (e) {}
  }

  // Toggle Record Button Click
  toggleRecordBtn.addEventListener('click', async () => {
    if (!state.isRecording) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        alert('Could not find active tab to record.');
        return;
      }

      if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:'))) {
        alert('Cannot record audio from internal browser pages. Please open a playlist tab (e.g., YouTube, Spotify, SoundCloud, Suno).');
        return;
      }

      toggleRecordBtn.disabled = true;
      recordBtnText.textContent = 'Initializing Audio...';

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'START_RECORDING',
          tabId: activeTab.id
        });

        toggleRecordBtn.disabled = false;
        if (res && res.success) {
          const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
          updateUI(freshStatus);
        } else {
          alert('Failed to start recording: ' + (res?.error || 'Unknown error'));
          const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
          updateUI(freshStatus);
        }
      } catch (err) {
        toggleRecordBtn.disabled = false;
        alert('Error starting recording: ' + err.message);
      }
    } else {
      toggleRecordBtn.disabled = true;
      recordBtnText.textContent = 'Finalizing Track...';

      try {
        await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        toggleRecordBtn.disabled = false;
        const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
        updateUI(freshStatus);
      } catch (err) {
        toggleRecordBtn.disabled = false;
        alert('Error stopping recording: ' + err.message);
      }
    }
  });

  // Manual Cut Now Button Click
  cutNowBtn.addEventListener('click', async () => {
    if (!state.isRecording) return;

    cutNowBtn.disabled = true;
    const origHtml = cutNowBtn.innerHTML;
    cutNowBtn.innerHTML = '<span>Cutting...</span>';

    try {
      await chrome.runtime.sendMessage({ type: 'CUT_TRACK_NOW' });
    } catch (e) {
      console.warn('Error during manual cut:', e);
    } finally {
      setTimeout(async () => {
        cutNowBtn.innerHTML = origHtml;
        cutNowBtn.disabled = !state.isRecording;
        const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
        updateUI(freshStatus);
      }, 400);
    }
  });

  // Folder Name Change Handler
  folderInput.addEventListener('input', () => {
    const val = folderInput.value.trim() || 'Web_Recordings';
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      folderName: val
    });
  });

  // Automation Toggles
  autoCutToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      autoCutOnTrackChange: autoCutToggle.checked
    });
  });

  silenceCutToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      autoCutOnSilence: silenceCutToggle.checked
    });
  });

  autoStopSilenceToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      autoStopOnSilence: autoStopSilenceToggle.checked
    });
  });

  // AI Configuration Handlers
  aiNamingToggle.addEventListener('change', () => {
    const isEnabled = aiNamingToggle.checked;
    aiConfigSection.style.display = isEnabled ? 'flex' : 'none';
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      aiNamingEnabled: isEnabled
    });
  });

  aiProviderSelect.addEventListener('change', () => {
    const provider = aiProviderSelect.value;
    aiModelRow.style.display = provider === 'heuristic' ? 'none' : 'flex';
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      aiProvider: provider
    });
  });

  aiModelSelect.addEventListener('change', () => {
    if (aiModelSelect.value === '__DOWNLOAD_NEW__') {
      modelDownloaderDrawer.style.display = 'flex';
      if (state.aiModel) {
        aiModelSelect.value = state.aiModel;
      }
      return;
    }

    state.aiModel = aiModelSelect.value;
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      aiModel: aiModelSelect.value
    });
  });

  closeDownloaderBtn.addEventListener('click', () => {
    modelDownloaderDrawer.style.display = 'none';
  });

  // Model Download Action
  async function downloadModel(modelName, triggerBtn = null) {
    if (!modelName) return;

    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = '⏳ Pulling...';
    }

    pullProgressContainer.style.display = 'flex';
    pullStatusText.textContent = `Downloading ${modelName}...`;
    pullPercentText.textContent = '0%';
    pullProgressBar.style.width = '0%';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PULL_OLLAMA_MODEL',
        model: modelName
      });

      if (res && res.success) {
        pullStatusText.textContent = `✅ ${modelName} ready!`;
        pullPercentText.textContent = '100%';
        pullProgressBar.style.width = '100%';

        if (triggerBtn) {
          triggerBtn.textContent = '✅ Installed';
        }

        await loadOllamaModels();
        aiModelSelect.value = modelName;
        state.aiModel = modelName;
        chrome.runtime.sendMessage({
          type: 'UPDATE_CONFIG',
          aiModel: modelName
        });

        setTimeout(() => {
          pullProgressContainer.style.display = 'none';
          modelDownloaderDrawer.style.display = 'none';
        }, 2000);
      } else {
        pullStatusText.textContent = `❌ Error: ${res?.error || 'Pull failed'}`;
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = 'Retry';
        }
      }
    } catch (err) {
      pullStatusText.textContent = `❌ Error: ${err.message}`;
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = 'Retry';
      }
    }
  }

  // Bind 1-click download buttons
  document.querySelectorAll('.btn-pull-model').forEach((btn) => {
    btn.addEventListener('click', () => {
      const model = btn.getAttribute('data-model');
      downloadModel(model, btn);
    });
  });

  // Custom model pull button
  customPullBtn.addEventListener('click', () => {
    const val = customModelInput.value.trim();
    if (val) {
      downloadModel(val, customPullBtn);
    }
  });

  // Listen for streaming pull progress updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PULL_PROGRESS' && message.progress) {
      pullProgressContainer.style.display = 'flex';
      const pct = message.progress.percent || 0;
      pullPercentText.textContent = `${pct}%`;
      pullProgressBar.style.width = `${pct}%`;
      pullStatusText.textContent = message.progress.status || `Downloading ${message.model}...`;
    }
  });

  // AI Prompt Live Tester Button
  aiTestBtn.addEventListener('click', async () => {
    const testText = aiTestInput.value.trim() || '80s synthwave energetic cyberpunk bassline with female vocals about neon city lights';
    aiTestBtn.disabled = true;
    aiTestBtn.textContent = '...';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TEST_AI_NAMER',
        prompt: testText,
        provider: aiProviderSelect.value,
        model: aiModelSelect.value
      });

      aiTestResult.style.display = 'flex';
      aiTestResultText.textContent = res && res.title ? `${res.title}.wav` : 'Untitled Track.wav';
    } catch (e) {
      aiTestResult.style.display = 'flex';
      aiTestResultText.textContent = 'Error generating name';
    } finally {
      aiTestBtn.disabled = false;
      aiTestBtn.textContent = 'Test Name';
    }
  });

  // Clear History
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Clear recorded tracks history list? (Saved files on disk will NOT be deleted)')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      updateUI(freshStatus);
    }
  });

  // Listen for real-time background notifications
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRACK_SAVED') {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then((status) => {
        updateUI(status);
      });
    }
  });
});
