export function reconcileRecordingState(saved = {}, offscreenState = {}) {
  if (saved.isRecording && offscreenState.exists && offscreenState.isRecording) {
    return {
      isRecording: true,
      recordingTabId: saved.recordingTabId || null,
      recordingTabTitle: saved.recordingTabTitle || '',
      currentTrack: saved.currentTrack || null,
      trackStartedAt: saved.trackStartedAt || null
    };
  }

  return {
    isRecording: false,
    recordingTabId: null,
    recordingTabTitle: '',
    currentTrack: null,
    trackStartedAt: null
  };
}

export function classifyCutResult(cutResult) {
  if (!cutResult) {
    return {
      shouldAdvance: false,
      shouldSave: false,
      discarded: false,
      error: 'No response from offscreen recorder'
    };
  }

  if (cutResult.success) {
    if (!cutResult.blobUrl) {
      return {
        shouldAdvance: false,
        shouldSave: false,
        discarded: false,
        error: 'Cut response contained no audio data'
      };
    }

    return {
      shouldAdvance: true,
      shouldSave: Number(cutResult.durationSec) >= 2.0,
      discarded: false,
      error: null
    };
  }

  if (cutResult.isSilent) {
    return {
      shouldAdvance: true,
      shouldSave: false,
      discarded: true,
      error: cutResult.error || 'Buffer contained only silence'
    };
  }

  return {
    shouldAdvance: false,
    shouldSave: false,
    discarded: false,
    error: cutResult.error || 'Offscreen recorder rejected the cut'
  };
}
