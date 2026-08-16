# Security Policy

## Supported version

The latest `main` branch and the latest tagged release are the supported
versions. This project is currently distributed as an unpacked developer-mode
Chrome extension.

## Reporting a vulnerability

Do not include secrets, private recordings, or personal data in a public issue.
Use GitHub's private vulnerability reporting feature for this repository. If
that form is unavailable, open a public issue containing no vulnerability
details and request a private contact channel before disclosure.

Please include the affected commit or release, reproduction steps, impact, and
any relevant browser or operating-system details.

## Scope

Reports involving permission scope, page metadata exposure, audio capture,
download handling, local AI endpoint handling, model downloads, and extension
message validation are in scope. Reports about third-party web platforms or
Ollama/LM Studio themselves should be reported to those projects as well.

Privileged recording and configuration messages are accepted only from the
TrackSnip popup. Track events are accepted only from the active recording tab,
and audio-control events are accepted only from the offscreen recorder.

## Safe testing

Use synthetic audio and a test profile. Do not include private page content,
personal recordings, API keys, or downloaded model credentials in reports.
