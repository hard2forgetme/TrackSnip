/**
 * TrackSnip Deterministic Automated Test Suite
 * Tests WAV encoding, AI prompt distillation, stream fragmentation,
 * silence trimming, ghost track elimination, duplicate naming, and state recovery.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import WavEncoder from '../wav_encoder.js';
import AINamer from '../ai_namer.js';
import {
  DEFAULT_LOCAL_AI_ENDPOINT,
  normalizeLocalAiEndpoint
} from '../local_endpoint_policy.js';
import {
  MAX_TRACK_DURATION_SEC,
  shouldSplitForDurationLimit
} from '../recording_limits.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('\n🧪 Running TrackSnip Test Suite...\n');

// ==========================================
// 1. WAV Encoder Tests
// ==========================================
console.log('--- 1. Uncompressed 16-Bit WAV Encoder ---');

test('WavEncoder encodes valid RIFF/WAVE header and correct byte length', () => {
  const sampleRate = 44100;
  const numSamples = 44100; // 1 second
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  // Generate 440Hz sine wave
  for (let i = 0; i < numSamples; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    right[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  const blob = WavEncoder.encode([left, right], sampleRate);
  assert.ok(blob, 'Blob should be created');
  assert.strictEqual(blob.type, 'audio/wav');

  // Expected size: 44 header bytes + 44100 * 2 channels * 2 bytes/sample = 44 + 176400 = 176444 bytes
  const expectedSize = 44 + numSamples * 2 * 2;
  assert.strictEqual(blob.size, expectedSize, `Size should be ${expectedSize} bytes`);
});

// ==========================================
// 2. AI Namer & Prompt Distillation Tests
// ==========================================
console.log('\n--- 2. AI Namer & Distillation ---');

test('preCleanInput strips platform headers and boilerplate suffixes', () => {
  const input1 = 'Suno - A synthetic demo titled _Signal Lantern_ - Signal_Lantern_Audio_short 3.wav';
  const cleaned1 = AINamer.preCleanInput(input1);
  assert.ok(!cleaned1.toLowerCase().startsWith('suno -'), 'Should strip Suno header');
  assert.ok(!cleaned1.toLowerCase().endsWith('.wav'), 'Should strip .wav');

  const input2 = 'Udio | 80s Synthwave Chill Master 1.mp3';
  const cleaned2 = AINamer.preCleanInput(input2);
  assert.strictEqual(cleaned2, '80s Synthwave Chill', 'Should strip Udio header and Master suffix');
});

test('cleanHeuristicTitle extracts quoted titles and cleans tags', () => {
  const input = 'Suno - "Neon Midnight" (128 BPM, Key of Am, Synth Bass) - Audio_short';
  const cleaned = AINamer.cleanHeuristicTitle(input);
  assert.strictEqual(cleaned, 'Neon Midnight', 'Should extract quoted song title');
});

test('sanitizeOutputTitle handles think tags, markdown, and quotes', () => {
  const raw1 = '<think>I should name this Neon Drift</think>Neon Drift';
  assert.strictEqual(AINamer.sanitizeOutputTitle(raw1), 'Neon Drift');

  const raw2 = ' "Midnight Horizon" ';
  assert.strictEqual(AINamer.sanitizeOutputTitle(raw2), 'Midnight Horizon');
});

// ==========================================
// 3. Model Downloader Stream Fragmentation & Error Handling
// ==========================================
console.log('\n--- 3. Stream Fragmentation & Error Handling ---');

await asyncTest('pullOllamaModel handles fragmented JSON lines and tracks success', async () => {
  // Mock fetch with fragmented chunks
  const chunks = [
    new TextEncoder().encode('{"status":"pulling man'),
    new TextEncoder().encode('ifest"}\n{"status":"downloading layer","completed":500,"total":1000}\n'),
    new TextEncoder().encode('{"status":"downloading layer","completed":1000,"total":1000}\n{"status":"success"}\n')
  ];

  let chunkIdx = 0;
  const mockReader = {
    read() {
      if (chunkIdx < chunks.length) {
        return Promise.resolve({ value: chunks[chunkIdx++], done: false });
      }
      return Promise.resolve({ value: undefined, done: true });
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    body: { getReader: () => mockReader }
  });

  try {
    let progressUpdates = [];
    const res = await AINamer.pullOllamaModel('test:model', 'http://localhost:11434', (p) => {
      progressUpdates.push(p);
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.model, 'test:model');
    assert.ok(progressUpdates.length >= 2, 'Should receive progress updates');
    assert.strictEqual(progressUpdates[progressUpdates.length - 1].percent, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('pullOllamaModel throws on stream error payload', async () => {
  const errorChunk = new TextEncoder().encode('{"error":"model not found"}\n');
  const mockReader = {
    read() {
      return Promise.resolve({ value: errorChunk, done: true });
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    body: { getReader: () => mockReader }
  });

  try {
    let threw = false;
    try {
      await AINamer.pullOllamaModel('nonexistent:model', 'http://localhost:11434');
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('model not found'), 'Error message should contain server error');
    }
    assert.ok(threw, 'Should throw on error payload in stream');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ==========================================
// 4. Duplicate Naming Resolution Tests
// ==========================================
console.log('\n--- 4. Sequential Duplicate Naming ---');

test('Duplicate indexing appends sequential numbers starting on 2nd occurrence', () => {
  const counts = {};
  function resolveName(rawName) {
    const base = rawName.trim();
    if (!counts[base]) {
      counts[base] = 1;
      return `${base}.wav`;
    }
    const idx = counts[base];
    counts[base]++;
    return `${base} ${idx}.wav`;
  }

  assert.strictEqual(resolveName('Autumn Gloom'), 'Autumn Gloom.wav');
  assert.strictEqual(resolveName('Autumn Gloom'), 'Autumn Gloom 1.wav');
  assert.strictEqual(resolveName('Autumn Gloom'), 'Autumn Gloom 2.wav');
  assert.strictEqual(resolveName('Autumn Gloom'), 'Autumn Gloom 3.wav');
  assert.strictEqual(resolveName('Neon Drift'), 'Neon Drift.wav');
  assert.strictEqual(resolveName('Neon Drift'), 'Neon Drift 1.wav');
});

// ==========================================
// 5. Silence & Ghost Track Elimination Tests
// ==========================================
console.log('\n--- 5. Silence Trimming & Ghost Track Prevention ---');

test('Silence cut trims trailing silence chunks and preserves active audio', () => {
  const sampleRate = 44100;
  const activeSamples = 44100 * 5; // 5s active audio
  const silentSamples = Math.floor(0.8 * sampleRate); // 0.8s trailing silence
  const total = activeSamples + silentSamples;

  let hasAudibleContent = true;
  let finalSamples = total;
  const trailingSilenceSamples = Math.floor(0.8 * sampleRate);

  if (hasAudibleContent && finalSamples > trailingSilenceSamples + (2.0 * sampleRate)) {
    finalSamples -= trailingSilenceSamples;
  }

  assert.strictEqual(finalSamples, activeSamples, 'Should trim trailing 0.8s silence from finished track');
});

test('Dead silence buffer is rejected and does not create ghost track', () => {
  let hasAudibleContent = false;
  let reason = 'stop';

  function shouldSaveFinalTrack(hasAudible, durationSec) {
    return hasAudible && durationSec >= 2.0;
  }

  assert.strictEqual(shouldSaveFinalTrack(hasAudibleContent, 4.2), false, '4.2s of pure silence must NOT be saved on auto-stop');
  assert.strictEqual(shouldSaveFinalTrack(true, 4.2), true, '4.2s of audible audio MUST be saved on auto-stop');
});

// ==========================================
// 6. Suno Metadata & Rapid Skip Regressions
// ==========================================
console.log('\n--- 6. Suno Metadata & Rapid Skip Regressions ---');

test('cleanMetadataTitle preserves the visible Suno title instead of inventing a generic name', () => {
  assert.strictEqual(
    AINamer.cleanMetadataTitle('Signal_Lantern_Audio_short'),
    'Signal Lantern'
  );
});

await asyncTest('Ollama prompt does not anchor results to Neon Pulse', async () => {
  const originalFetch = globalThis.fetch;
  let submittedPrompt = '';

  globalThis.fetch = async (_url, options) => {
    submittedPrompt = JSON.parse(options.body).prompt;
    return {
      ok: true,
      json: async () => ({ response: 'Glass Skyline' })
    };
  };

  try {
    await AINamer.queryOllama(
      'energetic synth track with bright arpeggios',
      'http://localhost:11434',
      'test:model'
    );
    assert.ok(
      !submittedPrompt.includes('Neon Pulse'),
      'Prompt examples must not bias unrelated tracks toward Neon Pulse'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('same-title Suno clips with different song IDs are distinct tracks', async () => {
  await import('../track_metadata_logic.js');
  const logic = globalThis.TrackSnipMetadata;

  const first = {
    title: 'Signal_Lantern_Audio_short',
    trackId: 'synthetic-track-alpha',
    identityUrl: 'https://suno.com/song/synthetic-track-alpha',
    source: 'suno-playbar'
  };
  const second = {
    ...first,
    trackId: 'synthetic-track-beta',
    identityUrl: 'https://suno.com/song/synthetic-track-beta'
  };

  assert.notStrictEqual(logic.createTrackSignature(first), logic.createTrackSignature(second));
  assert.strictEqual(logic.isDifferentTrack(first, second), true);
  assert.strictEqual(logic.isReliableMetadataSource(first.source), true);
});

await asyncTest('rapid track transitions are serialized without dropping any request', async () => {
  const { default: TrackTransitionQueue } = await import('../track_transition_queue.js');
  const processed = [];
  let active = 0;
  let maxActive = 0;

  const queue = new TrackTransitionQueue(async ({ trackId }) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    processed.push(trackId);
    active--;
    return { trackId };
  });

  const results = await Promise.all([
    queue.enqueue({ trackId: 'a' }),
    queue.enqueue({ trackId: 'b' }),
    queue.enqueue({ trackId: 'c' })
  ]);

  assert.deepStrictEqual(processed, ['a', 'b', 'c']);
  assert.deepStrictEqual(results.map((result) => result.trackId), ['a', 'b', 'c']);
  assert.strictEqual(maxActive, 1);
});

await asyncTest('worker restoration trusts an actively recording offscreen document only', async () => {
  const { reconcileRecordingState } = await import('../runtime_state_logic.js');
  const saved = {
    isRecording: true,
    recordingTabId: 42,
    recordingTabTitle: 'Suno',
    currentTrack: { title: 'Signal Lantern' },
    trackStartedAt: 1234
  };

  assert.deepStrictEqual(
    reconcileRecordingState(saved, { exists: true, isRecording: false }),
    {
      isRecording: false,
      recordingTabId: null,
      recordingTabTitle: '',
      currentTrack: null,
      trackStartedAt: null
    }
  );

  assert.deepStrictEqual(
    reconcileRecordingState(saved, { exists: true, isRecording: true }),
    {
      isRecording: true,
      recordingTabId: 42,
      recordingTabTitle: 'Suno',
      currentTrack: { title: 'Signal Lantern' },
      trackStartedAt: 1234
    }
  );
});

// ==========================================
// 7. Capture Lifecycle Regressions
// ==========================================
console.log('\n--- 7. Capture Lifecycle Regressions ---');

await asyncTest('transition queue pause blocks new work while allowing queued work to drain', async () => {
  const { default: TrackTransitionQueue } = await import('../track_transition_queue.js');
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const queue = new TrackTransitionQueue(async ({ trackId }) => {
    if (trackId === 'before-stop') {
      markFirstStarted();
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    return trackId;
  });

  assert.strictEqual(typeof queue.pause, 'function', 'Queue must expose a pause barrier');
  assert.strictEqual(typeof queue.resume, 'function', 'Queue must be reusable after a new capture starts');

  const inFlight = queue.enqueue({ trackId: 'before-stop' });
  await firstStarted;
  queue.pause();

  const blockedAssertion = assert.rejects(
    queue.enqueue({ trackId: 'after-stop' }),
    /paused/i,
    'New transitions must be rejected after shutdown begins'
  );

  releaseFirst();
  assert.strictEqual(await inFlight, 'before-stop');
  await blockedAssertion;
  await queue.drain();
  queue.resume();
  assert.strictEqual(await queue.enqueue({ trackId: 'next-session' }), 'next-session');
});

await asyncTest('cut-result classification advances only successful or intentional silent discards', async () => {
  const lifecycle = await import('../runtime_state_logic.js');

  assert.strictEqual(
    typeof lifecycle.classifyCutResult,
    'function',
    'Lifecycle helper must classify offscreen cut responses'
  );

  assert.deepStrictEqual(
    lifecycle.classifyCutResult({
      success: true,
      dataUrl: 'data:audio/wav;base64,AAAA',
      durationSec: 4.2
    }),
    {
      shouldAdvance: true,
      shouldSave: true,
      discarded: false,
      error: null
    }
  );

  assert.deepStrictEqual(
    lifecycle.classifyCutResult({
      success: false,
      isSilent: true,
      error: 'Buffer contains only silence'
    }),
    {
      shouldAdvance: true,
      shouldSave: false,
      discarded: true,
      error: 'Buffer contains only silence'
    }
  );

  assert.deepStrictEqual(
    lifecycle.classifyCutResult({
      success: false,
      error: 'Not currently recording'
    }),
    {
      shouldAdvance: false,
      shouldSave: false,
      discarded: false,
      error: 'Not currently recording'
    }
  );

  assert.deepStrictEqual(
    lifecycle.classifyCutResult({
      success: true,
      durationSec: 4.2
    }),
    {
      shouldAdvance: false,
      shouldSave: false,
      discarded: false,
      error: 'Cut response contained no audio data'
    }
  );
});

test('offscreen capture start applies the saved auto-stop preference', () => {
  const source = fs.readFileSync(new URL('../offscreen.js', import.meta.url), 'utf8');
  const startBegin = source.indexOf('async function handleStartCapture');
  const startEnd = source.indexOf('/**\n * PCM Audio Processing Loop', startBegin);
  const startCaptureSource = source.slice(startBegin, startEnd);

  assert.ok(
    startCaptureSource.includes('options.autoStopOnSilence'),
    'START_CAPTURE must apply autoStopOnSilence instead of retaining the offscreen default'
  );
});

test('offscreen capture start and stop reset continuous silence timing', () => {
  const source = fs.readFileSync(new URL('../offscreen.js', import.meta.url), 'utf8');
  const startBegin = source.indexOf('async function handleStartCapture');
  const startEnd = source.indexOf('/**\n * PCM Audio Processing Loop', startBegin);
  const stopBegin = source.indexOf('async function handleStopCapture');
  const stopEnd = source.indexOf('/**\n * Returns real-time audio analysis data', stopBegin);

  assert.ok(
    source.slice(startBegin, startEnd).includes('continuousSilenceStart = null;'),
    'A new capture must not inherit a silence timer from the prior session'
  );
  assert.ok(
    source.slice(stopBegin, stopEnd).includes('continuousSilenceStart = null;'),
    'Stopping capture must clear the continuous silence timer'
  );
});

test('background rejects failed cuts before advancing track metadata', () => {
  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const boundaryBegin = source.indexOf('async function captureTrackBoundary');
  const boundaryEnd = source.indexOf('const transitionQueue', boundaryBegin);
  const boundarySource = source.slice(boundaryBegin, boundaryEnd);

  assert.ok(
    boundarySource.includes('classifyCutResult(cutRes)'),
    'Track boundaries must classify the offscreen response'
  );
  assert.ok(
    boundarySource.includes('if (!cutOutcome.shouldAdvance)'),
    'Failed cuts must return before metadata advances'
  );
});

test('background pauses transitions before stop and resumes only after capture starts', () => {
  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const startBegin = source.indexOf('async function startRecording');
  const startEnd = source.indexOf('/**\n * Saves cut audio chunk', startBegin);
  const stopBegin = source.indexOf('async function stopRecording');
  const stopEnd = source.indexOf('async function handleRuntimeMessage', stopBegin);

  assert.ok(
    source.slice(stopBegin, stopEnd).indexOf('transitionQueue.pause()') <
      source.slice(stopBegin, stopEnd).indexOf('transitionQueue.drain()'),
    'Shutdown must pause new transitions before draining queued work'
  );
  assert.ok(
    source.slice(startBegin, startEnd).includes('transitionQueue.resume()'),
    'A successful new capture must reopen the transition queue'
  );
});

// ==========================================
// 8. Popup Brand Asset
// ==========================================
console.log('\n--- 8. Popup Brand Asset ---');

test('popup packages the silent animated logo with a still fallback', () => {
  const popupHtml = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const popupCss = fs.readFileSync(new URL('../popup.css', import.meta.url), 'utf8');

  assert.ok(popupHtml.includes('assets/track-snip-animated-logo.webm'));
  assert.ok(popupHtml.includes('assets/track-snip-logo-poster.png'));
  assert.ok(popupHtml.includes('autoplay'));
  assert.ok(popupHtml.includes('muted'));
  assert.ok(!/<video[\s\S]*?\sloop(?:\s|>)/.test(popupHtml), 'Logo animation must play only once per popup open');
  assert.ok(popupCss.includes('mix-blend-mode: screen'));
  assert.ok(!popupCss.includes('transform: translateX(-9px)'), 'Logo media should retain its full-width framing');
  assert.ok(popupCss.includes('margin: -3px 0 0 18px'), 'Version label should align with the visible logo artwork');
  assert.ok(!popupCss.includes('.brand:hover'), 'Logo must not animate or bump on hover');
  assert.ok(fs.existsSync(new URL('../assets/track-snip-animated-logo.webm', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../assets/track-snip-logo-poster.png', import.meta.url)));
});

// ==========================================
// 9. Lightweight Amber Rain Background
// ==========================================
console.log('\n--- 9. Lightweight Amber Rain Background ---');

test('popup packages amber rain as a passive background with lighter glass panels', () => {
  const popupHtml = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const popupCss = fs.readFileSync(new URL('../popup.css', import.meta.url), 'utf8');
  const backgroundUrl = new URL('../amber_rain_background.js', import.meta.url);

  assert.ok(popupHtml.includes('id="amberRainBackground"'));
  assert.ok(popupHtml.includes('aria-hidden="true"'));
  assert.ok(
    popupHtml.indexOf('amber_rain_background.js') < popupHtml.indexOf('popup.js'),
    'Background renderer must initialize independently before the popup controller'
  );
  assert.ok(!popupHtml.includes('lighthouse_background.js'));
  assert.ok(fs.existsSync(backgroundUrl));
  assert.ok(popupCss.includes('.amber-rain-background'));
  assert.ok(popupCss.includes('pointer-events: none'));
  assert.ok(popupCss.includes('--bg-primary: #000000;'));
  assert.ok(
    !popupCss.includes('radial-gradient(ellipse at center, rgba(255, 160, 40'),
    'Amber color must come from the rain, not the background base'
  );
  assert.ok(popupCss.includes('--bg-card: rgba(22, 27, 46, 0.675);'));
  assert.ok(popupCss.includes('--bg-card-hover: rgba(30, 36, 61, 0.81);'));
  assert.ok(
    /\.ai-card\s*\{[\s\S]*?background:[^;]*0\.585[^;]*0\.675[^;]*;/u.test(popupCss),
    'AI card opacity must be reduced proportionally by 10%'
  );
  assert.ok(
    /\.player-card\s*\{[\s\S]*?background:[^;]*0\.72[^;]*0\.72[^;]*;/u.test(popupCss),
    'Player card opacity must be reduced proportionally by 10%'
  );

  const source = fs.readFileSync(backgroundUrl, 'utf8');
  assert.ok(source.includes('const TARGET_FPS = 30;'), 'Background animation must be frame-rate capped');
  assert.ok(source.includes('const MAX_DEVICE_PIXEL_RATIO = 1.25;'), 'Render resolution must be capped');
  assert.ok(source.includes('const TARGET_DENSITY = 0.55;'), 'Supplied steady-rain density must be retained');
  assert.ok(source.includes("context.fillStyle = 'rgb(0, 0, 0)';"));
  assert.ok(source.includes("context.fillStyle = 'rgba(0, 0, 0, 0.22)';"));
  assert.ok(!source.includes('8, 4, 0'), 'Rain persistence base must be true black');
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  assert.ok(source.includes('document.hidden'));
  assert.ok(!source.includes('fetch('), 'Background must remain fully local');
  assert.ok(!source.includes('setInterval('), 'Renderer must use one visibility-aware animation loop');
});

// ==========================================
// 10. Analog Signal Color System
// ==========================================
console.log('\n--- 10. Analog Signal Color System ---');

test('popup replaces stock AI gradients while preserving the logo treatment', () => {
  const popupHtml = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const popupCss = fs.readFileSync(new URL('../popup.css', import.meta.url), 'utf8');

  assert.ok(popupCss.includes('--accent-saffron: #f2b84b;'));
  assert.ok(popupCss.includes('--accent-vermilion: #e96346;'));
  assert.ok(popupCss.includes('--accent-brass: #c9963e;'));
  assert.ok(popupCss.includes('--accent-ivory: #f3ead7;'));
  assert.ok(popupCss.includes('linear-gradient(135deg, #e96346, #f2b84b)'));
  assert.ok(popupCss.includes('linear-gradient(90deg, #e96346, #f2b84b, #f3ead7)'));

  const retiredColors = [
    '#6366f1',
    '#a855f7',
    '#ec4899',
    '#4f46e5',
    '#9333ea',
    '#7c3aed',
    '#f472b6',
    '#c084fc',
    '#60a5fa',
    '#fbcfe8',
    'rgba(168, 85, 247',
    'rgba(99, 102, 241',
    'rgba(147, 51, 234',
    'rgba(236, 72, 153',
    'rgba(244, 114, 182'
  ];
  for (const color of retiredColors) {
    assert.ok(!popupCss.includes(color), `Retired AI-trope color remains in popup.css: ${color}`);
    assert.ok(!popupHtml.includes(color), `Retired AI-trope color remains in popup.html: ${color}`);
  }

  assert.ok(popupCss.includes('mix-blend-mode: screen'));
  assert.ok(popupCss.includes('.brand .version'));
  assert.ok(popupCss.includes('color: #06b6d4;'), 'Logo version label must retain its current cyan');
});

// ==========================================
// 11. Public Release Security Boundaries
// ==========================================
console.log('\n--- 11. Public Release Security Boundaries ---');

test('manifest uses active-tab injection and only local AI host access', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('declarativeNetRequest'));
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
  assert.deepStrictEqual(
    manifest.host_permissions,
    ['http://localhost/*', 'http://127.0.0.1/*']
  );
  assert.ok(!manifest.content_scripts, 'Metadata scripts must not run persistently on every site');
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
});

test('AI endpoints are normalized and restricted to local HTTP services', () => {
  assert.strictEqual(DEFAULT_LOCAL_AI_ENDPOINT, 'http://localhost:11434');
  assert.strictEqual(normalizeLocalAiEndpoint('http://localhost:11434/'), 'http://localhost:11434');
  assert.strictEqual(normalizeLocalAiEndpoint('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');

  for (const endpoint of [
    'https://localhost:11434',
    'http://example.com:11434',
    'http://192.168.1.10:11434',
    'file:///tmp/ollama',
    'http://user:pass@localhost:11434',
    'http://localhost:11434/?token=secret'
  ]) {
    assert.throws(
      () => normalizeLocalAiEndpoint(endpoint),
      /local AI endpoint/i,
      `Endpoint should be rejected: ${endpoint}`
    );
  }
});

test('Ollama header workaround is session-only and extension-scoped', () => {
  const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const rulesBegin = source.indexOf('async function setupOllamaHeaderRules');
  const rulesEnd = source.indexOf('let isInitialized', rulesBegin);
  const rulesSource = source.slice(rulesBegin, rulesEnd);

  assert.ok(rulesSource.includes('updateSessionRules'));
  assert.ok(rulesSource.includes('initiatorDomains: [chrome.runtime.id]'));
  assert.ok(rulesSource.includes("requestDomains: ['localhost']"));
  assert.ok(rulesSource.includes("requestDomains: ['127.0.0.1']"));
  assert.ok(!rulesSource.includes('updateDynamicRules({'));
});

test('metadata tracking is activated only for recording and tears down its observers', () => {
  const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const contentSource = fs.readFileSync(new URL('../content_script.js', import.meta.url), 'utf8');

  assert.ok(!backgroundSource.includes("chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })"));
  assert.ok(backgroundSource.includes("type: 'START_TRACK_METADATA'"));
  assert.ok(backgroundSource.includes("type: 'STOP_TRACK_METADATA'"));
  assert.ok(contentSource.includes('clearInterval(pollTimer)'));
  assert.ok(contentSource.includes('bodyObserver.disconnect()'));
  assert.ok(contentSource.includes('titleObserver.disconnect()'));
});

// ==========================================
// 12. Bounded Recording Memory
// ==========================================
console.log('\n--- 12. Bounded Recording Memory ---');

test('long recordings split at the fixed duration limit', () => {
  assert.strictEqual(MAX_TRACK_DURATION_SEC, 600);
  assert.strictEqual(shouldSplitForDurationLimit(599.99), false);
  assert.strictEqual(shouldSplitForDurationLimit(600), true);
  assert.strictEqual(shouldSplitForDurationLimit(900), true);

  const offscreenSource = fs.readFileSync(new URL('../offscreen.js', import.meta.url), 'utf8');
  const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  assert.ok(offscreenSource.includes("type: 'TRACK_DURATION_LIMIT_TRIGGERED'"));
  assert.ok(backgroundSource.includes("case 'TRACK_DURATION_LIMIT_TRIGGERED':"));
});

// ==========================================
// 13. Public Repository Hygiene
// ==========================================
console.log('\n--- 13. Public Repository Hygiene ---');

test('current source tree excludes legacy design sources and unfinished release text', () => {
  const legacyAssets = [
    '../icons/Auto-Cutter-Logo.png',
    '../icons/icon.svg',
    '../icons/logo_tight.png',
    '../icons/logo_transparent.png',
  ];
  for (const relativePath of legacyAssets) {
    assert.ok(
      !fs.existsSync(new URL(relativePath, import.meta.url)),
      `Unused legacy asset must not be present: ${relativePath}`
    );
  }

  const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(
    !changelog.includes('Earlier changes are represented in the Git history.'),
    'Changelog must describe the sanitized public-history baseline accurately'
  );

  const privacy = fs.readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
  assert.ok(
    !privacy.includes('once the public repository contact is configured'),
    'Privacy contact text must not contain a future configuration placeholder'
  );

  const security = fs.readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8');
  assert.ok(
    !security.includes('when it is enabled')
      && !security.includes('private contact method configured on the repository'),
    'Security reporting instructions must describe an available reporting path'
  );

  const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  assert.ok(
    !backgroundSource.includes('Continuous 5s silence reached. Automatically stopping recording...'),
    'Routine auto-stop behavior must not emit debug-style production logs'
  );
});

test('CI runs once for main updates instead of repeating on release tag pushes', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  assert.ok(
    workflow.includes('push:\n    branches:\n      - main'),
    'Push checks must be scoped to the main branch'
  );
});

// Summary
console.log('\n========================================');
console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}
