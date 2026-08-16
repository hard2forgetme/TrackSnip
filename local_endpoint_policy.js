export const DEFAULT_LOCAL_AI_ENDPOINT = 'http://localhost:11434';

export function normalizeLocalAiEndpoint(endpoint = DEFAULT_LOCAL_AI_ENDPOINT) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('Local AI endpoint must be a non-empty URL');
  }

  let parsed;
  try {
    parsed = new URL(endpoint.trim());
  } catch (_error) {
    throw new Error('Local AI endpoint must be a valid URL');
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('Local AI endpoint must use http');
  }

  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Local AI endpoint must use localhost or 127.0.0.1');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Local AI endpoint cannot include credentials, query parameters, or fragments');
  }

  const pathname = parsed.pathname === '/'
    ? ''
    : parsed.pathname.replace(/\/+$/, '');

  return `${parsed.origin}${pathname}`;
}
