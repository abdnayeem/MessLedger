// MOBILE: shrinks the fixed .page-header-card once the page is scrolled down
// a bit, and restores it near the top — a common "compact header on scroll"
// pattern. Pure UI: it only toggles a class (.is-compact); the actual visual
// change lives in css/style.css. --phc-h (used by .content-wrap's
// padding-top so content never sits under the fixed header) is already
// re-measured live by the ResizeObserver in 00-utils-core.js whenever the
// header's rendered height changes, so shrinking it here doesn't require any
// extra bookkeeping.
(function () {
  var header = document.querySelector('.page-header-card');
  if (!header) return;

  // Distinct show/hide thresholds (with a little hysteresis) stop the class
  // from flickering on/off when the user is scrolled right at the edge.
  var COMPACT_ON = 44;
  var COMPACT_OFF = 12;
  var DESKTOP_BREAKPOINT = 900;

  var ticking = false;
  var isCompact = false;

  function scrollY() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function update() {
    ticking = false;
    if (window.innerWidth >= DESKTOP_BREAKPOINT) {
      if (isCompact) {
        isCompact = false;
        header.classList.remove('is-compact');
      }
      return;
    }
    var y = scrollY();
    if (!isCompact && y > COMPACT_ON) {
      isCompact = true;
      header.classList.add('is-compact');
    } else if (isCompact && y < COMPACT_OFF) {
      isCompact = false;
      header.classList.remove('is-compact');
    }
  }

  function onScrollOrResize() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }

  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize, { passive: true });
  update();
})();
