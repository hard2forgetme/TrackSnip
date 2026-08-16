/**
 * Content Script - Intelligent Track Metadata Detector & Playlist Change Observer
 * Detects track title, artist, album, SPA transitions, video/audio changes,
 * and MediaSession updates while the user is actively recording a tab.
 */

(function () {
  const contentScriptVersion = '1.3.0';
  const existingController = window.__TRACKSNIP_CONTENT_CONTROLLER__;
  if (existingController?.version === contentScriptVersion) {
    existingController.activate();
    return;
  }
  window.__TRACKSNIP_CONTENT_SCRIPT_VERSION__ = contentScriptVersion;
  window.__TRACK_RECORDER_INJECTED__ = true;

  let isActive = false;
  let lastTrackSignature = null;
  let bridgeMetadata = null;
  let pollTimer = null;
  let scheduledCheckTimer = null;
  let titleObserver = null;
  let bodyObserver = null;
  const pendingTrackSignatures = new Set();
  const metadataLogic = globalThis.TrackSnipMetadata;

  /**
   * Cleans and sanitizes track title strings
   */
  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Injects bridge to intercept navigator.mediaSession.metadata in page world
   */
  function injectMediaSessionBridge() {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          if (window.__TR_BRIDGE_INJECTED__) return;
          window.__TR_BRIDGE_INJECTED__ = true;

          if ('mediaSession' in navigator) {
            let currentMeta = navigator.mediaSession.metadata;
            try {
              Object.defineProperty(navigator.mediaSession, 'metadata', {
                get: function() { return currentMeta; },
                set: function(val) {
                  currentMeta = val;
                  if (val && val.title) {
                    window.dispatchEvent(new CustomEvent('TR_MEDIASESSION_UPDATE', {
                      detail: {
                        title: val.title || '',
                        artist: val.artist || '',
                        album: val.album || ''
                      }
                    }));
                  }
                },
                configurable: true,
                enumerable: true
              });
            } catch(e) {}
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}
  }

  function handleMediaSessionUpdate(e) {
    if (!isActive) return;
    if (e.detail && e.detail.title) {
      bridgeMetadata = e.detail;
      checkTrackChange('mediasession-bridge');
    }
  }

  /**
   * Extracts metadata from standard Web MediaSession API
   */
  function getMediaSessionMetadata() {
    if (bridgeMetadata && bridgeMetadata.title) {
      return {
        title: cleanText(bridgeMetadata.title),
        artist: cleanText(bridgeMetadata.artist || ''),
        album: cleanText(bridgeMetadata.album || ''),
        source: 'mediaSession-bridge'
      };
    }

    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
      const meta = navigator.mediaSession.metadata;
      if (meta.title && meta.title.trim().length > 0) {
        return {
          title: cleanText(meta.title),
          artist: cleanText(meta.artist || ''),
          album: cleanText(meta.album || ''),
          source: 'mediaSession'
        };
      }
    }
    return null;
  }

  /**
   * Extracts metadata from platform-specific DOM elements
   */
  function getPlatformDOMMetadata() {
    const host = window.location.hostname;

    // 1. Suno
    if (host.includes('suno.com')) {
      const titleLinks = Array.from(
        document.querySelectorAll('a[aria-label^="Playbar: Title for "]')
      );
      const titleLink = titleLinks.find((link) => cleanText(link.textContent));
      const fallbackLink = titleLinks[0] || null;
      const activeLink = titleLink || fallbackLink;

      if (activeLink) {
        const ariaLabel = activeLink.getAttribute('aria-label') || '';
        const href = activeLink.getAttribute('href') || '';
        const title = cleanText(activeLink.textContent) ||
          cleanText(ariaLabel.replace(/^Playbar:\s*Title for\s*/i, ''));
        const artistLink = document.querySelector('a[aria-label^="Playbar: Artist for "]');
        const trackIdMatch = href.match(/\/song\/([^/?#]+)/i);

        if (title) {
          return {
            title,
            artist: artistLink ? cleanText(artistLink.textContent) : '',
            source: 'suno-playbar',
            trackId: trackIdMatch ? trackIdMatch[1] : '',
            identityUrl: href ? new URL(href, window.location.origin).href : ''
          };
        }
      }
    }

    // 2. YouTube & YouTube Music
    if (host.includes('youtube.com')) {
      // YouTube Music
      const ytmTitle = document.querySelector('ytmusic-player-bar .title, ytmusic-player-bar yt-formatted-string.title');
      const ytmArtist = document.querySelector('ytmusic-player-bar .byline a, ytmusic-player-bar .byline yt-formatted-string');
      if (ytmTitle && ytmTitle.textContent.trim()) {
        return {
          title: cleanText(ytmTitle.textContent),
          artist: ytmArtist ? cleanText(ytmArtist.textContent) : '',
          source: 'youtube-music'
        };
      }

      // Standard YouTube
      const ytTitle = document.querySelector('#above-the-fold #title h1 yt-formatted-string, ytd-watch-metadata #title h1, h1.ytd-video-primary-info-renderer, .ytp-title-link');
      const ytChannel = document.querySelector('#channel-name a, ytd-channel-name a, #owner-name a, .ytp-title-expanded-title');
      if (ytTitle && ytTitle.textContent.trim()) {
        return {
          title: cleanText(ytTitle.textContent),
          artist: ytChannel ? cleanText(ytChannel.textContent) : '',
          source: 'youtube'
        };
      }
    }

    // 3. Spotify Web Player
    if (host.includes('spotify.com')) {
      const titleElem = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"] a, [data-testid="context-item-info-title"]');
      const artistElem = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-artist"] a, [data-testid="context-item-info-artist"]');
      if (titleElem && titleElem.textContent.trim()) {
        return {
          title: cleanText(titleElem.textContent),
          artist: artistElem ? cleanText(artistElem.textContent) : '',
          source: 'spotify'
        };
      }
    }

    // 4. SoundCloud
    if (host.includes('soundcloud.com')) {
      const titleElem = document.querySelector('.playbackSoundBadge__titleLink');
      const artistElem = document.querySelector('.playbackSoundBadge__lightLink');
      if (titleElem && titleElem.textContent.trim()) {
        return {
          title: cleanText(titleElem.getAttribute('title') || titleElem.textContent),
          artist: artistElem ? cleanText(artistElem.getAttribute('title') || artistElem.textContent) : '',
          source: 'soundcloud'
        };
      }
    }

    // 5. Bandcamp
    if (host.includes('bandcamp.com')) {
      const titleElem = document.querySelector('.track_info .title, .trackView .trackTitle');
      const artistElem = document.querySelector('.track_info .artist, #name-section .albumTitle span');
      if (titleElem && titleElem.textContent.trim()) {
        return {
          title: cleanText(titleElem.textContent),
          artist: artistElem ? cleanText(artistElem.textContent) : '',
          source: 'bandcamp'
        };
      }
    }

    // 6. Apple Music
    if (host.includes('music.apple.com')) {
      const titleElem = document.querySelector('.web-chrome-playback-lcd__track-name, .lcd-meta__primary');
      const artistElem = document.querySelector('.web-chrome-playback-lcd__sub-copy-scroll-inner a, .lcd-meta__secondary');
      if (titleElem && titleElem.textContent.trim()) {
        return {
          title: cleanText(titleElem.textContent),
          artist: artistElem ? cleanText(artistElem.textContent) : '',
          source: 'apple-music'
        };
      }
    }

    return null;
  }

  /**
   * Generic HTML5 Audio / Document Title fallback
   */
  function getGenericMetadata() {
    let pageTitle = document.title || '';
    pageTitle = pageTitle
      .replace(/ - YouTube$/, '')
      .replace(/ \| Spotify$/, '')
      .replace(/ on SoundCloud$/, '')
      .replace(/ \| Bandcamp$/, '')
      .replace(/ \| Apple Music$/, '')
      .trim();

    if (pageTitle && pageTitle.length > 0) {
      return {
        title: cleanText(pageTitle),
        artist: '',
        source: 'document-title'
      };
    }

    return {
      title: 'Unknown Track',
      artist: '',
      source: 'fallback'
    };
  }

  /**
   * Detect current active track info
   */
  function getCurrentTrackInfo() {
    const platformMetadata = getPlatformDOMMetadata();
    const meta = window.location.hostname.includes('suno.com')
      ? (platformMetadata || getMediaSessionMetadata() || getGenericMetadata())
      : (getMediaSessionMetadata() || platformMetadata || getGenericMetadata());
    
    let formattedName = meta.title;
    if (meta.artist && !meta.title.toLowerCase().includes(meta.artist.toLowerCase())) {
      formattedName = `${meta.artist} - ${meta.title}`;
    }

    return {
      title: meta.title || 'Untitled Track',
      artist: meta.artist || '',
      album: meta.album || '',
      formattedName: formattedName || 'Untitled Track',
      source: meta.source,
      trackId: meta.trackId || '',
      identityUrl: meta.identityUrl || '',
      url: window.location.href
    };
  }

  /**
   * Check for track changes and notify background service worker
   */
  function checkTrackChange(triggerReason = 'poll') {
    if (!isActive) return;

    const current = getCurrentTrackInfo();
    const signature = metadataLogic
      ? metadataLogic.createTrackSignature(current)
      : `${current.title}:::${current.artist}:::${window.location.href}`;

    if (
      signature !== lastTrackSignature &&
      !pendingTrackSignatures.has(signature) &&
      current.title !== 'Unknown Track' &&
      current.title !== ''
    ) {
      const isInitial = lastTrackSignature === null && pendingTrackSignatures.size === 0;
      pendingTrackSignatures.add(signature);

      chrome.runtime.sendMessage({
        type: 'TRACK_CHANGED_IN_TAB',
        track: current,
        triggerReason: triggerReason,
        isInitial: isInitial
      }).then((response) => {
        if (!response || response.accepted !== false) {
          lastTrackSignature = signature;
        }
      }).catch(() => {
        // Leave the signature uncommitted so polling retries after a worker wake or reload.
      }).finally(() => {
        pendingTrackSignatures.delete(signature);
      });
    }
  }

  // Bind audio/video media listeners
  function attachMediaListeners() {
    if (!isActive) return;

    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach((media) => {
      if (media.__tr_bound) return;
      media.__tr_bound = true;

      media.addEventListener('ended', () => {
        if (!isActive) return;
        chrome.runtime.sendMessage({
          type: 'MEDIA_ENDED_IN_TAB',
          track: getCurrentTrackInfo()
        }).catch(() => {});
        setTimeout(() => checkTrackChange('ended'), 200);
      });

      media.addEventListener('play', () => checkTrackChange('play'));
      media.addEventListener('playing', () => checkTrackChange('playing'));
      media.addEventListener('loadedmetadata', () => checkTrackChange('loadedmetadata'));
      media.addEventListener('loadstart', () => checkTrackChange('loadstart'));
      media.addEventListener('pause', () => {
        if (!isActive) return;
        setTimeout(() => checkTrackChange('pause'), 300);
      });
    });
  }

  function handlePopState() {
    setTimeout(() => checkTrackChange('popstate'), 200);
  }

  function handleHashChange() {
    setTimeout(() => checkTrackChange('hashchange'), 200);
  }

  function handleYouTubeNavigateFinish() {
    setTimeout(() => {
      attachMediaListeners();
      checkTrackChange('yt-navigate-finish');
    }, 400);
  }

  function handleYouTubePageDataUpdated() {
    setTimeout(() => {
      attachMediaListeners();
      checkTrackChange('yt-page-data-updated');
    }, 400);
  }

  function scheduleTrackCheck(triggerReason, delayMs = 100) {
    if (!isActive) return;
    if (scheduledCheckTimer !== null) {
      clearTimeout(scheduledCheckTimer);
    }
    scheduledCheckTimer = setTimeout(() => {
      scheduledCheckTimer = null;
      attachMediaListeners();
      checkTrackChange(triggerReason);
    }, delayMs);
  }

  function startObservers() {
    const titleElement = document.querySelector('title');
    if (titleElement) {
      titleObserver = new MutationObserver(() => scheduleTrackCheck('title-mutation'));
      titleObserver.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    bodyObserver = new MutationObserver(() => scheduleTrackCheck('body-mutation'));
    if (document.body) {
      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });
    }
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    injectMediaSessionBridge();

    window.addEventListener('TR_MEDIASESSION_UPDATE', handleMediaSessionUpdate);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    document.addEventListener('yt-navigate-finish', handleYouTubeNavigateFinish);
    document.addEventListener('yt-page-data-updated', handleYouTubePageDataUpdated);

    startObservers();
    attachMediaListeners();
    checkTrackChange('activate');
    pollTimer = setInterval(() => {
      attachMediaListeners();
      checkTrackChange('poll');
    }, 500);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (scheduledCheckTimer !== null) {
      clearTimeout(scheduledCheckTimer);
      scheduledCheckTimer = null;
    }
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }

    window.removeEventListener('TR_MEDIASESSION_UPDATE', handleMediaSessionUpdate);
    window.removeEventListener('popstate', handlePopState);
    window.removeEventListener('hashchange', handleHashChange);
    document.removeEventListener('yt-navigate-finish', handleYouTubeNavigateFinish);
    document.removeEventListener('yt-page-data-updated', handleYouTubePageDataUpdated);

    lastTrackSignature = null;
    bridgeMetadata = null;
    pendingTrackSignatures.clear();
  }

  // Message listener from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_TRACK_METADATA') {
      activate();
      sendResponse({ success: true, active: true });
      return false;
    }
    if (message.type === 'STOP_TRACK_METADATA') {
      deactivate();
      sendResponse({ success: true, active: false });
      return false;
    }
    if (message.type === 'GET_CURRENT_TRACK') {
      sendResponse({ track: getCurrentTrackInfo() });
      return false;
    }
    return false;
  });

  window.__TRACKSNIP_CONTENT_CONTROLLER__ = {
    version: contentScriptVersion,
    activate,
    deactivate
  };
})();
