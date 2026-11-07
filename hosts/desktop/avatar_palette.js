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
  //
  // 这些是**采样原值**，不直接上屏：下面 tone() 会统一降饱和 + 压亮度再用。
  // 为什么：原值十个都是 78%~95% 饱和度，一排头像同时出现时像十个彩球
  // （用户第一眼就是「图标感觉也奇怪」）。压到同一亮度带上之后仍然一色一身份，
  // 但读起来是一套配色，而不是随机取色。
  var AVATAR_PALETTE = [
    "#18c272", "#fd6d17", "#915cf9", "#a16d3c", "#f9399a",
    "#2f8df5", "#17b8c9", "#e5484d", "#f5a623", "#7c5cff",
  ];

  /* hex → {h,s,l}；s/l 都是 0..1 */
  function toHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    if (!d) return { h: 0, s: 0, l: l };
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h: h, s: s, l: l };
  }

  function toHex(h, s, l) {
    function f(n) {
      var k = (n + h * 12) % 12;
      var a = s * Math.min(l, 1 - l);
      var v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(v * 255).toString(16).padStart(2, "0");
    }
    return "#" + f(0) + f(8) + f(4);
  }

  /* 统一色调：饱和度压到 70%，亮度夹到 26%~34% 这条带。
     两个约束是量出来的，不是感觉：
       ① 白字对比度：十个色里最差的一个也要 ≥ 4.5:1（实测 4.53:1，
          15px/600 的白字在任一底色上都读得清）；
       ② 明度差不超过一档：一排头像同时出现时是「一套配色」，不是彩球。 */
  var S_SCALE = 0.70;
  var L_MIN = 0.26;
  var L_MAX = 0.34;
  function tone(hex) {
    var c = toHsl(hex);
    var l = Math.min(L_MAX, Math.max(L_MIN, c.l * 0.92));
    return toHex(c.h, Math.min(1, c.s * S_SCALE), l);
  }

  var TONED = AVATAR_PALETTE.map(tone);

  window.avatarColorFor = function avatarColorFor(seed) {
    var s = String(seed || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return TONED[h % TONED.length];
  };
})();
