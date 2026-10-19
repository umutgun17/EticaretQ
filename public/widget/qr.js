/* Yunbi mini QR üreteci — byte modu, sürüm 1-10, EC L/M/Q/H, otomatik maske (ISO 18004). Harici bağımlılık yok. */
window.YunbiQR = (function () {
  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  // [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] — sürüm 1..10, sırayla L, M, Q, H
  var TBL = [
    null,
    { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
    { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
    { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
    { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
    { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
    { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
    { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
    { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
    { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
    { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] }
  ];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function ecPoly(n) { var g = [1]; for (var i = 0; i < n; i++) { var ng = new Array(g.length + 1).fill(0); for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
  function ecBytes(data, n) { var g = ecPoly(n), r = new Array(n).fill(0); for (var i = 0; i < data.length; i++) { var f = data[i] ^ r[0]; r.shift(); r.push(0); if (f) for (var j = 0; j < n; j++) r[j] ^= gmul(g[j + 1], f); } return r; }
  function utf8(s) { var out = [], str = unescape(encodeURIComponent(s)); for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 255); return out; }
  function dataCap(v, ec) { var t = TBL[v][ec]; return t[1] * t[2] + t[3] * t[4]; }
  function pickVersion(len, ec) { for (var v = 1; v <= 10; v++) { var cb = v <= 9 ? 8 : 16; if (4 + cb + len * 8 <= dataCap(v, ec) * 8) return v; } return 0; }
  function formatBits(ec, mask) { var d = (EC_BITS[ec] << 3) | mask, r = d << 10; for (var i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10); return ((d << 10) | r) ^ 0x5412; }
  function versionBits(v) { var r = v << 12; for (var i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12); return (v << 12) | r; }

  function encode(text, ec) {
    ec = TBL[1][ec] ? ec : 'M';
    var bytes = utf8(text), v = pickVersion(bytes.length, ec);
    if (!v) return null;
    var t = TBL[v][ec], cap = dataCap(v, ec), cb = v <= 9 ? 8 : 16, bits = [];
    function push(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(4, 4); push(bytes.length, cb); for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var term = Math.min(4, cap * 8 - bits.length); push(0, term); while (bits.length % 8) bits.push(0);
    var data = []; for (var b = 0; b < bits.length; b += 8) { var x = 0; for (var k = 0; k < 8; k++) x = (x << 1) | bits[b + k]; data.push(x); }
    for (var p = 0; data.length < cap; p++) data.push(p % 2 ? 0x11 : 0xec);
    // bloklar + serpiştirme
    var blocks = [], pos = 0, ecs = [];
    for (var g = 0; g < 2; g++) { var nb = g ? t[3] : t[1], nd = g ? t[4] : t[2]; for (var q = 0; q < nb; q++) { var blk = data.slice(pos, pos + nd); pos += nd; blocks.push(blk); ecs.push(ecBytes(blk, t[0])); } }
    var out = [], maxD = Math.max(t[2], t[4]);
    for (var c = 0; c < maxD; c++) for (var bi = 0; bi < blocks.length; bi++) if (c < blocks[bi].length) out.push(blocks[bi][c]);
    for (var e = 0; e < t[0]; e++) for (var bj = 0; bj < ecs.length; bj++) out.push(ecs[bj][e]);
    // matris
    var size = v * 4 + 17, m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
    function set(x, y, d) { m[y][x] = d ? 1 : 0; fn[y][x] = true; }
    function finder(cx, cy) { for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; var dist = Math.max(Math.abs(dx), Math.abs(dy)); set(xx, yy, dist !== 2 && dist !== 4); } }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (var i2 = 8; i2 < size - 8; i2++) { set(6, i2, i2 % 2 === 0); set(i2, 6, i2 % 2 === 0); }
    var al = ALIGN[v];
    for (var ai = 0; ai < al.length; ai++) for (var aj = 0; aj < al.length; aj++) {
      var ax = al[ai], ay = al[aj];
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === al.length - 1) || (ai === al.length - 1 && aj === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) set(ax + dx2, ay + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    function drawFormat(mask) {
      var f = formatBits(ec, mask), bit = function (i) { return (f >> i) & 1; };
      for (var i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (var j = 9; j < 15; j++) set(14 - j, 8, bit(j));
      for (var k2 = 0; k2 < 8; k2++) set(size - 1 - k2, 8, bit(k2));
      for (var l = 8; l < 15; l++) set(8, size - 15 + l, bit(l));
      set(8, size - 8, 1);
    }
    drawFormat(0);
    if (v >= 7) { var vb = versionBits(v); for (var vi = 0; vi < 18; vi++) { var b2 = (vb >> vi) & 1, a = size - 11 + (vi % 3), bb = Math.floor(vi / 3); set(a, bb, b2); set(bb, a, b2); } }
    // veri yerleşimi
    var idx = 0, total = out.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var xx2 = right - jj, up = ((right + 1) & 2) === 0, yy2 = up ? size - 1 - vert : vert;
        if (!fn[yy2][xx2] && idx < total) { m[yy2][xx2] = (out[idx >> 3] >> (7 - (idx & 7))) & 1; idx++; }
      }
    }
    // maske seçimi
    function maskf(mk, x, y) {
      switch (mk) { case 0: return (x + y) % 2 === 0; case 1: return y % 2 === 0; case 2: return x % 3 === 0; case 3: return (x + y) % 3 === 0; case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; case 5: return (x * y) % 2 + (x * y) % 3 === 0; case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0; default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
    }
    function apply(mk) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskf(mk, x, y)) m[y][x] ^= 1; }
    function penalty() {
      var s = 0, y, x, run, dark = 0;
      for (y = 0; y < size; y++) { run = 1; for (x = 1; x < size; x++) { if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (x = 0; x < size; x++) { run = 1; for (y = 1; y < size; y++) { if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var c0 = m[y][x]; if (c0 === m[y][x + 1] && c0 === m[y + 1][x] && c0 === m[y + 1][x + 1]) s += 3; }
      var pat = [1, 0, 1, 1, 1, 0, 1];
      for (y = 0; y < size; y++) for (x = 0; x < size - 6; x++) {
        var ok = true; for (var p2 = 0; p2 < 7; p2++) if (m[y][x + p2] !== pat[p2]) { ok = false; break; }
        if (ok) { var lw = true, rw = true; for (var q2 = 1; q2 <= 4; q2++) { if (x - q2 < 0 || m[y][x - q2]) lw = false; if (x + 6 + q2 >= size || m[y][x + 6 + q2]) rw = false; } if (lw || rw) s += 40; }
      }
      for (x = 0; x < size; x++) for (y = 0; y < size - 6; y++) {
        var ok2 = true; for (var p3 = 0; p3 < 7; p3++) if (m[y + p3][x] !== pat[p3]) { ok2 = false; break; }
        if (ok2) { var tw = true, bw = true; for (var q3 = 1; q3 <= 4; q3++) { if (y - q3 < 0 || m[y - q3][x]) tw = false; if (y + 6 + q3 >= size || m[y + 6 + q3][x]) bw = false; } if (tw || bw) s += 40; }
      }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
      var k3 = Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)); s += k3 * 10;
      return s;
    }
    var best = 0, bestS = Infinity;
    for (var mk = 0; mk < 8; mk++) { apply(mk); drawFormat(mk); var sc = penalty(); if (sc < bestS) { bestS = sc; best = mk; } apply(mk); }
    apply(best); drawFormat(best);
    return { size: size, version: v, mask: best, modules: m };
  }
  function svg(text, o) {
    o = o || {}; var q = encode(text, o.ec || 'M'); if (!q) return '';
    var mg = o.margin == null ? 2 : o.margin, n = q.size + mg * 2, px = o.size || 160, d = '';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + mg) + ' ' + (y + mg) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="' + n + '" height="' + n + '" fill="' + (o.bg || '#fff') + '"/><path d="' + d + '" fill="' + (o.color || '#000') + '"/></svg>';
  }
  return { encode: encode, svg: svg };
})();
