/**
 * Generate inline tracking script for published/standalone pages.
 * This script runs on pages served outside the SPA (e.g., /p/{publishId}).
 */

/**
 * Generate the tracking script HTML for a published page.
 * @param {Object} options
 * @param {string} options.presentationId - The presentation ID
 * @param {string} options.sourceType - 'published' | 'embed'
 * @param {string} [options.sourceId] - The publish ID
 * @returns {string} Script HTML to inject
 */
export function generateTrackingScriptHtml({ presentationId, sourceType, sourceId }) {
  // Escape values for safe injection into JavaScript
  const safePresId = JSON.stringify(presentationId);
  const safeSourceType = JSON.stringify(sourceType);
  const safeSourceId = JSON.stringify(sourceId || null);

  return `
<script>
(function() {
  // Analytics tracking for published pages
  var HEARTBEAT_MS = 30000;
  var presentationId = ${safePresId};
  var sourceType = ${safeSourceType};
  var sourceId = ${safeSourceId};
  var sessionToken = null;
  var currentSlideId = null;
  var currentSlideIndex = 0;
  var heartbeatId = null;
  var started = false;

  function getDeviceId() {
    var key = 'ps.analytics.deviceId';
    var id = null;
    try { id = localStorage.getItem(key); } catch(e) {}
    if (!id || !/^[a-f0-9]{32}$/i.test(id)) {
      var arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      id = Array.from(arr, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      try { localStorage.setItem(key, id); } catch(e) {}
    }
    return id;
  }

  function send(endpoint, data, useBeacon) {
    var body = JSON.stringify(data);
    if (useBeacon && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      } catch(e) {}
      return;
    }
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function() {});
  }

  function startSession() {
    if (started) return;
    started = true;
    // Start session and get token
    fetch('/api/track/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presentationId: presentationId,
        sourceType: sourceType,
        sourceId: sourceId,
        viewerType: 'anonymous',
        deviceId: getDeviceId()
      })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.sessionToken) {
          sessionToken = data.sessionToken;
          startHeartbeat();
          trackCurrentSlide();
        }
      }).catch(function() {});
  }

  function trackCurrentSlide() {
    if (!sessionToken) return;
    var slides = document.querySelectorAll('.deck-slide');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains('is-active')) {
        var slideId = slides[i].getAttribute('data-slide-id');
        if (slideId && slideId !== currentSlideId) {
          currentSlideId = slideId;
          currentSlideIndex = i;
          send('/api/track/slide/view', {
            sessionToken: sessionToken,
            slideId: slideId,
            slideIndex: i
          }, false);
        }
        break;
      }
    }
  }

  function heartbeat() {
    if (!sessionToken) return;
    send('/api/track/session/heartbeat', {
      sessionToken: sessionToken,
      currentSlideId: currentSlideId,
      currentSlideIndex: currentSlideIndex
    }, false);
  }

  function startHeartbeat() {
    if (heartbeatId) return;
    heartbeatId = setInterval(heartbeat, HEARTBEAT_MS);
  }

  function endSession() {
    if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = null; }
    if (!sessionToken) return;
    send('/api/track/session/end', {
      sessionToken: sessionToken,
      exitSlideId: currentSlideId,
      exitSlideIndex: currentSlideIndex
    }, true);
  }

  // Start tracking on page load
  if (document.readyState === 'complete') {
    startSession();
  } else {
    window.addEventListener('load', startSession);
  }

  // Track slide changes via MutationObserver
  var deck = document.getElementById('deck');
  if (deck && window.MutationObserver) {
    var observer = new MutationObserver(function() {
      trackCurrentSlide();
    });
    observer.observe(deck, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // End session on unload
  window.addEventListener('beforeunload', endSession);
  window.addEventListener('pagehide', endSession);
})();
</script>
`.trim();
}