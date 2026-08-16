/**
 * Background Service Worker - Orchestrates Audio Capture, State,
 * Track Boundary Events, Duplicate Name Resolution, AI Track Naming, and Folder Downloads.
 */

import AINamer from './ai_namer.js';
import {
  DEFAULT_LOCAL_AI_ENDPOINT,
  normalizeLocalAiEndpoint
} from './local_endpoint_policy.js';
import TrackTransitionQueue from './track_transition_queue.js';
import { classifyCutResult, reconcileRecordingState } from './runtime_state_logic.js';
import './track_metadata_logic.js';

const OFFSCREEN_PATH = 'offscreen.html';
const metadataLogic = globalThis.TrackSnipMetadata;

// In-memory state
let state = {
  isRecording: false,
  recordingTabId: null,
  recordingTabTitle: '',
  folderName: 'Web_Recordings',
  autoCutOnTrackChange: true,
  autoCutOnSilence: true,
  autoStopOnSilence: true,
  silenceThreshold: 0.015,
  currentTrack: null,
  trackStartedAt: null,
  // AI Naming Configuration
  aiNamingEnabled: true,
  aiProvider: 'ollama', // 'ollama' | 'openai-compatible' | 'heuristic'
  aiEndpoint: DEFAULT_LOCAL_AI_ENDPOINT,
  aiModel: 'qwen2.5:1.5b',
  // Dictionary mapping sanitized track names to count of occurrences in this session
  trackNameCounts: {},
  // History of recorded tracks in the current session
  recordedTracks: []
};

const pendingSaves = new Set();
let stopPromise = null;

const OLLAMA_RULE_IDS = [1, 2];

async function removeLegacyOllamaHeaderRules() {
  try {
    await chrome.declarativeNetRequest?.updateDynamicRules({
      removeRuleIds: OLLAMA_RULE_IDS
    });
  } catch (error) {
    console.warn('Legacy Ollama rule cleanup:', error);
  }
}

// Keep the Ollama Origin workaround session-only and limited to extension-owned requests.
async function setupOllamaHeaderRules() {
  try {
    if (chrome.declarativeNetRequest) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: OLLAMA_RULE_IDS,
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'http://localhost:11434' }
              ]
            },
            condition: {
              regexFilter: '^http://localhost:11434/api/(generate|tags|pull)/?$',
              initiatorDomains: [chrome.runtime.id],
              requestDomains: ['localhost'],
              resourceTypes: ['xmlhttprequest', 'other']
            }
          },
          {
            id: 2,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'http://127.0.0.1:11434' }
              ]
            },
            condition: {
              regexFilter: '^http://127\\.0\\.0\\.1:11434/api/(generate|tags|pull)/?$',
              initiatorDomains: [chrome.runtime.id],
              requestDomains: ['127.0.0.1'],
              resourceTypes: ['xmlhttprequest', 'other']
            }
          }
        ]
      });
    }
  } catch (e) {
    console.warn('DeclarativeNetRequest rule registration:', e);
  }
}

removeLegacyOllamaHeaderRules();
setupOllamaHeaderRules();

let isInitialized = false;
let initPromise = null;

async function getOffscreenRecordingState() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length === 0) {
    return { exists: false, isRecording: false };
  }

  try {
    const ping = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PING'
    });
    return { exists: true, isRecording: ping?.isRecording === true };
  } catch (_error) {
    return { exists: true, isRecording: false };
  }
}

/**
 * Restores state from chrome.storage.local on any service worker startup/wake-up
 */
async function restoreState() {
  try {
    const saved = await chrome.storage.local.get([
      'isRecording',
      'recordingTabId',
      'recordingTabTitle',
      'folderName',
      'autoCutOnTrackChange',
      'autoCutOnSilence',
      'autoStopOnSilence',
      'silenceThreshold',
      'currentTrack',
      'trackStartedAt',
      'aiNamingEnabled',
      'aiProvider',
      'aiEndpoint',
      'aiModel',
      'trackNameCounts',
      'recordedTracks'
    ]);

    if (saved.folderName) state.folderName = saved.folderName;
    if (saved.autoCutOnTrackChange !== undefined) state.autoCutOnTrackChange = saved.autoCutOnTrackChange;
    if (saved.autoCutOnSilence !== undefined) state.autoCutOnSilence = saved.autoCutOnSilence;
    if (saved.autoStopOnSilence !== undefined) state.autoStopOnSilence = saved.autoStopOnSilence;
    if (saved.silenceThreshold !== undefined) state.silenceThreshold = saved.silenceThreshold;
    if (saved.aiNamingEnabled !== undefined) state.aiNamingEnabled = saved.aiNamingEnabled;
    if (saved.aiProvider) state.aiProvider = saved.aiProvider;
    if (saved.aiEndpoint) {
      try {
        state.aiEndpoint = normalizeLocalAiEndpoint(saved.aiEndpoint);
      } catch (_error) {
        state.aiEndpoint = DEFAULT_LOCAL_AI_ENDPOINT;
      }
    }
    if (saved.aiModel) state.aiModel = saved.aiModel;
    if (saved.trackNameCounts) state.trackNameCounts = saved.trackNameCounts;
    if (saved.recordedTracks) state.recordedTracks = saved.recordedTracks;

    const offscreenState = saved.isRecording
      ? await getOffscreenRecordingState()
      : { exists: false, isRecording: false };
    const reconciledRecordingState = reconcileRecordingState(saved, offscreenState);
    Object.assign(state, reconciledRecordingState);

    if (saved.isRecording && !reconciledRecordingState.isRecording) {
      await syncStorage();
    }
  } catch (err) {
    console.warn('State restoration failed:', err);
  } finally {
    isInitialized = true;
  }
}

function ensureInitialized() {
  if (isInitialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = restoreState();
  }
  return initPromise;
}

// Start restoration immediately on worker load
initPromise = restoreState();

// Initialize state and network rules after install/update.
chrome.runtime.onInstalled.addListener(async () => {
  await removeLegacyOllamaHeaderRules();
  setupOllamaHeaderRules();
  await ensureInitialized();
  await syncStorage();
});

/**
 * Saves current state to chrome.storage.local
 */
async function syncStorage() {
  await chrome.storage.local.set({
    isRecording: state.isRecording,
    recordingTabId: state.recordingTabId,
    recordingTabTitle: state.recordingTabTitle,
    folderName: state.folderName,
    autoCutOnTrackChange: state.autoCutOnTrackChange,
    autoCutOnSilence: state.autoCutOnSilence,
    autoStopOnSilence: state.autoStopOnSilence,
    silenceThreshold: state.silenceThreshold,
    currentTrack: state.currentTrack,
    trackStartedAt: state.trackStartedAt,
    aiNamingEnabled: state.aiNamingEnabled,
    aiProvider: state.aiProvider,
    aiEndpoint: state.aiEndpoint,
    aiModel: state.aiModel,
    trackNameCounts: state.trackNameCounts,
    recordedTracks: state.recordedTracks
  });
}

/**
 * Ensures Offscreen Document exists and is ready
 */
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Capture and process tab audio for track recording'
    });
  }

  // Ping offscreen document until it responds
  for (let i = 0; i < 12; i++) {
    try {
      const pingRes = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'PING'
      });
      if (pingRes && pingRes.pong) {
        return;
      }
    } catch (e) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Closes Offscreen Document
 */
async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

/**
 * Sanitizes filename and folder names for all OS filesystems
 */
function sanitizeFilename(name) {
  if (!name) return 'Untitled_Track';
  let clean = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  clean = clean.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim();
  }
  return clean || 'Untitled_Track';
}

/**
 * Computes destination filename with duplicate naming convention:
 * 1st track: "Song Name.wav"
 * 2nd track (1st dupe): "Song Name 1.wav"
 * 3rd track (2nd dupe): "Song Name 2.wav"
 * 4th track (3rd dupe): "Song Name 3.wav"
 */
function resolveUniqueFilename(baseTrackTitle) {
  const sanitizedBase = sanitizeFilename(baseTrackTitle);
  const existingCount = state.trackNameCounts[sanitizedBase] || 0;

  let finalFilename;
  if (existingCount === 0) {
    finalFilename = `${sanitizedBase}.wav`;
    state.trackNameCounts[sanitizedBase] = 1;
  } else {
    finalFilename = `${sanitizedBase} ${existingCount}.wav`;
    state.trackNameCounts[sanitizedBase] = existingCount + 1;
  }

  return finalFilename;
}

/**
 * Handles Start Recording request
 */
async function startRecording(tabId) {
  if (stopPromise) {
    await stopPromise;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    state.recordingTabId = tabId;
    state.recordingTabTitle = tab.title || 'Web Tab';

    // activeTab grants temporary access after the user clicks the extension action.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['track_metadata_logic.js', 'content_script.js']
    });
    await chrome.tabs.sendMessage(tabId, { type: 'START_TRACK_METADATA' });

    // Get MediaStream ID for tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    await setupOffscreenDocument();

    // Query active track metadata from content script
    let initialTrack = {
      title: tab.title || 'Untitled Track',
      artist: '',
      formattedName: tab.title || 'Untitled Track',
      url: tab.url || ''
    };

    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_CURRENT_TRACK' });
      if (response && response.track && response.track.title !== 'Unknown Track') {
        initialTrack = response.track;
      }
    } catch (e) {}

    state.currentTrack = initialTrack;
    state.trackStartedAt = Date.now();

    // Send stream ID to offscreen document
    const offscreenRes = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_CAPTURE',
      streamId: streamId,
      options: {
        silenceDetectionEnabled: state.autoCutOnSilence,
        autoStopOnSilence: state.autoStopOnSilence,
        silenceThreshold: state.silenceThreshold
      }
    });

    if (!offscreenRes || !offscreenRes.success) {
      throw new Error(offscreenRes?.error || 'Failed to start offscreen capture');
    }

    state.isRecording = true;
    transitionQueue.resume();
    await syncStorage();
    return { success: true, currentTrack: state.currentTrack };
  } catch (error) {
    console.error('startRecording error:', error);
    transitionQueue.pause();
    if (state.recordingTabId !== null) {
      await chrome.tabs.sendMessage(
        state.recordingTabId,
        { type: 'STOP_TRACK_METADATA' }
      ).catch(() => {});
    }
    state.isRecording = false;
    state.recordingTabId = null;
    await syncStorage();
    throw error;
  }
}

/**
 * Saves cut audio chunk to disk via chrome.downloads API with AI Naming
 */
async function saveCutTrack(cutResult, trackMetadata) {
  if (!cutResult || !cutResult.dataUrl || cutResult.durationSec < 2.0) {
    return null;
  }

  const metadataTitle = trackMetadata?.title || trackMetadata?.formattedName || 'Recorded Track';
  const rawTitle = trackMetadata?.formattedName || metadataTitle;
  let titleToUse = rawTitle;

  if (metadataLogic.isReliableMetadataSource(trackMetadata?.source)) {
    titleToUse = AINamer.cleanMetadataTitle(metadataTitle);
  } else if (state.aiNamingEnabled) {
    try {
      titleToUse = await AINamer.generateTitle(rawTitle, {
        enabled: state.aiNamingEnabled,
        provider: state.aiProvider,
        endpoint: state.aiEndpoint,
        model: state.aiModel
      });
    } catch (e) {
      console.warn('AI naming fallback:', e);
      titleToUse = AINamer.cleanHeuristicTitle(rawTitle);
    }
  }

  const fileName = resolveUniqueFilename(titleToUse);
  const folder = sanitizeFilename(state.folderName || 'Web_Recordings');
  const targetPath = `${folder}/${fileName}`;

  const downloadId = await chrome.downloads.download({
    url: cutResult.dataUrl,
    filename: targetPath,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  const recordItem = {
    id: Date.now().toString(),
    title: titleToUse,
    rawPrompt: rawTitle,
    artist: trackMetadata?.artist || '',
    filename: fileName,
    folder: folder,
    fullPath: targetPath,
    durationSec: Math.round(cutResult.durationSec || 0),
    sizeBytes: cutResult.sizeBytes || 0,
    timestamp: Date.now(),
    downloadId: downloadId
  };

  state.recordedTracks.unshift(recordItem);
  if (state.recordedTracks.length > 100) {
    state.recordedTracks.pop();
  }

  await syncStorage();

  // Notify any open popup
  chrome.runtime.sendMessage({
    type: 'TRACK_SAVED',
    track: recordItem
  }).catch(() => {});

  return recordItem;
}

function trackPendingSave(savePromise) {
  pendingSaves.add(savePromise);
  void savePromise.then(
    () => pendingSaves.delete(savePromise),
    () => pendingSaves.delete(savePromise)
  );
  return savePromise;
}

/**
 * Captures one audio boundary and advances metadata immediately.
 * Naming and download continue independently so the next skip is not blocked.
 */
async function captureTrackBoundary({ newTrackMetadata = null, reason = 'manual' } = {}) {
  if (!state.isRecording) {
    return { success: false, error: 'Not recording', savePromise: Promise.resolve(null) };
  }

  const elapsedSec = (Date.now() - (state.trackStartedAt || Date.now())) / 1000;
  const minimumDurationSec = reason === 'silence-gap' ? 4.0 : 2.0;
  if (reason !== 'manual' && reason !== 'stop' && elapsedSec < minimumDurationSec) {
    if (newTrackMetadata) {
      state.currentTrack = newTrackMetadata;
      state.trackStartedAt = Date.now();
      await syncStorage();
    }
    return {
      success: false,
      discardedShortTrack: true,
      error: `Track duration too short to auto-cut (<${minimumDurationSec}s)`,
      savePromise: Promise.resolve(null)
    };
  }

  try {
    const finishedTrackMeta = { ...state.currentTrack };
    const cutRes = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'CUT_TRACK',
      reason: reason
    });

    const cutOutcome = classifyCutResult(cutRes);
    if (!cutOutcome.shouldAdvance) {
      return {
        success: false,
        error: cutOutcome.error,
        savePromise: Promise.resolve(null)
      };
    }

    if (newTrackMetadata) {
      state.currentTrack = newTrackMetadata;
    }
    state.trackStartedAt = Date.now();
    await syncStorage();

    const savePromise = cutOutcome.shouldSave
      ? trackPendingSave(saveCutTrack(cutRes, finishedTrackMeta))
      : Promise.resolve(null);

    return {
      success: true,
      discarded: cutOutcome.discarded,
      savedTrack: cutOutcome.shouldSave ? finishedTrackMeta : null,
      savePromise
    };
  } catch (error) {
    console.error('cutCurrentTrack error:', error);
    return { success: false, error: error.message, savePromise: Promise.resolve(null) };
  }
}

const transitionQueue = new TrackTransitionQueue(captureTrackBoundary);

async function cutCurrentTrack(newTrackMetadata = null, reason = 'manual') {
  const result = await transitionQueue.enqueue({ newTrackMetadata, reason });
  const savedRecord = await result.savePromise;
  return { ...result, savePromise: undefined, savedRecord };
}

/**
 * Stops recording completely and finalizes last track
 */
async function stopRecording() {
  if (stopPromise) return stopPromise;
  if (!state.isRecording) return { success: true };

  transitionQueue.pause();
  stopPromise = (async () => {
    try {
      await transitionQueue.drain();
      const finishedTrackMeta = { ...state.currentTrack };

      const stopRes = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'STOP_CAPTURE'
      });

      if (stopRes && stopRes.finalTrack && stopRes.finalTrack.dataUrl && stopRes.finalTrack.durationSec >= 2.0) {
        await saveCutTrack(stopRes.finalTrack, finishedTrackMeta);
      }

      await Promise.allSettled(Array.from(pendingSaves));
      await closeOffscreenDocument();
    } catch (error) {
      console.warn('Error during stop capture cleanup:', error);
    } finally {
      if (state.recordingTabId !== null) {
        await chrome.tabs.sendMessage(
          state.recordingTabId,
          { type: 'STOP_TRACK_METADATA' }
        ).catch(() => {});
      }
      state.isRecording = false;
      state.recordingTabId = null;
      state.recordingTabTitle = '';
      state.currentTrack = null;
      state.trackStartedAt = null;
      await syncStorage();
    }

    return { success: true };
  })();

  try {
    return await stopPromise;
  } finally {
    stopPromise = null;
  }
}

function isOffscreenSender(sender) {
  return sender?.url === chrome.runtime.getURL(OFFSCREEN_PATH);
}

async function handleRuntimeMessage(message, sender) {
  switch (message.type) {
    case 'GET_STATUS':
      return {
        isRecording: state.isRecording,
        recordingTabId: state.recordingTabId,
        recordingTabTitle: state.recordingTabTitle,
        folderName: state.folderName,
        autoCutOnTrackChange: state.autoCutOnTrackChange,
        autoCutOnSilence: state.autoCutOnSilence,
        autoStopOnSilence: state.autoStopOnSilence,
        silenceThreshold: state.silenceThreshold,
        currentTrack: state.currentTrack,
        trackStartedAt: state.trackStartedAt,
        aiNamingEnabled: state.aiNamingEnabled,
        aiProvider: state.aiProvider,
        aiEndpoint: state.aiEndpoint,
        aiModel: state.aiModel,
        recordedTracks: state.recordedTracks
      };

    case 'START_RECORDING':
      return startRecording(message.tabId);

    case 'STOP_RECORDING':
      return stopRecording();

    case 'CUT_TRACK_NOW':
      return cutCurrentTrack(message.newTrack || null, 'manual');

    case 'TRACK_CHANGED_IN_TAB':
      if (state.isRecording && sender.tab && sender.tab.id === state.recordingTabId) {
        if (
          message.isInitial ||
          !state.currentTrack ||
          !metadataLogic.isDifferentTrack(state.currentTrack, message.track)
        ) {
          state.currentTrack = { ...state.currentTrack, ...message.track };
          await syncStorage();
          return { success: true, accepted: true, changed: false };
        }

        if (state.autoCutOnTrackChange) {
          const result = await cutCurrentTrack(
            message.track,
            message.triggerReason || 'auto-playlist-change'
          );
          return { ...result, accepted: true, changed: true };
        } else {
          state.currentTrack = message.track;
          state.trackStartedAt = Date.now();
          await syncStorage();
          return { success: true, accepted: true, changed: true };
        }
      }
      return { success: true, accepted: true, changed: false };

    case 'MEDIA_ENDED_IN_TAB':
      if (state.isRecording && sender.tab && sender.tab.id === state.recordingTabId) {
        const elapsedSec = (Date.now() - (state.trackStartedAt || Date.now())) / 1000;
        if (elapsedSec >= 2 && state.autoCutOnTrackChange) {
          return cutCurrentTrack(null, 'media-ended');
        }
      }
      return { success: true, accepted: true, changed: false };

    case 'SILENCE_CUT_TRIGGERED':
      if (state.isRecording && isOffscreenSender(sender) && state.autoCutOnSilence) {
        return cutCurrentTrack(state.currentTrack, 'silence-gap');
      }
      return { success: true, accepted: true, changed: false };

    case 'AUTO_STOP_SILENCE_TRIGGERED':
      if (state.isRecording && isOffscreenSender(sender) && state.autoStopOnSilence) {
        console.log('Continuous 5s silence reached. Automatically stopping recording...');
        return stopRecording();
      }
      return { success: true, accepted: true, changed: false };

    case 'TRACK_DURATION_LIMIT_TRIGGERED':
      if (state.isRecording && isOffscreenSender(sender)) {
        return cutCurrentTrack(state.currentTrack, 'duration-limit');
      }
      return { success: true, accepted: true, changed: false };

    case 'UPDATE_CONFIG':
      if (message.folderName !== undefined) state.folderName = message.folderName;
      if (message.autoCutOnTrackChange !== undefined) state.autoCutOnTrackChange = message.autoCutOnTrackChange;
      if (message.autoCutOnSilence !== undefined) state.autoCutOnSilence = message.autoCutOnSilence;
      if (message.autoStopOnSilence !== undefined) state.autoStopOnSilence = message.autoStopOnSilence;
      if (message.silenceThreshold !== undefined) state.silenceThreshold = message.silenceThreshold;
      if (message.aiNamingEnabled !== undefined) state.aiNamingEnabled = message.aiNamingEnabled;
      if (message.aiProvider !== undefined) state.aiProvider = message.aiProvider;
      if (message.aiEndpoint !== undefined) {
        state.aiEndpoint = normalizeLocalAiEndpoint(message.aiEndpoint);
      }
      if (message.aiModel !== undefined) state.aiModel = message.aiModel;
      await syncStorage();

      if (state.isRecording) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'UPDATE_SETTINGS',
          silenceDetectionEnabled: state.autoCutOnSilence,
          autoStopOnSilence: state.autoStopOnSilence,
          silenceThreshold: state.silenceThreshold
        }).catch(() => {});
      }

      return { success: true };

    case 'TEST_AI_NAMER':
      return {
        success: true,
        title: await AINamer.generateTitle(message.prompt, {
          enabled: true,
          provider: message.provider || state.aiProvider,
          endpoint: state.aiEndpoint,
          model: message.model || state.aiModel
        })
      };

    case 'FETCH_AI_MODELS':
      return {
        success: true,
        models: await AINamer.fetchOllamaModels(state.aiEndpoint)
      };

    case 'PULL_OLLAMA_MODEL': {
      await AINamer.pullOllamaModel(message.model, state.aiEndpoint, (progress) => {
        chrome.runtime.sendMessage({
          type: 'PULL_PROGRESS',
          model: message.model,
          progress: progress
        }).catch(() => {});
      });
      state.aiModel = message.model;
      await syncStorage();
      return { success: true, model: message.model };
    }

    case 'CLEAR_HISTORY':
      state.recordedTracks = [];
      state.trackNameCounts = {};
      await syncStorage();
      return { success: true };

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// Gate every stateful event on storage restoration after a service worker wake.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') return false;

  ensureInitialized()
    .then(() => handleRuntimeMessage(message, sender))
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true;
});

// If recorded tab is closed, automatically finalize and stop
chrome.tabs.onRemoved.addListener((tabId) => {
  ensureInitialized().then(() => {
    if (state.isRecording && state.recordingTabId === tabId) {
      return stopRecording();
    }
    return null;
  }).catch(() => {});
});
