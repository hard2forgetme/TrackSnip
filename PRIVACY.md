# TrackSnip Privacy

TrackSnip is designed for local use. It has no analytics, advertising, account
system, or telemetry service.

## What the extension can access

The extension does not request persistent access to every website. When the
user opens TrackSnip and starts recording, Chrome's `activeTab` permission gives
temporary access to that selected tab. TrackSnip then injects its metadata
detector into that tab. The detector can inspect page titles, media metadata,
selected player DOM text, and the current page URL to identify the active track.
Its observers and polling stop when recording ends.

Chrome associates a broad permission warning with the `tabCapture` API. That
browser warning can remain visible even though TrackSnip does not declare
`<all_urls>` and does not inject metadata code until the user starts recording.

The extension also requests tab capture, scripting, downloads, storage,
offscreen documents, and declarative network-request permissions. These support
audio capture, the popup UI, saved preferences, WAV downloads, and local
Ollama integration.

## Audio and files

Captured audio is processed in the browser and saved as WAV files through the
browser download manager. Track audio is not sent to TrackSnip or to a TrackSnip
server.

## AI naming and model downloads

The offline naming path does not make a network request. When configured, AI
naming sends a distilled naming prompt to the configured Ollama or
OpenAI-compatible endpoint. TrackSnip accepts only plain HTTP endpoints hosted
on `localhost` or `127.0.0.1`; remote hosts, credentials, query strings, and URL
fragments are rejected.

Downloading an Ollama model necessarily makes a network request to the
configured Ollama service and may cause that service to download model data
from its own registry. TrackSnip does not operate that registry.

## Local storage

Preferences, recording state, and session track metadata may be stored in
Chrome extension storage. WAV files are stored in the user's configured
Downloads subfolder.

## Contact

For general privacy questions, open a GitHub issue without including private
recordings, page content, or personal data. For suspected vulnerabilities, use
the private reporting process in `SECURITY.md`.
