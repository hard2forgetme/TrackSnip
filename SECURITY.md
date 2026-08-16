# Security Policy

## Supported version

The latest `main` branch and the latest tagged release are the supported
versions. This project is currently distributed as an unpacked developer-mode
Chrome extension.

## Reporting a vulnerability

Do not include secrets, private recordings, or personal data in a public issue.
Use GitHub's private vulnerability reporting feature when it is enabled for the
repository. Otherwise, contact the repository maintainers through the private
contact method configured on the repository before public disclosure.

Please include the affected commit or release, reproduction steps, impact, and
any relevant browser or operating-system details.

## Scope

Reports involving permission scope, page metadata exposure, audio capture,
download handling, local AI endpoint handling, model downloads, and extension
message validation are in scope. Reports about third-party web platforms or
Ollama/LM Studio themselves should be reported to those projects as well.

## Safe testing

Use synthetic audio and a test profile. Do not include private page content,
personal recordings, API keys, or downloaded model credentials in reports.
