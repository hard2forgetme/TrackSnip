# Changelog

## 1.3.1 - 2026-08-16

- Removed unreferenced legacy logo source files from the public repository.
- Tightened public documentation, security reporting, and CI trigger behavior.
- Replaced base64 WAV messages with offscreen PCM16 buffering and Blob URL
  downloads, with explicit `USER_MEDIA` and `BLOBS` lifecycle reasons.
- Added sender validation for popup, offscreen, and recording-tab messages.
- Removed dynamic HTML rendering for track history and local model names.
- Added configuration bounds, reserved filename handling, and cross-origin
  recording shutdown.
- Moved the MediaSession bridge to Chrome's page `MAIN` world while preserving
  the browser's native metadata setter.

## 1.3.0 - 2026-08-16

- Replaced persistent all-site metadata injection with recording-scoped
  `activeTab` injection and teardown.
- Restricted AI endpoints to local HTTP services on `localhost` or
  `127.0.0.1`.
- Replaced persistent Ollama header rules with extension-scoped session rules.
- Added ten-minute automatic segmentation to bound recording memory usage.
- Added privacy, security, asset provenance, CI, release validation, and
  deterministic packaging documentation and tooling.
- Replaced project-specific regression fixtures with synthetic metadata and
  added a repeatable public-history privacy audit.

## 1.2.1 - 2026-08-16

- Added the TrackSnip animated wordmark and poster fallback.
- Added the Amber Rain popup background.
- Added the analog signal color system, spectrum visualizer, tape reel, and
  session track history UI.
- Improved MV3 service-worker state restoration.
- Improved silence trimming and ghost-track prevention.
- Improved fragmented Ollama model-download handling.
- Added deterministic regression coverage for naming, transitions, silence,
  downloads, and state behavior.

The public repository begins with the sanitized 1.3.0 release baseline. The
1.2.1 notes summarize development completed before that public baseline.
