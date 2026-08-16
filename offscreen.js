/**
 * Offscreen Document Script - Manages Tab Audio Capture, PCM Buffering,
 * Real-time Silence Detection, and WAV Chunk Slicing.
 */

import {
  shouldSplitForDurationLimit
} from './recording_limits.js';
import WavEncoder from './wav_encoder.js';

let audioContext = null;
let mediaStream = null;
let mediaSource = null;
let scriptProcessor = null;
let processorSink = null;
let analyserNode = null;

// Audio buffer for the current active track
let pcmChunks = [];
let totalSamplesRecorded = 0;
let trackStartTime = 0;
let isRecording = false;
let durationLimitTriggered = false;

// Silence detection settings
let silenceDetectionEnabled = true;
let autoStopOnSilence = true;
let silenceThreshold = 0.015; // RMS amplitude below which is considered a track break/silence
let silenceDurationMs = 800; // 0.8s pause between tracks to trigger cut
let autoStopDurationMs = 5000; // 5.0s pause to stop recording completely
let silentSince = null;
let continuousSilenceStart = null;
let minTrackDurationSec = 4; // Minimum 4s duration before allowing a silence cut

// Track audio content tracking (prevents saving empty/silent ghost tracks)
let hasAudibleContentInCurrentTrack = false;
let audibleSamplesInCurrentTrack = 0;

// Level metering
let currentRMS = 0;
const activeBlobUrls = new Set();
const BACKGROUND_URL = chrome.runtime.getURL('background.js');

function isBackgroundSender(sender) {
  return sender?.id === chrome.runtime.id
    && !sender.tab
    && (!sender.url || sender.url === BACKGROUND_URL);
}

function revokeAudioUrl(blobUrl) {
  if (!activeBlobUrls.has(blobUrl)) return;
  URL.revokeObjectURL(blobUrl);
  activeBlobUrls.delete(blobUrl);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;
  if (!isBackgroundSender(sender)) {
    sendResponse({ success: false, error: 'Unauthorized message sender' });
    return false;
  }

  switch (message.type) {
    case 'PING':
      sendResponse({ pong: true, isRecording: isRecording });
      return false;

    case 'START_CAPTURE':
      handleStartCapture(message.streamId, message.options)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CUT_TRACK':
      handleCutTrack(message.reason)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'STOP_CAPTURE':
      handleStopCapture()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_AUDIO_STATE':
      sendResponse(getAudioState());
      return false;

    case 'UPDATE_SETTINGS':
      if (typeof message.silenceDetectionEnabled === 'boolean') {
        silenceDetectionEnabled = message.silenceDetectionEnabled;
      }
      if (typeof message.autoStopOnSilence === 'boolean') {
        autoStopOnSilence = message.autoStopOnSilence;
      }
      if (typeof message.silenceThreshold === 'number') {
        silenceThreshold = message.silenceThreshold;
      }
      if (typeof message.silenceDurationMs === 'number') {
        silenceDurationMs = message.silenceDurationMs;
      }
      sendResponse({ success: true });
      return false;

    case 'REVOKE_AUDIO_URL':
      revokeAudioUrl(message.blobUrl);
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

/**
 * Initializes Tab Audio capture with given stream ID
 */
async function handleStartCapture(streamId, options = {}) {
  try {
    if (isRecording) {
      await handleStopCapture();
    }

    if (options.silenceDetectionEnabled !== undefined) {
      silenceDetectionEnabled = options.silenceDetectionEnabled;
    }
    if (options.autoStopOnSilence !== undefined) {
      autoStopOnSilence = options.autoStopOnSilence;
    }
    if (options.silenceThreshold !== undefined) {
      silenceThreshold = options.silenceThreshold;
    }

    // Capture tab audio stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    if (!mediaStream || mediaStream.getAudioTracks().length === 0) {
      throw new Error('No active audio track found in tab stream');
    }

    const audioTrack = mediaStream.getAudioTracks()[0];
    audioTrack.enabled = true;

    // Create and resume AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'playback'
    });

    if (audioContext.state !== 'running') {
      await audioContext.resume();
    }

    mediaSource = audioContext.createMediaStreamSource(mediaStream);

    // Route audio to speakers so user can continue hearing tab playback
    mediaSource.connect(audioContext.destination);

    // Create AnalyserNode for visualizer and RMS level with expanded dynamic range
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.55;
    analyserNode.minDecibels = -80;
    analyserNode.maxDecibels = -10;
    mediaSource.connect(analyserNode);

    // Create ScriptProcessor to capture PCM samples
    const bufferSize = 4096;
    scriptProcessor = audioContext.createScriptProcessor(bufferSize, 2, 2);

    // Reset buffer
    pcmChunks = [];
    totalSamplesRecorded = 0;
    trackStartTime = Date.now();
    silentSince = null;
    continuousSilenceStart = null;
    hasAudibleContentInCurrentTrack = false;
    audibleSamplesInCurrentTrack = 0;
    durationLimitTriggered = false;
    isRecording = true;

    scriptProcessor.onaudioprocess = onAudioProcess;

    mediaSource.connect(scriptProcessor);
    processorSink = audioContext.createGain();
    processorSink.gain.value = 0;
    scriptProcessor.connect(processorSink);
    processorSink.connect(audioContext.destination);

    return { success: true, sampleRate: audioContext.sampleRate };
  } catch (error) {
    console.error('Failed to start audio capture in offscreen:', error);
    isRecording = false;
    throw error;
  }
}

/**
 * PCM Audio Processing Loop
 */
function onAudioProcess(e) {
  if (!isRecording) return;

  const inputLeft = e.inputBuffer.getChannelData(0);
  const inputRight = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputLeft;

  pcmChunks.push(WavEncoder.floatChannelsToInterleavedPcm16(inputLeft, inputRight));
  totalSamplesRecorded += inputLeft.length;

  const bufferedDurationSec = audioContext
    ? totalSamplesRecorded / audioContext.sampleRate
    : 0;
  if (
    shouldSplitForDurationLimit(bufferedDurationSec) &&
    !durationLimitTriggered
  ) {
    durationLimitTriggered = true;
    chrome.runtime.sendMessage({
      type: 'TRACK_DURATION_LIMIT_TRIGGERED',
      timestamp: Date.now(),
      trackDurationSec: bufferedDurationSec
    }).then((response) => {
      if (!response?.success) durationLimitTriggered = false;
    }).catch(() => {
      durationLimitTriggered = false;
    });
  }

  // Calculate RMS for silence detection and metering
  let sum = 0;
  for (let i = 0; i < inputLeft.length; i++) {
    sum += inputLeft[i] * inputLeft[i];
  }
  const rms = Math.sqrt(sum / inputLeft.length);
  currentRMS = rms;

  // Track if current buffer contains actual audible sound
  if (rms >= silenceThreshold) {
    hasAudibleContentInCurrentTrack = true;
    audibleSamplesInCurrentTrack += inputLeft.length;
  }

  // Silence detection & Auto-Stop logic
  const now = Date.now();
  const trackDurationSec = (now - trackStartTime) / 1000;

  if (rms < silenceThreshold) {
    // 1. Continuous silence counter for ~5s auto-stop
    if (!continuousSilenceStart) {
      continuousSilenceStart = now;
    } else if (autoStopOnSilence && now - continuousSilenceStart >= autoStopDurationMs) {
      continuousSilenceStart = null;
      silentSince = null;
      chrome.runtime.sendMessage({
        type: 'AUTO_STOP_SILENCE_TRIGGERED',
        timestamp: now
      }).catch(() => {});
    }

    // 2. Track break (~0.8s) counter for song transition
    if (silenceDetectionEnabled && hasAudibleContentInCurrentTrack) {
      if (!silentSince) {
        silentSince = now;
      } else if (now - silentSince >= silenceDurationMs && trackDurationSec >= minTrackDurationSec) {
        silentSince = null;
        chrome.runtime.sendMessage({
          type: 'SILENCE_CUT_TRIGGERED',
          timestamp: now,
          trackDurationSec
        }).catch(() => {});
      }
    }
  } else {
    // Active sound detected - reset silence counters
    silentSince = null;
    continuousSilenceStart = null;
  }
}

/**
 * Cuts current recorded buffer, encodes it to WAV, and resets for next track
 */
async function handleCutTrack(reason = 'manual') {
  if (!isRecording || !audioContext) {
    return { success: false, error: 'Not currently recording' };
  }

  const sampleRate = audioContext.sampleRate;
  const chunkCount = pcmChunks.length;

  if (chunkCount === 0 || totalSamplesRecorded === 0) {
    return { success: false, error: 'No audio data captured' };
  }

  // If buffer has NO audible content and was not forced by manual user click, discard silence
  if (!hasAudibleContentInCurrentTrack && reason !== 'manual') {
    pcmChunks = [];
    totalSamplesRecorded = 0;
    hasAudibleContentInCurrentTrack = false;
    audibleSamplesInCurrentTrack = 0;
    trackStartTime = Date.now();
    silentSince = null;
    durationLimitTriggered = false;
    return { success: false, isSilent: true, error: 'Buffer contains only silence' };
  }

  let finalSamples = totalSamplesRecorded;

  // If cut was triggered by silence gap (>0.8s), trim the trailing silence (~0.8s) so song ends cleanly
  if ((reason === 'silence-gap' || reason === 'silence') && sampleRate) {
    const trailingSilenceSamples = Math.floor((silenceDurationMs / 1000) * sampleRate);
    if (finalSamples > trailingSilenceSamples + (2.0 * sampleRate)) {
      finalSamples -= trailingSilenceSamples;
    }
  }

  const durationSec = finalSamples / sampleRate;

  // Don't cut or save micro-snippets (less than 2.0s) unless manually requested
  if (durationSec < 2.0 && reason !== 'stop' && reason !== 'manual') {
    return { success: false, error: 'Track duration too short (<2s)', durationSec };
  }

  // Reset buffers for the next track
  const finishedChunks = pcmChunks;
  pcmChunks = [];
  totalSamplesRecorded = 0;
  hasAudibleContentInCurrentTrack = false;
  audibleSamplesInCurrentTrack = 0;
  trackStartTime = Date.now();
  silentSince = null;
  durationLimitTriggered = false;

  const wavBlob = WavEncoder.encodePcm16Chunks(
    finishedChunks,
    sampleRate,
    2,
    finalSamples
  );
  const blobUrl = URL.createObjectURL(wavBlob);
  activeBlobUrls.add(blobUrl);
  setTimeout(() => revokeAudioUrl(blobUrl), 15 * 60 * 1000);

  return {
    success: true,
    blobUrl,
    durationSec,
    sampleRate,
    sizeBytes: wavBlob.size,
    reason
  };
}

/**
 * Stops audio capture, encodes final track if audio exists, and releases resources
 */
async function handleStopCapture() {
  if (!isRecording && !mediaStream) {
    return { success: true, finalTrack: null };
  }

  let finalTrack = null;
  const sampleRate = audioContext ? audioContext.sampleRate : 44100;
  const durationSec = totalSamplesRecorded / sampleRate;

  // Only save final track if it has audible audio content and valid duration
  if (hasAudibleContentInCurrentTrack && totalSamplesRecorded > 0 && durationSec >= 2.0) {
    try {
      finalTrack = await handleCutTrack('stop');
    } catch (err) {
      console.warn('Error saving final track on stop:', err);
    }
  }

  isRecording = false;
  hasAudibleContentInCurrentTrack = false;
  audibleSamplesInCurrentTrack = 0;
  pcmChunks = [];
  totalSamplesRecorded = 0;
  durationLimitTriggered = false;

  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor.onaudioprocess = null;
    scriptProcessor = null;
  }

  if (processorSink) {
    processorSink.disconnect();
    processorSink = null;
  }

  if (mediaSource) {
    mediaSource.disconnect();
    mediaSource = null;
  }

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  pcmChunks = [];
  totalSamplesRecorded = 0;
  silentSince = null;
  continuousSilenceStart = null;
  durationLimitTriggered = false;

  return { success: true, finalTrack };
}

/**
 * Returns real-time audio analysis data for visualizer
 */
function getAudioState() {
  if (!analyserNode || !isRecording) {
    return { isRecording: false, rms: 0, frequencyData: [] };
  }

  const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(frequencyData);

  const durationSec = audioContext ? totalSamplesRecorded / audioContext.sampleRate : 0;

  return {
    isRecording: true,
    rms: currentRMS,
    frequencyData: Array.from(frequencyData.slice(0, 64)),
    currentTrackDurationSec: durationSec
  };
}
