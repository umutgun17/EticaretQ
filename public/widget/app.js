/* Yunbi mini QR üreteci — byte modu, sürüm 1-10, EC L/M/Q/H, otomatik maske (ISO 18004). Harici bağımlılık yok. */
window.YunbiQR = window.YunbiQR || (function () {
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

/* KATMAN POLİTİKASI (tüm Yunbi widget'ları, düşükten yükseğe): duyuru üst barı 2147481000 < hero/uygulama KULAKÇIĞI 2147481900
 * < çan / mobil alt bar 2147482000-2003 < hero çekmece/panel 2147482050-2060 < Yunbi MENÜ 2147482100-2101 < arama / chat / filtre / galeri / çark 2147483000+ */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi "Uygulamaya Özel" Kulakçığı (CRO)
     Mobil uygulamayı indirene özel indirim kodu. Web'de kod + QR (telefonla okutunca cihaza göre App Store /
     Google Play) + mağaza butonları; mobil web'de cihaza göre tek "İndir" butonu; uygulama içinde yalnız kod.
     Bütün çıkışlar Yunbi /go yönlendirmesinden geçer → tıklama/QR okutma ölçülür; kod kullanımı siparişlerden okunur.
     Kurulum: <script src="https://eticaretq.com/widget/app.js?v=1" data-tenant="tonnyblack"></script>
     Demo öznitelikleri: data-force="1", data-open="1", data-theme (JSON), data-rules (JSON), data-platform (ios|android|desktop|inapp_ios|inapp_android), data-debug="1"
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiAppPromoLoaded) return;
  window.__yunbiAppPromoLoaded = true;

  var VERSION = 4;
  var API = SCRIPT.src.replace(/\/widget\/app\.js.*$/, '/w/' + TENANT + '/app');
  var FORCE = SCRIPT.getAttribute('data-force') === '1';
  var AUTO_OPEN_NOW = SCRIPT.getAttribute('data-open') === '1';
  var MOUNT_SEL = SCRIPT.getAttribute('data-mount') || '';
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  var FORCE_PLATFORM = SCRIPT.getAttribute('data-platform') || '';
  var FORCE_THEME = null, FORCE_RULES = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { }
  try { FORCE_RULES = SCRIPT.getAttribute('data-rules') ? JSON.parse(SCRIPT.getAttribute('data-rules')) : null; } catch (e) { }
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiApp]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  /* ═══ reklam kaynağı (web→uygulama atfı) ═══
     Ziyaretçinin siteye geldiği son kampanya dokunuşu 7 gün saklanır: meta (ig/fb/an/th + paid/cpc) | google (gclid/gbraid/wbraid
     veya google+cpc) | other (diğer utm). Site içi yunbi etiketleri ve etiketsiz girişler mevcut kaydı EZMEZ.
     Kanala göre farklı kupon kodu gösterilir (rules.channel_codes) ve tüm olaylara/yönlendirmeye eklenir. */
  var ATTR = (function () {
    var K = 'yunbi_attr', TTL = 7 * 864e5, a = null;
    try { a = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { }
    if (a && (!a.ts || Date.now() - a.ts > TTL)) a = null;
    try {
      var q = new URLSearchParams(location.search), g = function (k) { return (q.get(k) || '').slice(0, 128); };
      var us = g('utm_source').toLowerCase(), um = g('utm_medium').toLowerCase(), uc = g('utm_campaign');
      var gclid = g('gclid') || g('gbraid') || g('wbraid'), n = null;
      if (us === 'yunbi') n = null; // site içi (akıllı arama vb.)
      else if (gclid || (/^google/.test(us) && /^(cpc|ppc|paid)/.test(um))) n = { ch: 'google', us: us || 'google', um: um || 'cpc', uc: uc, gclid: gclid };
      else if (/^(ig|fb|an|th|msg|facebook|instagram|meta|\{\{site_source_name\}\})$/.test(us) && /(paid|cpc|cpm|ads)/.test(um)) n = { ch: 'meta', us: us, um: um, uc: uc };
      else if (us) n = { ch: 'other', us: us, um: um, uc: uc };
      if (n) { n.ts = Date.now(); a = n; try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) { } }
    } catch (e) { }
    return a || {};
  })();
  function attrParams() { return { ch: ATTR.ch || '', us: ATTR.us || '', um: ATTR.um || '', uc: ATTR.uc || '' }; }

  var cfg = null, host = null, root = null, isOpen = false, opened = false, autoTm = null, tickTm = null, clockOffset = 0, MOBILE_BP = 640;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  function hexRgb(h) { h = (h || '#111827').replace('#', ''); if (h.length !== 6) h = '111827'; return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function isMobile() { return window.innerWidth <= MOBILE_BP; }
  function device() { return window.innerWidth <= 768 ? 'm' : 'd'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  /* ═══ platform: inapp_ios | inapp_android | ios | android | desktop ═══ */
  var PLATFORM = (function () {
    if (FORCE_PLATFORM) return FORCE_PLATFORM;
    var ua = navigator.userAgent || '';
    if (/TicimaxiOS/i.test(ua)) return 'inapp_ios';
    if (/TicimaxAndroid/i.test(ua)) return 'inapp_android';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  })();
  function inApp() { return PLATFORM.indexOf('inapp_') === 0; }
  function mobileOS() { return PLATFORM === 'ios' || PLATFORM === 'inapp_ios' ? 'ios' : (PLATFORM === 'android' || PLATFORM === 'inapp_android' ? 'android' : ''); }

  /* ═══ sayfa tipi / gizleme ═══ */
  function pageType() {
    var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (p === '/') return 'home';
    var cartPath = (cfg.cart_url || '').replace(/^https?:\/\/[^/]+/, '').toLowerCase();
    if (cartPath && p.indexOf(cartPath.replace(/\/$/, '')) === 0) return 'cart';
    if (/^\/(hesabim|uyegiris|uye|account|login)/.test(p)) return 'account';
    if (qs('.ProductListContent') && qs('.filterBlock')) return 'category';
    if (window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage')) return 'product';
    return 'other';
  }
  function shouldHide() {
    if (FORCE) return false;
    var r = cfg.rules;
    var paths = (r.hide_paths || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var p = location.pathname.toLowerCase();
    for (var i = 0; i < paths.length; i++) if (p.indexOf(paths[i]) === 0) return true;
    var pt = pageType();
    if (pt === 'cart') return true;
    if (/sepet|checkout|odeme|siparis|payment|basket/.test(p)) return true;
    if ((r.hide_page_types || []).indexOf(pt) >= 0) return true;
    if (r.max_width > 0 && window.innerWidth > r.max_width) return true;
    if (r.min_width > 0 && window.innerWidth < r.min_width) return true;
    return false;
  }

  /* ═══ sıklık (otomatik açılma) ═══ */
  function seenKey() { return 'yunbi_app_seen:' + ((cfg.rules && (cfg.rules.base_code || cfg.rules.code)) || 'x'); }
  function wasSeen() {
    if (FORCE) return false;
    var f = cfg.rules.frequency || 'day';
    try {
      if (f === 'always') return false;
      if (f === 'session') return sessionStorage.getItem(seenKey()) === '1';
      return localStorage.getItem(seenKey()) === today();
    } catch (e) { return false; }
  }
  function markSeen() { try { sessionStorage.setItem(seenKey(), '1'); localStorage.setItem(seenKey(), today()); } catch (e) { } }

  /* ═══ olay ═══ */
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, page_type: pageType(), device: device(), platform: PLATFORM }, attrParams(), extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }
  function goUrl(src, p, bare) {
    var a = bare ? {} : attrParams(), u = (cfg.go_url || (API + '/go')) + '?src=' + encodeURIComponent(src) + '&sid=' + encodeURIComponent(SID) + (p ? '&p=' + p : '');
    for (var k in a) if (a[k]) u += '&' + k + '=' + encodeURIComponent(src === 'qr' ? String(a[k]).slice(0, 32) : a[k]);
    if (!bare && ATTR.gclid && src !== 'qr') u += '&gclid=' + encodeURIComponent(ATTR.gclid); // QR kısa kalsın (sürüm ≤10)
    return u;
  }

  /* ═══ CSS ═══ */
  function css(t) {
    var acc = t.accent || '#111827', acc2 = t.accent2 || '#374151', bg = t.bg || '#ffffff', ink = t.ink || '#111827';
    var dark = t.preset === 'black' && /^#(0|1|2)/.test(bg);
    var muted = dark ? 'rgba(255,255,255,.62)' : '#6b7280', line = dark ? 'rgba(255,255,255,.1)' : '#eceef2', chip = dark ? 'rgba(255,255,255,.08)' : '#f3f4f6';
    var r = (t.radius != null ? t.radius : 20) + 'px';
    var font = t.font ? t.font + ',' : '';
    var pulse = t.tab_pulse !== false && !reducedMotion();
    var left = /^left/.test(t.tab_position || '');
    var bottom = /bottom$/.test(t.tab_position || '');
    var side = left ? 'left' : 'right';
    return [
      ':host{all:initial;font-family:' + font + '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;--acc:' + acc + ';--acc2:' + acc2 + ';--accrgb:' + hexRgb(acc) + ';--bg:' + bg + ';--ink:' + ink + ';--muted:' + muted + ';--line:' + line + ';--chip:' + chip + ';--r:' + r + ';-webkit-font-smoothing:antialiased}',
      '*{box-sizing:border-box}button,a{font:inherit;color:inherit;text-decoration:none;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}svg{display:block}',
      /* ── kulakçık (dikey şerit) ── */
      '.tab{position:fixed;z-index:2147481900;' + side + ':0;' + (bottom ? 'bottom:calc(120px + env(safe-area-inset-bottom,0));' : 'top:50%;transform:translateY(-50%);') + 'width:52px;padding:11px 0 12px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:10px;color:#fff;background:linear-gradient(160deg,var(--acc),var(--acc2));border-radius:' + (left ? '0 20px 20px 0' : '20px 0 0 20px') + ';box-shadow:0 10px 30px rgba(var(--accrgb),.35),0 2px 6px rgba(0,0,0,.15);transition:opacity .25s,transform .25s;cursor:pointer;user-select:none;letter-spacing:.12em;font-weight:800}',
      '.tab .cl{position:absolute;top:-9px;' + (left ? 'right:-9px' : 'left:-9px') + ';width:22px;height:22px;border-radius:50%;background:#fff;color:#333;font:16px/20px Arial,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);letter-spacing:0;cursor:pointer;z-index:2}',
      '.tab:hover{transform:' + (bottom ? '' : 'translateY(-50%) ') + 'translateX(' + (left ? '2px' : '-2px') + ')}',
      '.tab.hide{opacity:0;pointer-events:none}',
      '.tab .em{font-size:21px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}',
      '.tab .tx{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13.5px;white-space:nowrap}',
      '.tab .bd{font-size:13px;font-weight:900;letter-spacing:.02em;padding:7px 5px;border-radius:9px;background:#fff;color:var(--acc);box-shadow:0 2px 8px rgba(0,0,0,.25);writing-mode:vertical-rl;transform:rotate(180deg)' + (pulse ? ';animation:ya-bd 2s ease-in-out infinite' : '') + '}',
      '@keyframes ya-bd{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.25)}50%{box-shadow:0 0 0 4px rgba(255,255,255,.35),0 2px 8px rgba(0,0,0,.25)}}',
      pulse ? '.tab .em{animation:ya-wig 3.2s ease-in-out infinite}@keyframes ya-wig{0%,80%,100%{transform:rotate(0)}84%{transform:rotate(-12deg)}88%{transform:rotate(10deg)}92%{transform:rotate(-6deg)}96%{transform:rotate(4deg)}}' : '',
      /* mobil (v3): orta boy kulakçık — 36px, kısa yazı görünür, ikon+rozet orta */
      '@media (max-width:' + MOBILE_BP + 'px){.tab{width:36px;padding:9px 0;gap:7px;letter-spacing:.06em;border-radius:' + (left ? '0 15px 15px 0' : '15px 0 0 15px') + ';box-shadow:0 7px 20px rgba(var(--accrgb),.34),0 1px 4px rgba(0,0,0,.16)}.tab .tx{font-size:10.5px}.tab .em{font-size:17px;animation:none}.tab .bd{font-size:11px;padding:5px 3px;border-radius:7px;letter-spacing:0}.tab:hover{transform:' + (bottom ? 'none' : 'translateY(-50%)') + '}}',
      /* ── panel (masaüstü: kulakçığın yanından büyüyen kart; mobil: alt sayfa) ── */
      '.ov{position:fixed;inset:0;background:rgba(10,10,20,.45);z-index:2147482050;opacity:0;pointer-events:none;transition:opacity .25s}.ov.on{opacity:1;pointer-events:auto}',
      '.pn{position:fixed;z-index:2147482052;' + side + ':0;top:50%;transform:translateY(-50%);width:min(560px,calc(100vw - 10px));background:var(--bg);color:var(--ink);border-radius:' + (left ? '0 var(--r) var(--r) 0' : 'var(--r) 0 0 var(--r)') + ';box-shadow:0 24px 70px rgba(0,0,0,.28);display:flex;overflow:hidden;clip-path:inset(0 ' + (left ? '100% 0 0' : '0 0 100%') + ' round var(--r));transition:clip-path .38s cubic-bezier(.2,.8,.2,1);pointer-events:none}.pn.on{clip-path:inset(0 0 0 0 round var(--r));pointer-events:auto}',
      '.pn .strip{width:52px;flex:none;background:linear-gradient(160deg,var(--acc),var(--acc2));color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:10px 0 14px;' + (left ? 'order:2' : '') + '}',
      '.pn .strip .x{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center}.pn .strip .x:hover{background:rgba(255,255,255,.3)}',
      '.pn .strip .eb{writing-mode:vertical-rl;transform:rotate(180deg);font-size:12.5px;font-weight:800;letter-spacing:.14em;white-space:nowrap}',
      '.pn .strip .em{font-size:22px;line-height:1}',
      '.pn .bd{flex:1;padding:22px 24px 20px;min-width:0}',
      '.pn h3{margin:0;font-size:20px;font-weight:800;line-height:1.2;letter-spacing:-.01em}.pn .sub{margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.45}',
      '.pn .big{margin:14px 0 0;font-size:34px;font-weight:900;letter-spacing:-.02em;line-height:1;background:linear-gradient(120deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}',
      '.pn .row{display:flex;gap:18px;margin-top:16px;align-items:stretch}.pn .col{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}',
      '.pn .qr{flex:none;width:150px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;border:1px solid var(--line);border-radius:14px;background:#fff}.pn .qr svg{width:126px;height:126px}.pn .qr small{font-size:10.5px;color:#6b7280;text-align:center;line-height:1.3;font-weight:600}',
      '.pn .code{display:flex;align-items:center;justify-content:space-between;gap:10px;border:2px dashed rgba(var(--accrgb),.45);border-radius:14px;padding:10px 10px 10px 14px;background:rgba(var(--accrgb),.05)}.pn .code .lb{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}.pn .code .cd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:22px;font-weight:800;letter-spacing:.1em;color:var(--ink);line-height:1.1}',
      '.pn .code .cp{flex:none;border-radius:10px;padding:9px 12px;background:var(--acc);color:#fff;font-size:12.5px;font-weight:700;white-space:nowrap}.pn .code .cp.ok{background:#059669}',
      '.pn .code.hid .cd{filter:blur(6px);user-select:none}.pn .code.hid .lb{color:var(--acc)}',
      '.pn .st{display:flex;flex-direction:column;gap:8px}.pn .st a{display:flex;align-items:center;gap:10px;border-radius:12px;padding:11px 14px;background:#111;color:#fff;font-size:13.5px;font-weight:700;line-height:1.1;transition:transform .15s}.pn .st a:hover{transform:translateY(-1px)}.pn .st a svg{width:22px;height:22px;flex:none;fill:#fff}.pn .st a.sec{background:var(--chip);color:var(--ink)}.pn .st a.sec svg{fill:var(--ink)}.pn .st a small{display:block;font-size:10.5px;font-weight:600;opacity:.75;margin-bottom:2px}',
      '.pn .tm{margin-top:12px;font-size:12px;color:var(--muted);line-height:1.45}.pn .tm b{color:var(--ink)}',
      '.pn .note{margin-top:10px;font-size:12px;color:var(--muted);line-height:1.45;padding:9px 12px;border-radius:10px;background:var(--chip)}',
      '.toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom,0));transform:translate(-50%,20px);z-index:2147482060;background:#111827;color:#fff;font-size:13px;font-weight:600;padding:10px 16px;border-radius:999px;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25)}.toast.on{opacity:1;transform:translate(-50%,0)}',
      '@media (max-width:' + MOBILE_BP + 'px){.pn{top:auto;bottom:0;left:0;right:0;width:100vw;transform:none;border-radius:22px 22px 0 0;clip-path:none;transform:translateY(105%);transition:transform .32s cubic-bezier(.2,.8,.2,1);flex-direction:column;max-height:92vh;padding-bottom:env(safe-area-inset-bottom,0)}.pn.on{transform:none;clip-path:none}',
      '.pn .strip{width:100%;order:0;flex-direction:row;padding:10px 14px;justify-content:space-between}.pn .strip .eb{writing-mode:horizontal-tb;transform:none;font-size:12px}.pn .strip .x{order:3}.pn .bd{padding:16px 18px 18px;overflow:auto}.pn h3{font-size:18px}.pn .big{font-size:30px;margin-top:10px}.pn .row{flex-direction:column;gap:12px;margin-top:12px}.pn .qr{display:none}.pn .code .cd{font-size:20px}}',
      '@media (prefers-reduced-motion:reduce){.pn,.ov,.tab{transition:none}.tab .bd,.tab .em{animation:none}}'
    ].join('\n');
  }

  var ICO = {
    apple: '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M3.6 2.3c-.3.3-.4.7-.4 1.2v17c0 .5.1.9.4 1.2l.1.1 9.5-9.5v-.2L3.7 2.2l-.1.1z"/><path d="M16.4 15.5 13.2 12.3v-.2l3.2-3.2.1.1 3.8 2.1c1.1.6 1.1 1.6 0 2.2l-3.8 2.1-.1.1z" opacity=".85"/><path d="M16.5 15.4 13.2 12.2 3.6 21.7c.4.4.9.4 1.6 0l11.3-6.3z" opacity=".7"/><path d="M16.5 8.9 5.2 2.4c-.7-.4-1.2-.3-1.6 0l9.6 9.7 3.3-3.2z" opacity=".55"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v0M17 20h4M20 17v4"/></svg>'
  };

  /* ═══ HTML ═══ */
  function tabHTML() {
    var t = cfg.theme;
    // Kapatma (×): ziyaretçi kulakçığı kapatırsa tab_close_days gün boyunca gösterilmez
    var cl = cfg.rules.tab_close !== false ? '<span class="cl" id="tcl" role="button" aria-label="Kapat">&times;</span>' : '';
    return '<button class="tab" id="tab" aria-label="' + esc(t.tab_text || 'Uygulamaya Özel') + '">' + cl + (t.tab_emoji ? '<span class="em">' + esc(t.tab_emoji) + '</span>' : '<span></span>') + '<span class="tx">' + esc(t.tab_text || 'UYGULAMAYA ÖZEL') + '</span>' + (t.tab_badge ? '<span class="bd">' + esc(t.tab_badge) + '</span>' : '<span></span>') + '</button>';
  }
  function storeBtn(os, cls, src) {
    var r = cfg.rules;
    var label = os === 'ios' ? (r.cta_ios || "App Store'dan İndir") : (r.cta_android || "Google Play'den İndir");
    return '<a class="' + cls + '" data-os="' + os + '" data-src="' + src + '" href="' + esc(goUrl(src, os)) + '" target="_blank" rel="noopener"><span>' + (os === 'ios' ? ICO.apple : ICO.play) + '</span><span><small>' + (os === 'ios' ? 'iPhone / iPad' : 'Android') + '</small>' + esc(label) + '</span></a>';
  }
  function codeHTML() {
    var r = cfg.rules, show = inApp() || r.show_code_web !== false;
    if (!r.code) return '';
    return '<div class="code' + (show ? '' : ' hid') + '" id="code"><div><div class="lb">' + (show ? 'İndirim kodu' : 'Kod uygulamada görünür') + '</div><div class="cd">' + esc(show ? r.code : 'XXXXXX') + '</div></div>' + (show ? '<button class="cp" id="cp">' + esc(r.copy_text || 'Kodu Kopyala') + '</button>' : '') + '</div>';
  }
  function panelHTML() {
    var t = cfg.theme, r = cfg.rules, os = mobileOS(), h = '';
    h += '<div class="ov" id="ov"></div><aside class="pn" id="pn" role="dialog" aria-label="' + esc(r.title || 'Uygulamaya Özel') + '">';
    h += '<div class="strip">' + (t.tab_emoji ? '<span class="em">' + esc(t.tab_emoji) + '</span>' : '<span></span>') + '<span class="eb">' + esc(r.eyebrow || t.tab_text || 'UYGULAMAYA ÖZEL') + '</span><button class="x" id="px" aria-label="Kapat">×</button></div>';
    h += '<div class="bd"><h3>' + esc(r.title || 'Uygulamayı indir, kazan') + '</h3>' + (r.subtitle ? '<p class="sub">' + esc(r.subtitle) + '</p>' : '') + (r.discount_label ? '<div class="big">' + esc(r.discount_label) + '</div>' : '');
    if (inApp()) {
      h += '<div class="row"><div class="col">' + codeHTML() + '<div class="note">Kodu ödeme adımındaki <b>İndirim kodu</b> alanına yapıştırman yeterli.</div></div></div>';
    } else if (os) {
      h += '<div class="row"><div class="col"><div class="st">' + storeBtn(os, '', 'tab_' + os) + '</div>' + codeHTML() + '</div></div>';
    } else {
      var qrSvg = r.show_qr !== false && window.YunbiQR ? (YunbiQR.svg(goUrl('qr'), { size: 126, ec: 'M', margin: 1, color: '#111827' }) || YunbiQR.svg(goUrl('qr', '', true), { size: 126, ec: 'M', margin: 1, color: '#111827' })) : ''; // uzun etiket QR'a sığmazsa etiketsiz
      h += '<div class="row">' + (qrSvg ? '<div class="qr">' + qrSvg + '<small>Telefon kamerasıyla okut, uygulama mağazası açılır</small></div>' : '') + '<div class="col">' + codeHTML() + '<div class="st">' + storeBtn('ios', 'sec', 'desk_ios') + storeBtn('android', 'sec', 'desk_android') + '</div></div></div>';
    }
    if (r.terms || cfg.ends_at) h += '<div class="tm">' + (cfg.ends_at ? '<b>Son gün: ' + esc(endDate()) + '</b>' + (r.terms ? ' · ' : '') : '') + esc(r.terms || '') + '</div>';
    h += '</div></aside><div class="toast" id="toast"></div>';
    return h;
  }
  function endDate() { try { var d = new Date(cfg.ends_at); return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } }

  /* ═══ davranış ═══ */
  function toast(msg) { var t = qs('#toast', root); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function open(source) {
    if (isOpen) return;
    isOpen = true; opened = true; markSeen(); clearTimeout(autoTm);
    qs('#pn', root).classList.add('on'); if (isMobile()) qs('#ov', root).classList.add('on');
    qs('#tab', root).classList.add('hide');
    track('open', { source: source || 'tab' });
  }
  function close(reason) {
    if (!isOpen) return;
    isOpen = false;
    qs('#pn', root).classList.remove('on'); qs('#ov', root).classList.remove('on');
    qs('#tab', root).classList.remove('hide');
    track('close', { source: reason || 'x' });
  }
  function copyCode() {
    var code = cfg.rules.code, cp = qs('#cp', root);
    var done = function () { if (cp) { cp.textContent = 'Kopyalandı ✓'; cp.classList.add('ok'); } track('copy', { value: code }); toast('Kod kopyalandı: ' + code); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code); done(); }); else { fallbackCopy(code); done(); } } catch (e) { done(); }
  }
  function fallbackCopy(txt) { try { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) { } }
  function dismissKey() { return 'yunbi_app_dismiss_' + TENANT; }
  function wasDismissed() {
    if (FORCE || cfg.rules.tab_close === false) return false;
    try { var t = +localStorage.getItem(dismissKey()) || 0; return t > 0 && Date.now() - t < Math.max(1, +cfg.rules.tab_close_days || 3) * 86400000; } catch (e) { return false; }
  }
  function bind() {
    var tcl = qs('#tcl', root);
    if (tcl) tcl.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      try { localStorage.setItem(dismissKey(), String(Date.now())); } catch (er) { }
      clearTimeout(autoTm); if (isOpen) close('dismiss');
      host.style.display = 'none';
      track('dismiss');
    });
    qs('#tab', root).addEventListener('click', function () { open('tab'); });
    qs('#px', root).addEventListener('click', function () { close('x'); });
    qs('#ov', root).addEventListener('click', function () { close('overlay'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close('esc'); });
    var cp = qs('#cp', root); if (cp) cp.addEventListener('click', copyCode);
    qsa('.st a', root).forEach(function (a) { a.addEventListener('click', function () { track('click', { source: a.getAttribute('data-src'), value: a.getAttribute('data-os') }); }); });
    // mobil alt sayfa: başlık şeridinden aşağı çekince kapat
    var pn = qs('#pn', root), y0 = null;
    pn.addEventListener('touchstart', function (e) { if (!isMobile()) return; var st = qs('.strip', root); y0 = st.contains(e.target) ? e.touches[0].clientY : null; }, { passive: true });
    pn.addEventListener('touchmove', function (e) { if (y0 == null) return; var dy = e.touches[0].clientY - y0; if (dy > 0) pn.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
    pn.addEventListener('touchend', function (e) { if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; pn.style.transform = ''; if (dy > 90) close('swipe'); y0 = null; });
    placeTab(); setTimeout(placeTab, 400); setTimeout(placeTab, 1500); setTimeout(placeTab, 4000);
    window.addEventListener('resize', function () { setTimeout(placeTab, 60); });
    try { new MutationObserver(function () { setTimeout(placeTab, 80); }).observe(document.body, { childList: true }); } catch (e) { }
  }
  /* Aynı kenardaki diğer Yunbi kulakçıklarının (hero #yunbi-hero, çark .ywheel-tab, sohbet #yunbi-chat-host) hemen ALTINA yerleş;
     altta yer kalmazsa ÜSTÜNE; hiçbiri yoksa dikey ortalı. Kulakçıklar hiçbir zaman üst üste binmez. */
  function sideTabs(left) {
    var out = [], w = window.innerWidth;
    function add(el) { if (!el) return; var r = el.getBoundingClientRect(); if (r.height > 0 && r.width > 0 && (((r.left + r.right) / 2) < w / 2) === left) out.push(r); }
    var hero = document.getElementById('yunbi-hero'); if (hero && hero.shadowRoot) add(hero.shadowRoot.querySelector('#tab'));
    add(document.querySelector('.ywheel-tab'));
    var chat = document.getElementById('yunbi-chat-host'); if (chat && chat.shadowRoot) add(chat.shadowRoot.querySelector('.lmode-tab .bubble'));
    return out;
  }
  function placeTab() {
    var tb = qs('#tab', root); if (!tb) return;
    var pos = cfg.theme.tab_position || 'right-middle', left = /^left/.test(pos), mid = /middle$/.test(pos);
    var pn = qs('#pn', root);
    var reset = function () { tb.style.top = ''; tb.style.bottom = ''; tb.style.transform = ''; if (pn) { pn.style.top = ''; pn.style.transform = ''; } };
    if (!mid) { reset(); return; }
    var rs = sideTabs(left); if (!rs.length) { reset(); return; }
    var lowest = 0, highest = 1e9;
    rs.forEach(function (r) { lowest = Math.max(lowest, r.bottom); highest = Math.min(highest, r.top); });
    var h = tb.offsetHeight || 120, vh = window.innerHeight, limit = vh - h - (isMobile() ? 110 : 24); // mobil: alt bar + zil için pay
    var top = Math.round(lowest + 8);
    if (top > limit) top = Math.round(highest - 8 - h);
    if (top < 8) { reset(); return; }
    tb.style.top = top + 'px'; tb.style.bottom = 'auto'; tb.style.transform = 'none';
    if (!isMobile() && pn) { pn.style.top = Math.max(60, Math.round(highest)) + 'px'; pn.style.transform = 'none'; }
  }
  function armAutoOpen() {
    var r = cfg.rules;
    if (AUTO_OPEN_NOW) { setTimeout(function () { open('api'); }, 350); return; }
    if (!r.auto_open || wasSeen()) return;
    if (isMobile() && !r.auto_open_mobile) { dbg('mobilde otomatik açılma kapalı (auto_open_mobile)'); return; }
    if ((r.no_auto_page_types || []).indexOf(pageType()) >= 0 && !FORCE) return;
    var fire = function (src) { if (!isOpen && !opened && !wasSeen()) open(src); };
    var delay = Math.max(0, Number(r.auto_open_delay || 0));
    if (delay > 0) {
      var left = delay * 1000, last = Date.now();
      var loop = function () { if (document.hidden) { last = Date.now(); autoTm = setTimeout(loop, 500); return; } var now = Date.now(); left -= now - last; last = now; if (left <= 0) fire('auto'); else autoTm = setTimeout(loop, 500); };
      autoTm = setTimeout(loop, 500);
    }
    if (r.auto_open_scroll > 0) {
      var onScroll = function () { var h = document.documentElement.scrollHeight - window.innerHeight; if (h > 200 && window.scrollY / h * 100 >= r.auto_open_scroll) { window.removeEventListener('scroll', onScroll); fire('scroll'); } };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    if (r.exit_intent && !isMobile()) {
      var onLeave = function (e) { if (e.clientY <= 0 && !e.relatedTarget) { document.removeEventListener('mouseout', onLeave); fire('exit'); } };
      setTimeout(function () { document.addEventListener('mouseout', onLeave); }, 3000);
    }
  }
  function mount() {
    var target = MOUNT_SEL ? qs(MOUNT_SEL) : document.body;
    if (!target) return false;
    host = document.createElement('div');
    host.id = 'yunbi-apppromo';
    host.style.cssText = 'display:block;position:static;width:0;height:0';
    target.appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = css(cfg.theme); root.appendChild(st);
    var wrap = document.createElement('div'); wrap.innerHTML = tabHTML() + panelHTML();
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
    if (MOUNT_SEL) { ['#tab', '#ov', '#pn', '#toast'].forEach(function (s) { var el = qs(s, root); if (el) el.style.position = 'absolute'; }); }
    return true;
  }
  function start() {
    fetch(API + '/config', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (c) {
      cfg = c || {}; cfg.rules = cfg.rules || {}; cfg.theme = cfg.theme || {};
      if (FORCE_THEME) cfg.theme = Object.assign({}, cfg.theme, FORCE_THEME);
      if (FORCE_RULES) cfg.rules = Object.assign({}, cfg.rules, FORCE_RULES);
      if (cfg.now) clockOffset = cfg.now - Date.now();
      cfg.rules.base_code = cfg.rules.code;
      var chc = cfg.rules.channel_codes || {};
      if (!inApp() && ATTR.ch && chc[ATTR.ch]) cfg.rules.code = chc[ATTR.ch];
      if (cfg.expired) { dbg('kampanya süresi dolmuş'); return; }
      if (!cfg.rules.code && !cfg.rules.ios_url && !cfg.rules.android_url) { dbg('kod/mağaza linki yok'); if (!FORCE) return; }
      if (inApp() && cfg.rules.in_app_mode === 'hide') { dbg('uygulama içinde gizli'); return; }
      if (shouldHide()) { dbg('bu sayfada gizli'); return; }
      if (wasDismissed()) { dbg('ziyaretçi kulakçığı kapatmış'); return; }
      if (!mount()) return;
      bind();
      track('view');
      armAutoOpen();
      window.YunbiApp = { open: function () { open('api'); }, close: close, version: VERSION, platform: PLATFORM, attribution: function () { return ATTR; }, config: function () { return cfg; }, qr: window.YunbiQR };
    }).catch(function (e) { dbg('config error', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
