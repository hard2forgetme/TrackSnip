(function installTrackSnipMetadata(root) {
  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function normalizeIdentityUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, 'https://tracksnip.invalid');
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch (_error) {
      return clean(value);
    }
  }

  function createTrackSignature(track) {
    if (!track) return '';

    const trackId = clean(track.trackId);
    if (trackId) return `id:${trackId}`;

    const identityUrl = normalizeIdentityUrl(track.identityUrl);
    if (identityUrl) return `url:${identityUrl}`;

    return [
      clean(track.formattedName || track.title),
      clean(track.artist),
      normalizeIdentityUrl(track.url)
    ].join(':::');
  }

  function isDifferentTrack(first, second) {
    if (!first || !second) return false;

    const firstId = clean(first.trackId);
    const secondId = clean(second.trackId);
    if (firstId && secondId && firstId !== secondId) return true;

    const firstIdentityUrl = normalizeIdentityUrl(first.identityUrl);
    const secondIdentityUrl = normalizeIdentityUrl(second.identityUrl);
    if (firstIdentityUrl && secondIdentityUrl && firstIdentityUrl !== secondIdentityUrl) {
      return true;
    }

    const firstName = clean(first.formattedName || first.title);
    const secondName = clean(second.formattedName || second.title);
    return Boolean(
      firstName &&
      secondName &&
      firstName !== secondName &&
      firstName !== 'unknown track' &&
      secondName !== 'unknown track'
    );
  }

  function isReliableMetadataSource(source) {
    return new Set([
      'suno-playbar',
      'mediaSession',
      'mediaSession-bridge',
      'youtube',
      'youtube-music',
      'spotify',
      'soundcloud',
      'bandcamp',
      'apple-music'
    ]).has(source);
  }

  root.TrackSnipMetadata = {
    createTrackSignature,
    isDifferentTrack,
    isReliableMetadataSource,
    normalizeIdentityUrl
  };
})(globalThis);
