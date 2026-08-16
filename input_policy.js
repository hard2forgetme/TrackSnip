const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;
const INVALID_PATH_CHARACTERS = /[\\/:*?"<>|]/g;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$/;
const AI_PROVIDERS = new Set(['ollama', 'openai-compatible', 'heuristic']);

export const MIN_SILENCE_THRESHOLD = 0.001;
export const MAX_SILENCE_THRESHOLD = 0.25;
export const MAX_MODEL_NAME_LENGTH = 200;
export const MAX_PROMPT_LENGTH = 2000;

export function sanitizePathSegment(
  value,
  { fallback = 'Untitled_Track', maxLength = 120 } = {}
) {
  let clean = String(value || '')
    .replace(INVALID_PATH_CHARACTERS, '_')
    .replace(CONTROL_CHARACTERS, '')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!clean || clean === '.' || clean === '..') return fallback;

  if (WINDOWS_RESERVED_NAME.test(clean)) {
    clean = `_${clean}`;
  }

  clean = clean.slice(0, maxLength).trim().replace(/[. ]+$/g, '');
  return clean || fallback;
}

export function normalizeSilenceThreshold(value) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < MIN_SILENCE_THRESHOLD
    || value > MAX_SILENCE_THRESHOLD
  ) {
    throw new Error(
      `Silence threshold must be between ${MIN_SILENCE_THRESHOLD} and ${MAX_SILENCE_THRESHOLD}`
    );
  }
  return value;
}

export function normalizeModelName(value) {
  if (typeof value !== 'string') {
    throw new Error('Model name must be a string');
  }

  const clean = value.replace(CONTROL_CHARACTERS, '').trim();
  if (
    !clean
    || clean.length > MAX_MODEL_NAME_LENGTH
    || !MODEL_NAME.test(clean)
  ) {
    throw new Error('Model name contains unsupported characters or is too long');
  }
  return clean;
}

export function normalizeAiProvider(value) {
  if (!AI_PROVIDERS.has(value)) {
    throw new Error('Unsupported AI provider');
  }
  return value;
}

export function normalizePrompt(value) {
  const clean = String(value || '').replace(CONTROL_CHARACTERS, '').trim();
  if (!clean) throw new Error('Prompt must not be empty');
  if (clean.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt must not exceed ${MAX_PROMPT_LENGTH} characters`);
  }
  return clean;
}

export function getUrlOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch (_error) {
    return '';
  }
}

export function isTrustedExtensionPageSender(sender, runtimeId, expectedUrl) {
  return sender?.id === runtimeId && sender?.url === expectedUrl;
}
