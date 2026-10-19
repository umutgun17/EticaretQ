/* KATMAN POLİTİKASI: bu widget sayfa AKIŞINDA durur (fixed değil) — ana sayfa slider'ının yerine/önüne gömülür; z-index kullanmaz. */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi "Flaş İndirim" Ana Sayfa Vitrini (CRO)
     Ana sayfa slider'ının yerine (replace) / önüne / sonrasına gömülen, süreli flaş indirim bölümü.
     Panelden seçilen 4–12 GERÇEK ürün; gerçek sayaç (bu gece 23:59 / set bitişi; sunucu saatine bağlı);
     gerçek 14 gün satış adedi ve stok ("Son N adet" yalnız gerçekten azsa); kart içinden beden seçip
     sepete ekleme (Ticimax AddToCartV3); sepette ekstra kupon (tek tıkla kopyala).
     6 yerleşim: spotlight | grid | rail | split | tabs | stories · 6 renk ön ayarı: rain | night | red | ember | forest | mono
     Dönüşüm ilkeleri (Baymard/NN-g): otomatik dönen slayt YOK, gerçek HTML metin, tek birincil eylem, hafif görsel (thumb),
     mobil önce, sahte aciliyet YOK (sayaç ve adetler sunucu verisi).
     Kurulum: <script src="https://eticaretq.com/widget/flash.js?v=1" data-tenant="tonnyblack"></script>
     Demo öznitelikleri: data-force="1" (sayfa/genişlik kuralları yok), data-mount (çapa seçici; replace),
     data-layout, data-preset, data-theme (JSON), data-rules (JSON), data-debug="1"
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiFlashLoaded) return;
  window.__yunbiFlashLoaded = true;

  var VERSION = 9;
  var API = SCRIPT.src.replace(/\/widget\/flash\.js.*$/, '/w/' + TENANT + '/flash');
  var FORCE = SCRIPT.getAttribute('data-force') === '1';
  var MOUNT_SEL = SCRIPT.getAttribute('data-mount') || '';
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  var FORCE_LAYOUT = SCRIPT.getAttribute('data-layout') || '';
  var FORCE_PRESET = SCRIPT.getAttribute('data-preset') || '';
  var FORCE_THEME = null, FORCE_RULES = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { }
  try { FORCE_RULES = SCRIPT.getAttribute('data-rules') ? JSON.parse(SCRIPT.getAttribute('data-rules')) : null; } catch (e) { }
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiFlash]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var PRESETS = {
    tonny: { accent: '#e3001b', accent2: '#000000', bg: '#1a1a1a', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: true },
    tonnywhite: { accent: '#e3001b', accent2: '#ebebeb', bg: '#ffffff', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: false, light: true },
    rain: { accent: '#2563eb', accent2: '#0b1a3f', bg: '#102454', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: true },
    night: { accent: '#a855f7', accent2: '#07060d', bg: '#1a1230', ink: '#f5f5f7', card_bg: '#1d1830', dark_cards: true, rain: true },
    red: { accent: '#e3001b', accent2: '#0f0f0f', bg: '#2a0a0e', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: false },
    ember: { accent: '#f97316', accent2: '#5b0b0b', bg: '#7f1d1d', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: false },
    forest: { accent: '#22c55e', accent2: '#03140c', bg: '#0f3d2e', ink: '#111827', card_bg: '#ffffff', dark_cards: false, rain: true },
    mono: { accent: '#111111', accent2: '#e7e5e4', bg: '#f5f5f4', ink: '#111111', card_bg: '#ffffff', dark_cards: false, rain: false, light: true }
  };

  var cfg = null, host = null, root = null, clockOffset = 0, tickTm = null, hidden = [], viewed = false, activeTab = '', atcBusy = {};
  var DEFAULT_MOUNT = '#sliderblok_0, [id^="sliderblok_"]';
  var preStyle = null, preHost = null;
  /* Erken gizleme + yer tutucu: config beklenmeden slider gizlenir, aynı yere koyu bir blok konur → "önce slider sonra vitrin" sıçraması olmaz.
     Yalnız ana sayfada (veya demo'da). Config "gösterme" derse geri alınır. */
  var isHomePath = (function () { var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/'; return p === '/' || /^\/(anasayfa|index\.html?)$/.test(p); })();
  if (isHomePath || FORCE || MOUNT_SEL) {
    try {
      preStyle = document.createElement('style'); preStyle.id = 'yunbi-flash-prehide';
      preStyle.textContent = (MOUNT_SEL || DEFAULT_MOUNT) + '{display:none!important}';
      (document.head || document.documentElement).appendChild(preStyle);
    } catch (e) { }
  }
  function placeholder() {
    if (preHost || !preStyle) return;
    var anchor = firstMatch(MOUNT_SEL || DEFAULT_MOUNT); if (!anchor || !anchor.parentNode) return;
    preHost = document.createElement('div'); preHost.id = 'yunbi-flash';
    var mh = window.innerWidth <= 640 ? 560 : 460;
    preHost.style.cssText = 'display:block;min-height:' + mh + 'px;background:linear-gradient(135deg,#1a1a1a,#000);';
    anchor.parentNode.insertBefore(preHost, anchor);
  }
  function unprehide() { if (preStyle && preStyle.parentNode) preStyle.parentNode.removeChild(preStyle); preStyle = null; if (preHost && preHost.parentNode && preHost !== host) preHost.parentNode.removeChild(preHost); preHost = null; }
  var cfgPromise = fetch(API + '/config', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });

  /* ═══ yardımcılar ═══ */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  function money(n) { n = Number(n || 0); var s = n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return s.replace(/,00$/, '') + ' TL'; }
  function device() { return window.innerWidth <= 768 ? 'm' : 'd'; }
  function isMobile() { return window.innerWidth <= 640; }
  function reducedMotion() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function hexRgb(h) { h = (h || '').replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return isNaN(n) ? '37,99,235' : [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(','); }
  function firstMatch(list) {
    var sels = String(list || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < sels.length; i++) { try { var el = qs(sels[i]); if (el) return el; } catch (e) { } }
    return null;
  }
  function allMatches(list) {
    var out = [], sels = String(list || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    sels.forEach(function (s) { try { qsa(s).forEach(function (el) { if (out.indexOf(el) < 0) out.push(el); }); } catch (e) { } });
    return out;
  }
  function pageType() {
    var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (p === '/' || /^\/(anasayfa|index\.html?)$/.test(p)) return 'home';
    if (qs('.ProductListContent') && qs('.filterBlock')) return 'category';
    if (window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage')) return 'product';
    return 'other';
  }
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, device: device(), layout: cfg && cfg.theme ? cfg.theme.layout : '', set_id: cfg && cfg.set ? cfg.set.id : '' }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }
  function segKey(s) { return { 'Kadın': 'kadin', 'Erkek': 'erkek', 'Çocuk': 'cocuk', 'Unisex': 'unisex' }[s] || ''; }
  function segments() {
    var seen = {}, out = [];
    (cfg.products || []).forEach(function (p) { if (p.segment && !seen[p.segment]) { seen[p.segment] = 1; out.push(p.segment); } });
    var order = ['Kadın', 'Erkek', 'Çocuk', 'Unisex'];
    out.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return out;
  }
  function shown() {
    var max = cfg.rules.max_products || 8, list = cfg.products || [], L = cfg.theme.layout, m = isMobile();
    if (L === 'tabs' && activeTab) list = list.filter(function (p) { return p.segment === activeTab; });
    // Yerleşim tavanı: hero yüksekliği kontrol altında kalsın (ızgara satır sayısı rules.rows; mobilde en çok 2 satır × 2)
    var rows = Math.max(1, Math.min(3, parseInt(cfg.rules.rows, 10) || 1));
    var cap = { spotlight: 4, split: 4, grid: m ? 4 : rows * 4, tabs: m ? 4 : rows * 4 }[L] || max;
    return list.slice(0, Math.min(max, cap));
  }

  /* ═══ CSS ═══ */
  function css(t) {
    var acc = t.accent, acc2 = t.accent2, bg = t.bg, ink = t.ink, cbg = t.card_bg || '#fff';
    var light = !!t.light || t.preset === 'mono' || t.preset === 'tonnywhite';
    var dark = !!t.dark_cards;
    var muted = dark ? 'rgba(255,255,255,.62)' : '#6b7280';
    var line = dark ? 'rgba(255,255,255,.1)' : '#eef0f3';
    var hdInk = light ? '#111111' : '#ffffff';
    var hdMuted = light ? 'rgba(17,17,17,.62)' : 'rgba(255,255,255,.72)';
    var r = (t.radius != null ? t.radius : 18) + 'px';
    var cw = (t.container_width || 0) > 0 ? t.container_width + 'px' : 'none';
    var full = t.width === 'full';
    var imgbg = dark ? 'rgba(255,255,255,.06)' : '#f4f4f5';
    var font = t.font ? t.font + ',' : '';
    var motion = !reducedMotion();
    var rain = t.rain !== false && motion;
    var L = t.layout;
    var c = [
      ':host{all:initial;display:block;font-family:' + font + 'inherit;--acc:' + acc + ';--acc2:' + acc2 + ';--accrgb:' + hexRgb(acc) + ';--bg:' + bg + ';--ink:' + ink + ';--cbg:' + cbg + ';--muted:' + muted + ';--line:' + line + ';--hd:' + hdInk + ';--hdm:' + hdMuted + ';--r:' + r + '}',
      '*{box-sizing:border-box}button,a{font:inherit;color:inherit;text-decoration:none;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}img{display:block;max-width:100%}',
      full ? '.wrap{max-width:none;margin:0;padding:0}.box{border-radius:0!important}.in{max-width:' + cw + ';margin:0 auto}' : '.wrap{max-width:' + cw + ';margin:0 auto;padding:10px 14px 6px}@media(max-width:640px){.wrap{padding:8px 10px 4px}}',
      '.box{position:relative;overflow:hidden;border-radius:var(--r);background:linear-gradient(135deg,var(--bg) 0%,var(--acc2) 100%);color:var(--hd);isolation:isolate}',
      light ? '.box{border:1px solid #e7e5e4}.c{border:1px solid #ececec;box-shadow:0 1px 2px rgba(0,0,0,.04)}' : '',
      /* ışık lekesi */
      '.box:before{content:"";position:absolute;inset:-40% -20% auto auto;width:60%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(var(--accrgb),' + (light ? '.12' : '.42') + ') 0%,transparent 62%);pointer-events:none;z-index:0}',
      /* yağmur: iki katman, saf CSS */
      rain ? '.rain,.rain:after{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background-image:repeating-linear-gradient(100deg,transparent 0 22px,rgba(255,255,255,' + (light ? '.10' : '.11') + ') 22px 23px,transparent 23px 48px);background-size:120px 160px;animation:yf-rain 1.1s linear infinite}.rain:after{background-image:repeating-linear-gradient(104deg,transparent 0 35px,rgba(255,255,255,' + (light ? '.06' : '.07') + ') 35px 36px,transparent 36px 70px);background-size:190px 260px;animation-duration:1.7s;opacity:.9}@keyframes yf-rain{to{background-position:-28px 160px}}' : '.rain{display:none}',
      '.in{position:relative;z-index:1}',
      /* başlık bloğu */
      '.hd{display:flex;flex-direction:column;gap:10px}',
      '.eb{display:inline-flex;align-items:center;gap:7px;align-self:flex-start;padding:6px 11px 6px 9px;border-radius:999px;background:' + (light ? 'var(--acc)' : 'rgba(255,255,255,.14)') + ';color:#fff;font-size:11.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;backdrop-filter:blur(6px)}',
      '.eb .bolt{width:14px;height:14px;fill:#ffd166;filter:drop-shadow(0 0 6px rgba(255,209,102,.8))}' + (motion ? '.eb .bolt{animation:yf-bolt 2.6s ease-in-out infinite}@keyframes yf-bolt{0%,70%,100%{opacity:1;transform:scale(1)}78%{opacity:.5;transform:scale(1.25)}86%{opacity:1}}' : ''),
      '.ti{margin:0;font-size:clamp(22px,2.6vw,36px);line-height:1.08;font-weight:900;letter-spacing:-.4px}',
      '.su{margin:0;font-size:14px;line-height:1.45;color:var(--hdm);max-width:46ch}',
      /* sayaç */
      '.tm{display:flex;align-items:center;gap:8px}.tm .lb{font-size:12px;font-weight:700;color:var(--hdm);margin-right:2px}.tm .lb .uc{display:none}',
      '.tm .u{display:flex;flex-direction:column;align-items:center;min-width:54px;padding:8px 6px 6px;border-radius:12px;background:linear-gradient(180deg,var(--acc) 0%,rgba(var(--accrgb),.82) 100%);color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 22px -8px rgba(var(--accrgb),.9),inset 0 1px 0 rgba(255,255,255,.25)}',
      '.tm .u b{font-size:26px;line-height:1;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,0,0,.25)}.tm .u i{font-style:normal;font-size:9.5px;font-weight:800;letter-spacing:1px;opacity:.85;margin-top:3px}',
      '.tm .sep{font-size:22px;font-weight:900;color:var(--acc);opacity:.9;margin-top:-6px}',
      '.tm.big .u{min-width:70px;padding:10px 8px 8px}.tm.big .u b{font-size:36px}',
      /* kupon */
      '.cp{display:inline-flex;align-items:center;gap:10px;align-self:flex-start;padding:8px 10px 8px 12px;border-radius:12px;border:1.5px dashed ' + (light ? 'rgba(17,17,17,.35)' : 'rgba(255,255,255,.45)') + ';background:' + (light ? '#fff' : 'rgba(255,255,255,.08)') + ';font-size:12.5px;color:var(--hd)}',
      '.cp b{font-weight:800}.cp code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;font-size:13.5px;letter-spacing:1.5px;padding:3px 8px;border-radius:7px;background:' + (light ? '#111' : '#fff') + ';color:' + (light ? '#fff' : 'var(--acc2)') + '}',
      '.cp button{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:5px 9px;border-radius:8px;background:var(--acc);color:#fff}.cp button svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2}.cp button.ok{background:#16a34a}',
      '.cp.auto{border-style:solid;border-color:rgba(34,197,94,.55);gap:9px}.cp.auto .ck{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#16a34a;color:#fff;align-items:center;justify-content:center;flex:none}.cp.auto .ck svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:3}.cp.auto small{display:block;font-size:11px;font-weight:600;color:var(--hdm)}',
      /* ürün kartı */
      '.c{position:relative;display:flex;flex-direction:column;border-radius:calc(var(--r) - 6px);background:var(--cbg);color:var(--ink);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px -14px rgba(0,0,0,.35);transition:transform .22s ease,box-shadow .22s ease}',
      motion ? '@media(hover:hover){.c:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(0,0,0,.08),0 18px 36px -16px rgba(0,0,0,.5)}}' : '',
      '.c .im{position:relative;display:block;aspect-ratio:2/3;background:#fff;overflow:hidden}.c .im img{width:100%;height:100%;object-fit:cover;object-position:center;transition:opacity .25s,transform .6s ease}' + (motion ? '@media(hover:hover){.c:hover .im img{transform:scale(1.06)}}' : ''),
      '.c .im img.alt{position:absolute;inset:0;opacity:0}@media(hover:hover){.c:hover .im img.alt{opacity:1}}',
      '.c .dc{position:absolute;top:8px;left:8px;padding:6px 9px;border-radius:9px;background:var(--acc);color:#fff;font-size:14px;font-weight:900;letter-spacing:.2px;box-shadow:0 2px 10px rgba(var(--accrgb),.5)}',
      '.c .sg{position:absolute;top:8px;right:8px;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.92);color:#111;font-size:10.5px;font-weight:700;letter-spacing:.3px}',
      '.c .bd{display:flex;flex-direction:column;gap:6px;padding:10px 11px 11px;flex:1}',
      '.c .nm{font-size:13px;line-height:1.3;font-weight:600;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em}',
      '.c .pr{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}.c .pr b{font-size:17px;font-weight:900;color:' + (dark ? '#fff' : 'var(--acc)') + ';letter-spacing:-.2px}.c .pr s{font-size:12px;color:var(--muted)}',
      '.c .pr.cart{align-items:center;gap:6px;margin-top:2px}.c .pr.cart .cl{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#fff;background:var(--acc);padding:3px 6px;border-radius:6px}.c .pr.cart b{font-size:19px}.c .pr.cart em{font-style:normal;font-size:11px;font-weight:800;color:var(--acc);border:1.5px solid rgba(var(--accrgb),.45);border-radius:6px;padding:2px 5px}.c .pr.sub{gap:6px;font-size:12.5px;font-weight:700;color:var(--ink);margin-top:-2px}.c .pr.sub s{font-weight:400}',
      '.c.sm .bd,.sp .c.big .bd,.spl .c .bd{justify-content:center}.c.sm .ac,.sp .c.big .ac,.spl .c .ac{margin-top:6px}',
      '.c .mt{display:flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:var(--muted);min-height:16px}.c .mt.hot{color:#dc2626}.fi{width:13px;height:13px;flex:none;fill:#f97316}.mt.hot .fi{fill:#dc2626}',
      '.c .bar{height:5px;border-radius:5px;background:' + (dark ? 'rgba(255,255,255,.12)' : '#eceef2') + ';overflow:hidden}.c .bar i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#f59e0b,#ef4444)}',
      '.c .ac{margin-top:auto;display:flex;gap:6px}',
      '.c .atc{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;border-radius:11px;background:var(--acc);color:#fff;font-size:13px;font-weight:800;transition:filter .15s,transform .1s}.c .atc:hover{filter:brightness(1.08)}.c .atc:active{transform:scale(.98)}.c .atc svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2.2}',
      '.c .atc.busy{opacity:.7;pointer-events:none}.c .atc.ok{background:#16a34a}',
      '.c .vw{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;border:1.5px solid var(--line);color:var(--muted)}.c .vw svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}',
      /* beden seçimi (kart içi) */
      '.sz{display:none;position:absolute;left:0;right:0;bottom:0;z-index:3;flex-wrap:wrap;gap:6px;padding:12px 12px 12px;background:var(--cbg);border-top:1px solid var(--line);border-radius:0 0 calc(var(--r) - 6px) calc(var(--r) - 6px);box-shadow:0 -10px 28px rgba(0,0,0,.22);max-height:80%;overflow:auto}.sz.on{display:flex}.sz .lbl{width:100%;font-size:11.5px;font-weight:800;color:var(--ink);padding-right:28px}.sz .lbl.hint{color:#dc2626}.sz .x{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:var(--line);color:var(--ink);font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center}',
      '.sz button{min-width:40px;height:34px;padding:0 10px;border-radius:9px;border:1.5px solid var(--line);font-size:13px;font-weight:700;color:var(--ink);background:transparent}.sz button:hover,.sz button.on{border-color:var(--acc);color:var(--acc)}.sz button.low{position:relative}.sz button.low:after{content:"";position:absolute;top:-3px;right:-3px;width:7px;height:7px;border-radius:50%;background:#ef4444}',
      /* küçük yatay kart */
      '.c.sm{flex-direction:row;align-items:stretch}.c.sm .im{width:118px;flex:none;aspect-ratio:auto;min-height:100%}.c.sm .bd{padding:9px 10px;gap:4px}.c.sm .nm{font-size:12.5px;min-height:0;-webkit-line-clamp:2}.c.sm .pr b{font-size:15px}.c.sm .dc{top:6px;left:6px;font-size:11px;padding:3px 6px}.c.sm .sg{display:none}.c.sm .atc{height:32px;font-size:12px;border-radius:9px}.c.sm .vw{width:32px;height:32px;border-radius:9px}',
      /* alt bağlantı */
      '.ft{display:flex;justify-content:center;padding-top:12px}.ft a{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--hd);padding:9px 16px;border-radius:999px;border:1.5px solid ' + (light ? 'rgba(17,17,17,.25)' : 'rgba(255,255,255,.35)') + '}.ft a svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.2}',
      /* toast */
      '.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0));transform:translate(-50%,20px);opacity:0;background:#111827;color:#fff;font-size:13px;font-weight:600;padding:10px 16px;border-radius:12px;z-index:2147482000;transition:all .25s;pointer-events:none;max-width:90vw}.toast.on{opacity:1;transform:translate(-50%,0)}',
      /* ── spotlight ── */
      L === 'spotlight' ? [
        '.sp{display:grid;grid-template-columns:minmax(260px,.9fr) minmax(220px,.85fr) minmax(240px,1fr);gap:16px;padding:22px}',
        '.sp .hd{justify-content:center}.sp .c.big .im{aspect-ratio:2/3}.sp .c.big .nm{font-size:14.5px}.sp .c.big .pr.cart b{font-size:24px}',
        '.sp .side{display:flex;flex-direction:column;gap:10px}.sp .side .c.sm{flex:1}',
        '@media(max-width:900px){.sp{grid-template-columns:1fr 1fr}.sp .hd{grid-column:1/-1}}',
        '@media(max-width:640px){.sp{display:flex;flex-direction:column;gap:12px;padding:14px 12px 12px}.sp .ti{font-size:22px}.sp .su{font-size:12.5px}.sp .c.big{flex-direction:row}.sp .c.big .im{width:48%;aspect-ratio:auto}.sp .c.big .pr b{font-size:19px}.sp .side .c.sm .im{width:104px}}'
      ].join('') : '',
      /* ── grid ── */
      L === 'grid' ? [
        '.gh{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px 12px}.gh .hd{gap:6px}.gh .ti{font-size:clamp(20px,2.2vw,28px)}.gh .rt{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
        '.gd{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 20px 20px}',
        '@media(max-width:900px){.gd{grid-template-columns:repeat(3,1fr)}}',
        '@media(max-width:640px){.gh{padding:14px 12px 10px}.gd{grid-template-columns:1fr 1fr;gap:9px;padding:0 10px 12px}.gh .rt{width:100%;justify-content:space-between}}'
      ].join('') : '',
      /* ── rail ── */
      L === 'rail' ? [
        '.gh{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px 12px}.gh .hd{gap:6px}.gh .ti{font-size:clamp(20px,2.2vw,28px)}.gh .rt{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
        '.rl{position:relative}.rl .tr{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 20px 20px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.rl .tr::-webkit-scrollbar{display:none}.rl .c{flex:0 0 212px;scroll-snap-align:start}',
        '.rl .nv{position:absolute;top:38%;width:40px;height:40px;border-radius:50%;background:#fff;color:#111;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2}.rl .nv svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2.4}.rl .nv.l{left:6px}.rl .nv.r{right:6px}',
        '@media(max-width:640px){.gh{padding:14px 12px 10px}.rl .tr{gap:9px;padding:2px 10px 12px;scroll-padding-left:10px}.rl .c{flex-basis:46%}.rl .nv{display:none}.gh .rt{width:100%;justify-content:space-between}}',
        '@media(hover:none){.rl .nv{display:none}}'
      ].join('') : '',
      /* ── split ── */
      L === 'split' ? [
        '.spl{display:grid;grid-template-columns:minmax(300px,.95fr) minmax(0,1.3fr);gap:0}',
        '.spl .po{display:flex;flex-direction:column;justify-content:center;gap:16px;padding:34px 30px}.spl .po .ti{font-size:clamp(28px,3.4vw,46px)}.spl .po .su{font-size:15px}',
        '.spl .po .go{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:12px 20px;border-radius:999px;background:' + (light ? '#111' : '#fff') + ';color:' + (light ? '#fff' : 'var(--acc2)') + ';font-weight:800;font-size:14px}.spl .po .go svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.4}',
        '.spl .gd{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:18px 18px 18px 0;align-content:center}',
        '.spl .c{flex-direction:row;align-items:stretch}.spl .c .im{width:150px;flex:none;aspect-ratio:auto;min-height:100%}.spl .c .bd{padding:10px 12px;gap:5px}.spl .c .nm{font-size:12.5px;min-height:0}.spl .c .pr b{font-size:16px}.spl .c .dc{top:6px;left:6px;font-size:11px;padding:3px 6px}.spl .c .sg{display:none}.spl .c .atc{height:34px;font-size:12.5px;border-radius:9px}.spl .c .vw{width:34px;height:34px;border-radius:9px}',
        '@media(max-width:900px){.spl{grid-template-columns:1fr}.spl .po{padding:22px 18px 14px}.spl .gd{padding:0 14px 14px}.spl .c{flex-direction:column}.spl .c .im{width:auto;aspect-ratio:2/3;min-height:0}.spl .c .sg{display:block}.spl .c .bd{padding:10px 11px 11px;gap:6px}.spl .c .nm{min-height:2.6em}.spl .c .pr b{font-size:17px}.spl .c .atc{height:38px;font-size:13px;border-radius:11px}.spl .c .vw{width:38px;height:38px;border-radius:11px}}',
        '@media(max-width:640px){.spl .po{padding:18px 14px 12px;gap:10px}.spl .po .ti{font-size:26px}.spl .po .su{font-size:13px}.spl .gd{grid-template-columns:1fr 1fr;gap:9px;padding:0 10px 12px}}'
      ].join('') : '',
      /* ── tabs ── */
      L === 'tabs' ? [
        '.gh{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px 10px}.gh .hd{gap:6px}.gh .ti{font-size:clamp(20px,2.2vw,28px)}.gh .rt{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
        '.tb{display:flex;gap:8px;padding:4px 20px 12px;overflow-x:auto;scrollbar-width:none}.tb::-webkit-scrollbar{display:none}.tb button{flex:none;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:700;color:var(--hd);background:' + (light ? '#fff' : 'rgba(255,255,255,.12)') + ';border:1.5px solid ' + (light ? '#e7e5e4' : 'transparent') + '}.tb button.on{background:' + (light ? '#111' : '#fff') + ';color:' + (light ? '#fff' : 'var(--acc2)') + '}.tb button small{opacity:.7;font-weight:600;margin-left:4px}',
        '.gd{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 20px 20px}',
        '@media(max-width:900px){.gd{grid-template-columns:repeat(3,1fr)}}',
        '@media(max-width:640px){.gh{padding:14px 12px 8px}.tb{padding:2px 10px 10px}.gd{grid-template-columns:1fr 1fr;gap:9px;padding:0 10px 12px}.gh .rt{width:100%;justify-content:space-between}}'
      ].join('') : '',
      /* ── stories ── */
      L === 'stories' ? [
        '.gh{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px 12px}.gh .hd{gap:6px}.gh .ti{font-size:clamp(20px,2.2vw,28px)}.gh .rt{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
        '.st{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-left:20px;padding:4px 20px 20px;scrollbar-width:none}.st::-webkit-scrollbar{display:none}',
        '.st .s{position:relative;flex:0 0 232px;aspect-ratio:2/3;border-radius:calc(var(--r) - 6px);overflow:hidden;scroll-snap-align:start;background:#222;color:#fff;display:flex;flex-direction:column;justify-content:flex-end;box-shadow:0 10px 30px -14px rgba(0,0,0,.6)}',
        '.st .s img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;transition:transform .5s ease}' + (motion ? '@media(hover:hover){.st .s:hover img{transform:scale(1.05)}}' : ''),
        '.st .s .ov{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,.78) 100%)}',
        '.st .s .dc{position:absolute;top:10px;left:10px;padding:6px 9px;border-radius:10px;background:var(--acc);font-size:13px;font-weight:900;box-shadow:0 2px 10px rgba(var(--accrgb),.5)}.st .s .sg{position:absolute;top:10px;right:10px;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.9);color:#111;font-size:10.5px;font-weight:700}',
        '.st .s .bd{position:relative;padding:12px 12px 12px;display:flex;flex-direction:column;gap:6px}.st .s .nm{font-size:13.5px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 2px rgba(0,0,0,.5)}',
        '.st .s .pr{display:flex;align-items:baseline;gap:7px}.st .s .pr b{font-size:20px;font-weight:900}.st .s .pr s{font-size:12px;opacity:.75}.st .s .pr.cart{align-items:center;gap:6px}.st .s .pr.cart .cl{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;background:var(--acc);padding:3px 6px;border-radius:6px}.st .s .pr.cart em{font-style:normal;font-size:11px;font-weight:800;border:1.5px solid rgba(255,255,255,.5);border-radius:6px;padding:1px 5px}.st .s .pr.sub{font-size:12px;font-weight:700;opacity:.9;gap:6px}.st .s .pr.sub s{font-weight:400}.st .s .mt{font-size:11.5px;font-weight:700;opacity:.9;display:flex;align-items:center;gap:5px}.st .s .mt svg{width:13px;height:13px}',
        '.st .s .ac{display:flex;gap:6px;margin-top:4px}.st .s .atc{flex:1;height:38px;border-radius:11px;background:#fff;color:#111;font-size:13px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:6px}.st .s .atc svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2.2}.st .s .atc.ok{background:#16a34a;color:#fff}.st .s .atc.busy{opacity:.7;pointer-events:none}',
        '.st .s .sz{background:rgba(10,10,10,.92);backdrop-filter:blur(8px);border-top:0;border-radius:0 0 calc(var(--r) - 6px) calc(var(--r) - 6px)}.st .s .sz button{border-color:rgba(255,255,255,.35);color:#fff}.st .s .sz .lbl{color:#fff}.st .s .sz .x{background:rgba(255,255,255,.2);color:#fff}',
        '@media(max-width:640px){.gh{padding:14px 12px 10px}.st{gap:9px;padding:2px 10px 12px;scroll-padding-left:10px}.st .s{flex-basis:62%}.gh .rt{width:100%;justify-content:space-between}}'
      ].join('') : '',
      /* ── mobil kompakt başlık (en sonda: yerleşim kurallarını ezer) ── */
      '@media(max-width:640px){.hd,.spl .po,.sp .hd,.gh .hd{gap:9px;align-items:center;text-align:center}.spl .po .go{align-self:center}.ti,.su{text-align:center;width:100%}.su{margin:0 auto}.gh{justify-content:center}.gh .rt{justify-content:center}.eb{align-self:center}.cp{align-self:center;text-align:left}.tm{justify-content:center;flex-wrap:wrap;row-gap:6px}.tm .lb{width:100%;text-align:center;margin:0;font-size:11px;letter-spacing:1px}.tm .lb .lc{display:none}.tm .lb .uc{display:inline}.ti,.sp .ti,.spl .po .ti,.gh .ti{font-size:24px}.su,.sp .su,.spl .po .su{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.tm{gap:6px}.tm .lb{font-size:11px}.tm .u,.tm.big .u{min-width:58px;padding:8px 6px 6px}.tm .u b,.tm.big .u b{font-size:28px}.tm .u i{font-size:9px}.tm .sep{font-size:22px;margin-top:-6px}.cp{padding:6px 8px 6px 10px;font-size:12px;gap:8px}.cp code{font-size:12.5px;padding:2px 6px}.cp button{padding:4px 8px}.sp,.spl .po{gap:9px}}'
    ];
    return c.join('\n');
  }

  /* ═══ SVG ═══ */
  var I = {
    bolt: '<svg class="bolt" viewBox="0 0 24 24"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    fire: '<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2c.6 3.6-1.9 5.2-1.9 8.1 0 1.4.9 2.4 2 2.4 1.3 0 1.9-1.3 1.5-2.8 2.1 1.5 3.6 3.6 3.6 6.1A6.4 6.4 0 0 1 5.6 15.6c0-3 2-4.6 2.6-7.1.4 1.5 1.4 2.4 2.4 2.4C10.3 7.2 9.9 4 13.2 2z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    chevL: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
    chevR: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>'
  };

  /* ═══ parçalar ═══ */
  function eyebrowHTML() { var s = cfg.set || {}; return '<span class="eb">' + I.bolt + esc(s.eyebrow || cfg.rules.eyebrow || 'Flaş İndirim') + '</span>'; }
  function brTitle(t) { return esc(t).replace(/\s*(\||\n)\s*/g, '<br>'); }
  function titleHTML(big) { var s = cfg.set || {}; return '<h2 class="ti">' + brTitle(s.title || cfg.rules.title) + '</h2>' + (s.subtitle || cfg.rules.subtitle ? '<p class="su">' + esc(s.subtitle || cfg.rules.subtitle) + '</p>' : ''); }
  function zeroTimer() { return cfg.rules && cfg.rules.timer_mode === 'zero'; }
  function timerHTML(big) {
    if (!cfg.ends_at && !zeroTimer()) return '';
    return '<div class="tm' + (big ? ' big' : '') + '" id="tm" aria-live="off">' + (cfg.rules.timer_label ? '<span class="lb"><span class="lc">' + esc(cfg.rules.timer_label) + '</span><span class="uc">' + esc(String(cfg.rules.timer_label).toLocaleUpperCase('tr-TR')) + '</span></span>' : '') +
      '<span class="u d" style="display:none"><b>00</b><i>GÜN</i></span><span class="sep d" style="display:none">:</span>' +
      '<span class="u"><b class="h">00</b><i>SAAT</i></span><span class="sep">:</span><span class="u"><b class="m">00</b><i>DAKİKA</i></span><span class="sep">:</span><span class="u"><b class="s">00</b><i>SANİYE</i></span></div>';
  }
  function couponMode() { var s = cfg.set || {}; var m = s.coupon_mode || (s.coupon ? 'code' : 'none'); if (m === 'code' && !s.coupon) m = 'none'; return m; }
  function couponHTML() {
    var s = cfg.set || {}, m = couponMode(); if (m === 'none') return '';
    if (m === 'auto') return '<div class="cp auto"><span class="ck">' + I.check + '</span><span><b>' + esc(s.coupon_text || 'Sepette ekstra indirim') + '</b><small>Kod gerekmez, sepette otomatik uygulanır</small></span></div>';
    return '<div class="cp"><span><b>' + esc(s.coupon_text || (cfg.rules.coupon_label + ' indirim')) + '</b></span><code>' + esc(s.coupon) + '</code><button type="button" data-act="copy" aria-label="Kuponu kopyala">' + I.copy + 'Kopyala</button></div>';
  }
  function cartPct() { var s = cfg.set || {}; return couponMode() !== 'none' && s.coupon_pct > 0 ? s.coupon_pct : 0; }
  function priceHTML(p) {
    var cur = p.dprice || p.price, pct = cartPct();
    if (!pct) return '<div class="pr"><b>' + money(cur) + '</b>' + (p.dprice ? '<s>' + money(p.price) + '</s>' : '') + '</div>';
    var cart = Math.round(cur * (100 - pct)) / 100;
    return '<div class="pr cart"><span class="cl">Sepette</span><b>' + money(cart) + '</b><em>-%' + pct + '</em></div>' +
      '<div class="pr sub"><span>' + money(cur) + '</span>' + (p.dprice ? '<s>' + money(p.price) + '</s>' : '') + '</div>';
  }
  function metaHTML(p) {
    var r = cfg.rules;
    if (r.show_stock !== false && p.stock > 0 && p.stock <= (r.stock_threshold || 5)) return '<div class="mt hot">' + I.fire + 'Son ' + p.stock + ' adet!</div>';
    if (r.show_sold !== false && p.sold14 >= (r.sold_threshold || 10)) return '<div class="mt">' + I.fire + 'Bu hafta ' + p.sold14 + ' adet satıldı</div>';
    return '<div class="mt"></div>';
  }
  function barHTML(p) {
    var r = cfg.rules; if (r.show_bar === false || !(p.sold14 >= (r.sold_threshold || 10) || p.stock <= (r.stock_threshold || 5))) return '';
    var pct = p.stock <= (r.stock_threshold || 5) ? 92 : Math.max(12, Math.min(90, Math.round(p.sold14 / (p.sold14 + p.stock) * 100)));
    return '<div class="bar" title="Satış hızı"><i style="width:' + pct + '%"></i></div>';
  }
  function sizesHTML(p, i) {
    if (!p.variants || p.variants.length <= 1) return '';
    var vis = p.variants.slice(0, 14);
    return '<div class="sz" data-i="' + i + '"><span class="lbl">Beden seçin, sepete eklensin</span><button type="button" class="x" data-act="szclose" aria-label="Kapat">×</button>' + vis.map(function (v) {
      return '<button type="button" data-vid="' + esc(v.vid) + '" data-label="' + esc(v.label) + '"' + (v.stock <= 2 ? ' class="low" title="Son ' + v.stock + '"' : '') + '>' + esc(v.label) + '</button>';
    }).join('') + '</div>';
  }
  function actionsHTML(p, i) {
    var r = cfg.rules;
    var quick = r.quick_add !== false && cfg.platform === 'ticimax';
    return '<div class="ac">' + (quick
      ? '<button type="button" class="atc" data-act="atc" data-i="' + i + '">' + I.bag + esc(r.cta_text || 'Hemen Al') + '</button><a class="vw" href="' + esc(p.url) + '" data-act="go" data-i="' + i + '" aria-label="' + esc(r.view_text || 'İncele') + '">' + I.eye + '</a>'
      : '<a class="atc" href="' + esc(p.url) + '" data-act="go" data-i="' + i + '">' + I.eye + esc(r.view_text || 'İncele') + '</a>') + '</div>';
  }
  function bigImg(u) { return String(u || '').replace('/UrunResimleri/thumb/', '/UrunResimleri/buyuk/'); }
  function cardHTML(p, i, cls, eager) {
    var swap = cfg.rules.hover_swap !== false && p.imgs && p.imgs[1] && !isMobile();
    var src = cls === 'big' ? bigImg(p.img) : p.img; // kahraman kart: 1200×1800 (keskin), diğerleri 400×600 thumb
    return '<article class="c ' + (cls || '') + '" data-i="' + i + '">' +
      '<a class="im" href="' + esc(p.url) + '" data-act="go" data-i="' + i + '">' +
      '<img src="' + esc(src) + '" alt="' + esc(p.name) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' width="300" height="400">' +
      (swap ? '<img class="alt" src="' + esc(p.imgs[1]) + '" alt="" loading="lazy" width="300" height="400">' : '') +
      (p.discount_pct > 0 ? '<span class="dc">-%' + p.discount_pct + '</span>' : '') +
      (cfg.rules.show_segment !== false && p.segment ? '<span class="sg">' + esc(p.segment) + '</span>' : '') + '</a>' +
      '<div class="bd"><a class="nm" href="' + esc(p.url) + '" data-act="go" data-i="' + i + '">' + esc(p.name) + '</a>' +
      priceHTML(p) + metaHTML(p) + barHTML(p) + sizesHTML(p, i) + actionsHTML(p, i) + '</div></article>';
  }
  function storyHTML(p, i, eager) {
    return '<article class="s" data-i="' + i + '">' +
      '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + '><div class="ov"></div>' +
      (p.discount_pct > 0 ? '<span class="dc">-%' + p.discount_pct + '</span>' : '') + (cfg.rules.show_segment !== false && p.segment ? '<span class="sg">' + esc(p.segment) + '</span>' : '') +
      '<div class="bd"><a class="nm" href="' + esc(p.url) + '" data-act="go" data-i="' + i + '">' + esc(p.name) + '</a>' +
      priceHTML(p) + metaHTML(p) + sizesHTML(p, i) + actionsHTML(p, i) + '</div></article>';
  }
  function absUrl(u) { u = String(u || ''); return /^\//.test(u) && cfg.shop_url ? cfg.shop_url + u : u; }
  function footerHTML() {
    var r = cfg.rules; if (!r.footer_text || !r.footer_url) return '';
    return '<div class="ft"><a href="' + esc(absUrl(r.footer_url)) + '" data-act="cta">' + esc(r.footer_text) + I.arrow + '</a></div>';
  }
  function topbarHTML(extra) {
    return '<div class="gh"><div class="hd">' + eyebrowHTML() + titleHTML() + '</div><div class="rt">' + timerHTML() + couponHTML() + (extra || '') + '</div></div>';
  }

  /* ═══ yerleşimler ═══ */
  function bodyHTML() {
    var L = cfg.theme.layout, list = shown();
    if (L === 'spotlight') {
      var big = list[0], side = list.slice(1, 4);
      return '<div class="sp"><div class="hd">' + eyebrowHTML() + titleHTML() + timerHTML(true) + couponHTML() + '</div>' +
        (big ? cardHTML(big, 0, 'big', true) : '') + '<div class="side">' + side.map(function (p, k) { return cardHTML(p, k + 1, 'sm', k === 0); }).join('') + '</div></div>' + footerHTML();
    }
    if (L === 'grid') return topbarHTML() + '<div class="gd">' + list.map(function (p, k) { return cardHTML(p, k, '', k < 2); }).join('') + '</div>' + footerHTML();
    if (L === 'rail') return topbarHTML() + '<div class="rl"><button type="button" class="nv l" data-act="prev" aria-label="Önceki">' + I.chevL + '</button><button type="button" class="nv r" data-act="next" aria-label="Sonraki">' + I.chevR + '</button><div class="tr" id="tr">' + list.map(function (p, k) { return cardHTML(p, k, '', k < 2); }).join('') + '</div></div>' + footerHTML();
    if (L === 'split') {
      var r = cfg.rules;
      return '<div class="spl"><div class="po">' + eyebrowHTML() + titleHTML() + timerHTML(true) + couponHTML() +
        (r.footer_text && r.footer_url ? '<a class="go" href="' + esc(absUrl(r.footer_url)) + '" data-act="cta">' + esc(r.footer_text) + I.arrow + '</a>' : '') + '</div>' +
        '<div class="gd">' + list.slice(0, 4).map(function (p, k) { return cardHTML(p, k, '', k < 2); }).join('') + '</div></div>';
    }
    if (L === 'tabs') {
      var segs = segments(), all = cfg.products || [];
      var tabs = '<div class="tb"><button type="button" data-tab="" class="' + (activeTab ? '' : 'on') + '">Tümü<small>' + Math.min(all.length, cfg.rules.max_products || 8) + '</small></button>' +
        segs.map(function (s) { return '<button type="button" data-tab="' + esc(s) + '" class="' + (activeTab === s ? 'on' : '') + '">' + esc(s) + '<small>' + all.filter(function (p) { return p.segment === s; }).length + '</small></button>'; }).join('') + '</div>';
      return topbarHTML() + tabs + '<div class="gd" id="gd">' + list.map(function (p, k) { return cardHTML(p, k, '', k < 2); }).join('') + '</div>' + footerHTML();
    }
    if (L === 'stories') return topbarHTML() + '<div class="st">' + list.map(function (p, k) { return storyHTML(p, k, k < 2); }).join('') + '</div>' + footerHTML();
    return '';
  }
  function html() { return '<div class="wrap"><section class="box" aria-label="Flaş indirim"><div class="rain"></div><div class="in">' + bodyHTML() + '</div></section></div><div class="toast" id="toast"></div>'; }

  /* ═══ sayaç ═══ */
  function tick() {
    var tm = qs('#tm', root); if (!tm || zeroTimer() || !cfg.ends_at) return;
    var left = Math.floor((cfg.ends_at - (Date.now() + clockOffset)) / 1000);
    if (left <= 0) { dbg('kampanya bitti'); destroy(); return; }
    var d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    if (d > 0) { qsa('.d', tm).forEach(function (el) { el.style.display = ''; }); qs('.u.d b', tm).textContent = String(d); }
    qs('.h', tm).textContent = pad(h); qs('.m', tm).textContent = pad(m); qs('.s', tm).textContent = pad(s);
  }

  /* ═══ sepete ekle ═══ */
  function toast(msg) { var t = qs('#toast', root); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function refreshThemeCart() {
    try { if (window.cart && window.cart.get && typeof window.cart.get.cart === 'function') window.cart.get.cart(); } catch (e) { }
    try { if (window.YunbiBottomBar && window.YunbiBottomBar.refresh) setTimeout(window.YunbiBottomBar.refresh, 600); } catch (e) { }
  }
  function cardEl(i) { return qs('[data-i="' + i + '"].c, [data-i="' + i + '"].s', root); }
  function addToCart(i, vid, label) {
    var p = shown()[i]; if (!p) return;
    var el = cardEl(i), btn = el && qs('.atc', el);
    if (!vid) {
      if (!p.variants || p.variants.length === 0) { location.href = p.url; return; }
      if (p.variants.length === 1) { vid = p.variants[0].vid; label = p.variants[0].label; }
      else {
        var sz = qs('.sz', el);
        if (sz) { qsa('.sz.on', root).forEach(function (o) { if (o !== sz) o.classList.remove('on'); }); sz.classList.toggle('on'); }
        return;
      }
    }
    if (atcBusy[i]) return; atcBusy[i] = true;
    if (btn) btn.classList.add('busy');
    var pid = parseInt(p.pid, 10) || 0, vnum = parseInt(vid, 10) || 0;
    function fail(why) {
      atcBusy[i] = false; if (btn) btn.classList.remove('busy');
      track('error', { value: 'atc: ' + why, product_id: p.id });
      if (FORCE) { toast('Demo: sepete ekleme mağazada çalışır (' + (label || '') + ')'); return; }
      location.href = p.url;
    }
    fetch('/api/cart/AddToCartV3', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ AsortiUrunKartId: 0, KampanyaId: 0, BagliUrunId: 0, UrunKartId: pid, UrunId: vnum, Adet: 1, UrunNot: '', AssortmentQuantities: [] })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.isError) { fail((j && (j.message || j.errorMessage)) || 'http'); return; }
      atcBusy[i] = false;
      if (btn) { btn.classList.remove('busy'); btn.classList.add('ok'); btn.innerHTML = I.check + 'Sepete eklendi'; }
      var sz = qs('.sz', el); if (sz) sz.classList.remove('on');
      track('atc', { product_id: p.id, value: label });
      refreshThemeCart();
      toast('Sepete eklendi' + (label ? ' · ' + label + ' beden' : '') + (couponMode() === 'auto' ? ' · ' + (cfg.set.coupon_text || 'sepette ekstra indirim') + ' otomatik' : couponMode() === 'code' ? ' · Kupon: ' + cfg.set.coupon : ''));
    }).catch(function (e) { fail(e && e.message); });
  }

  /* ═══ olaylar ═══ */
  function bind() {
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button,a') : null; if (!t) return;
      var act = t.getAttribute('data-act'), i = parseInt(t.getAttribute('data-i'), 10);
      if (act === 'szclose') { e.preventDefault(); var szc = t.parentNode; if (szc) szc.classList.remove('on'); return; }
      if (t.getAttribute('data-vid')) {
        e.preventDefault();
        var sz = t.parentNode, ii = parseInt(sz.getAttribute('data-i'), 10);
        qsa('button', sz).forEach(function (x) { x.classList.remove('on'); }); t.classList.add('on');
        addToCart(ii, t.getAttribute('data-vid'), t.getAttribute('data-label'));
        return;
      }
      if (t.getAttribute('data-tab') != null) {
        activeTab = t.getAttribute('data-tab') || '';
        track('tab', { value: activeTab || 'all' });
        var gd = qs('#gd', root); if (gd) gd.innerHTML = shown().map(function (p, k) { return cardHTML(p, k, '', k < 2); }).join('');
        qsa('.tb button', root).forEach(function (b) { b.classList.toggle('on', (b.getAttribute('data-tab') || '') === activeTab); });
        return;
      }
      if (act === 'atc') { e.preventDefault(); addToCart(i); return; }
      if (act === 'go') { var p = shown()[i]; if (p) track('click', { product_id: p.id, value: 'pos' + (i + 1) }); return; }
      if (act === 'cta') { track('cta', { value: t.getAttribute('href') }); return; }
      if (act === 'copy') {
        e.preventDefault(); var code = cfg.set && cfg.set.coupon; if (!code) return;
        function done() { t.classList.add('ok'); t.innerHTML = I.check + 'Kopyalandı'; toast('Kupon kopyalandı: ' + code + ' — sepette uygula'); track('coupon', { value: code }); }
        try { navigator.clipboard.writeText(code).then(done, done); } catch (x) { done(); }
        return;
      }
      if (act === 'prev' || act === 'next') { var tr = qs('#tr', root); if (tr) tr.scrollBy({ left: (act === 'next' ? 1 : -1) * Math.round(tr.clientWidth * .8), behavior: 'smooth' }); return; }
    });
  }
  function observe() {
    var box = qs('.box', root); if (!box) return;
    if (!('IntersectionObserver' in window)) { track('view'); return; }
    var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting && !viewed) { viewed = true; track('view', cfg.rot_off != null ? { value: 'off' + cfg.rot_off } : {}); io.disconnect(); } }); }, { threshold: .4 });
    io.observe(box);
  }

  /* ═══ montaj ═══ */
  function shouldSkip() {
    if (FORCE) return false;
    var r = cfg.rules;
    var paths = (r.hide_paths || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var p = location.pathname.toLowerCase();
    for (var i = 0; i < paths.length; i++) if (paths[i] && p.indexOf(paths[i]) === 0) return 'path';
    var pages = r.pages && r.pages.length ? r.pages : ['home'];
    if (pages.indexOf(pageType()) < 0) return 'page:' + pageType();
    if (r.max_width > 0 && window.innerWidth > r.max_width) return 'width';
    if (r.min_width > 0 && window.innerWidth < r.min_width) return 'width';
    return false;
  }
  function mount() {
    if (preHost && preHost.parentNode && !MOUNT_SEL && (cfg.rules.mount_mode || 'replace') === 'replace' && firstMatch(cfg.rules.mount) === firstMatch(DEFAULT_MOUNT)) {
      // yer tutucu zaten doğru yerde: içine kur, sıçrama yok
      host = preHost; preHost = null; host.style.cssText = 'display:block';
      allMatches(cfg.rules.mount).forEach(function (a) { hidden.push([a, a.style.display]); a.style.display = 'none'; });
      if (preStyle && preStyle.parentNode) preStyle.parentNode.removeChild(preStyle); preStyle = null;
      host.setAttribute('data-layout', cfg.theme.layout); host.setAttribute('lang', 'tr');
      root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var st0 = document.createElement('style'); st0.textContent = css(cfg.theme); root.appendChild(st0);
      var w0 = document.createElement('div'); w0.innerHTML = html();
      while (w0.firstChild) root.appendChild(w0.firstChild);
      return true;
    }
    unprehide();
    host = document.createElement('div');
    host.id = 'yunbi-flash';
    host.setAttribute('data-layout', cfg.theme.layout);
    host.setAttribute('lang', 'tr'); // text-transform: İ/ı doğru büyüsün
    var mode = cfg.rules.mount_mode || 'replace';
    var anchors = MOUNT_SEL ? allMatches(MOUNT_SEL) : allMatches(cfg.rules.mount);
    var anchor = anchors[0];
    if (MOUNT_SEL) mode = 'replace';
    if (anchor) {
      if (mode === 'replace') {
        anchors.forEach(function (a) { hidden.push([a, a.style.display]); a.style.display = 'none'; });
        anchor.parentNode.insertBefore(host, anchor);
      } else if (mode === 'before') anchor.parentNode.insertBefore(host, anchor);
      else if (mode === 'after') anchor.parentNode.insertBefore(host, anchor.nextSibling);
      else anchor.insertBefore(host, anchor.firstChild);
    } else {
      var fb = firstMatch(cfg.rules.mount_fallback) || document.body;
      fb.insertBefore(host, fb.firstChild);
      dbg('çapa yok, fallback', fb);
    }
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = css(cfg.theme); root.appendChild(st);
    var wrap = document.createElement('div'); wrap.innerHTML = html();
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
    return true;
  }
  function destroy() {
    clearInterval(tickTm); unprehide();
    hidden.forEach(function (h) { h[0].style.display = h[1]; }); hidden = [];
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; root = null;
  }
  function render() {
    if (!root) return;
    var box = qs('.in', root); if (box) box.innerHTML = bodyHTML();
    var st = qs('style', root); if (st) st.textContent = css(cfg.theme);
    host.setAttribute('data-layout', cfg.theme.layout);
    tick();
  }

  function start() {
    placeholder();
    cfgPromise.then(function (c) {
      cfg = c || {}; cfg.rules = cfg.rules || {}; cfg.theme = cfg.theme || {};
      if (FORCE_PRESET && PRESETS[FORCE_PRESET]) cfg.theme = Object.assign({}, cfg.theme, PRESETS[FORCE_PRESET], { preset: FORCE_PRESET });
      if (FORCE_LAYOUT) cfg.theme.layout = FORCE_LAYOUT;
      if (FORCE_THEME) cfg.theme = Object.assign({}, cfg.theme, FORCE_THEME);
      if (FORCE_RULES) cfg.rules = Object.assign({}, cfg.rules, FORCE_RULES);
      if (cfg.theme.preset === 'mono' || cfg.theme.preset === 'tonnywhite') cfg.theme.light = true;
      if (cfg.now) clockOffset = cfg.now - Date.now();
      // Ziyaretçi bazlı rotasyon: oturum başına rastgele pencere (ürün sırası segment dengeli; pencere = rotate_step'in katı), oturum boyunca sabit
      if (cfg.rules.rotate_mode === 'visitor' && (cfg.products || []).length > (cfg.rules.rotate_step || 4)) {
        var stp = Math.max(1, cfg.rules.rotate_step || 4), n = cfg.products.length, win = Math.ceil(n / stp), off = 0;
        try { var k = 'yunbi_flash_off:' + (cfg.set ? cfg.set.id : ''), v = sessionStorage.getItem(k); if (v === null) { v = String(Math.floor(Math.random() * win)); sessionStorage.setItem(k, v); } off = (parseInt(v, 10) % win) * stp; } catch (e) { off = (Math.floor(Math.random() * win)) * stp; }
        cfg.products = cfg.products.slice(off).concat(cfg.products.slice(0, off)); cfg.rot_off = off;
      }
      if (!cfg.set || !(cfg.products || []).length) { dbg('bugün için set/ürün yok'); unprehide(); return; }
      if (cfg.ends_at && cfg.ends_at - (Date.now() + clockOffset) <= 0) { dbg('süre dolmuş'); unprehide(); return; }
      var skip = shouldSkip(); if (skip) { dbg('atlandı:', skip); unprehide(); return; }
      mount(); bind(); observe();
      tick(); tickTm = setInterval(tick, 1000);
      window.YunbiFlash = {
        version: VERSION, config: function () { return cfg; }, destroy: destroy,
        setLayout: function (l) { cfg.theme.layout = l; activeTab = ''; render(); },
        setPreset: function (p) { if (PRESETS[p]) { cfg.theme = Object.assign({}, cfg.theme, PRESETS[p], { preset: p, light: p === 'mono' || p === 'tonnywhite' }); render(); } },
        setTheme: function (t) { cfg.theme = Object.assign({}, cfg.theme, t || {}); render(); },
        setRules: function (r) { cfg.rules = Object.assign({}, cfg.rules, r || {}); render(); }
      };
      dbg('hazır', cfg.theme.layout, cfg.theme.preset, (cfg.products || []).length + ' ürün');
    }).catch(function (e) { dbg('config error', e); unprehide(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
