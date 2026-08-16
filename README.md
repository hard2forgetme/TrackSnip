# TrackSnip - AI Music Auto-Cutter Chrome Extension

<div align="center">
  <img src="icons/icon128.png" width="100" height="100" alt="TrackSnip Logo" />
  <h3>16-bit PCM WAV tab-audio recording with metadata-aware track splitting</h3>
  <p>Capture web playlists, split tracks, clean filenames, and optionally use local AI naming.</p>
</div>

TrackSnip is a Manifest V3 Chrome extension for recording tab audio from web
music tools and saving separate WAV files. It is intended for personal,
developer-mode use and should only be used with audio you are allowed to
record.

## Features

### Audio capture

- Continuous playlist recording through Chrome's `tabCapture` and an offscreen
  Web Audio pipeline.
- Playback continues through the normal speaker/headphone route.
- Uncompressed 16-bit PCM WAV output with standard RIFF/WAVE headers.
- Metadata-aware track splitting, including stable player identifiers where
  available.
- RMS-based silence splitting and approximately five-second inactivity
  auto-stop when a playlist reaches its end.
- Manual cut-and-save while recording continues.

### Naming

- Metadata-first deterministic title cleaning.
- Optional local AI naming through Ollama, LM Studio, or another
  OpenAI-compatible service bound to `localhost` or `127.0.0.1`.
- Offline heuristic naming when AI is disabled or unavailable.
- One-click model download UI for configured Ollama services. Model downloads
  require network access through that service.

### Downloads and UI

- Configurable subfolder inside the browser Downloads directory.
- Sequential duplicate names such as `Song.wav`, `Song 1.wav`, and `Song 2.wav`.
- Silent animated TrackSnip wordmark with a still fallback.
- Amber Rain procedural backdrop, analog signal palette, spectrum visualizer,
  tape reel, and session track history.

## Installation

1. Open Chrome or another Chromium browser.
2. Open `chrome://extensions` and enable Developer mode.
3. Click **Load unpacked**.
4. Select this repository directory.
5. Pin TrackSnip from the browser toolbar if desired.

## Use

1. Open a supported web music or playlist tab.
2. Open the TrackSnip popup.
3. Optionally choose a Downloads subfolder and AI provider/model.
4. Click **Start Recording Tab**.
5. Let the playlist play. TrackSnip cuts and saves WAV files as boundaries are
   detected.

Automatic transitions intentionally discard captures shorter than two seconds.
The current implementation accumulates one track in memory before encoding.
To prevent unbounded memory growth, uninterrupted recordings are automatically
segmented every ten minutes. Automatic silence stopping is approximate and
depends on the audio signal and the platform's player behavior.

## Permissions and privacy

TrackSnip does not request persistent access to every website. Clicking the
extension action grants temporary `activeTab` access to the selected tab.
Metadata detection is injected only when recording starts, and its observers
and polling are stopped when recording ends. During recording it can inspect
that tab's title, media metadata, selected player DOM text, and current URL.
Audio is processed locally and saved through Chrome's download manager.

Chrome may still display its broad "read and change" warning because TrackSnip
requires the `tabCapture` permission to record the tab the user explicitly
selects. TrackSnip does not declare `<all_urls>` or a persistent content script.

There is no TrackSnip telemetry or TrackSnip cloud service. AI endpoints are
restricted to plain HTTP services on `localhost` or `127.0.0.1`. A distilled
naming prompt is sent to that local service when AI naming is enabled. Ollama
model downloads use the local Ollama service, which may then contact its model
registry. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Development commands

Node.js 22 or newer is required.

```bash
npm test
npm run audit:public
npm run check
npm run package
```

`npm test` runs the deterministic regression suite. `npm run audit:public`
checks reachable Git history, commit and tag identities, timestamps, local
paths, secret patterns, and live service identifiers. `npm run check` runs that
audit after validating the Manifest V3 JSON, JavaScript syntax, referenced
extension assets, and required release documentation. `npm run package` creates
`release/tracksnip-v1.3.0.zip`, excluding Git metadata, tests, CI, and release
tooling.

## Release steps

1. Review the confirmed asset inventory in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).
2. Review privacy, permission, and endpoint behavior.
3. Run `npm test`, `npm run audit:public`, `npm run check`, and
   `npm run package` on Node 22.
4. Load the unpacked extension in a clean Chrome profile and test recording,
   rapid skips, silence stopping, ten-minute segmentation, duplicate downloads,
   and local AI
   behavior.
5. Inspect the release ZIP and confirm it contains no tests, Git metadata, or
   development tooling.
6. Review commit author metadata and repository visibility before pushing.
7. Tag the reviewed commit with the release version.

## Repository layout

```text
TrackSnip/
├── assets/                  # Animated wordmark and poster fallback
├── icons/                   # Extension icons and logo variants
├── manifest.json            # Manifest V3 configuration
├── popup.html/.css/.js      # Popup UI and controls
├── background.js            # MV3 service worker and download routing
├── offscreen.html/.js       # Tab capture and WAV pipeline
├── ai_namer.js              # AI connector and offline naming
├── track_metadata_logic.js  # Metadata normalization
├── track_transition_queue.js# Rapid-transition serialization
├── runtime_state_logic.js   # Runtime state reconciliation
├── wav_encoder.js           # 16-bit PCM WAV encoder
└── tests/suite.js           # Deterministic regression suite
```

## License

The code and the bundled project-owned assets are provided under the
[MIT License](LICENSE). See [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).
