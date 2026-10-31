/* avatar_palette.js — AVATAR_PALETTE + avatarColorFor
 *
 * Extracted from index.html (P2-4 monolith split + T-2 hex budget: these avatar
 * colors are legitimate data sampled from Grok screenshots, kept out of the
 * index.html raw-color count). Global function so the app's inline script calls
 * resolve unchanged. Wrapped in an IIFE so AVATAR_PALETTE does not leak. */
(function () {
  // Grok-parity: deterministic pastel avatar color per session/bot id (hash → palette).
  // Same id always maps to the same color, so the sidebar reads as distinct identities.
  // G-28: aligned to Grok Bot avatar colors sampled pixel-by-pixel from
  // replica/screens/grok-composer.png (first 5: green / orange / purple / brown /
  // pink); padded to 10 so the distribution is not too concentrated.
  var AVATAR_PALETTE = [
    "#18c272", "#fd6d17", "#915cf9", "#a16d3c", "#f9399a",
    "#2f8df5", "#17b8c9", "#e5484d", "#f5a623", "#7c5cff",
  ];
  window.avatarColorFor = function avatarColorFor(seed) {
    var s = String(seed || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  };
})();
