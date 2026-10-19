(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi Mobil Alt Bar (CRO) — yalnız mobilde görünen alt navigasyon.
     Sekmeler dinamik: sepet adedi rozeti (Ticimax cart modeli), giriş yapmış üyenin adı,
     kategori alt sayfası (Yunbi kategori ağacı), arama (Akıllı Arama / tema araması),
     bulunulan sayfaya göre aktif sekme. 6 tema preset'i, panelden ayarlanır.
     Kurulum: <script src="https://eticaretq.com/widget/bottombar.js?v=3" data-tenant="tonnyblack"></script>
     Akıllı Menü (menu.js) temaya AYRI script olarak eklenir; sayfada yüklüyse Kategoriler sekmesi onu açar.
     Demo öznitelikleri: data-preset, data-theme (JSON), data-force="1" (masaüstünde de göster), data-mount
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiBottomBarLoaded) return;
  window.__yunbiBottomBarLoaded = true;

  var API = SCRIPT.src.replace(/\/widget\/bottombar\.js.*$/, '/w/' + TENANT + '/bottombar');
  var FORCE_PRESET = (SCRIPT.getAttribute('data-preset') || '').toLowerCase();
  var FORCE = SCRIPT.getAttribute('data-force') === '1';
  var MOUNT_SEL = SCRIPT.getAttribute('data-mount') || '';
  var FORCE_THEME = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { }
  var DEMO_CART = parseInt(SCRIPT.getAttribute('data-demo-cart'), 10);
  var DEMO_NAME = SCRIPT.getAttribute('data-demo-name') || '';
  var DEMO_ACTIVE = SCRIPT.getAttribute('data-demo-active') || ''; // demo: hangi sekme aktif görünsün
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiBar]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var cfg = null, host = null, root = null, bar = null, sheetOpen = false, lastY = 0, hidden = false, cartCount = 0, memberName = '';

  /* ═══ ikonlar (line / solid) ═══ */
  var ICONS = {
    home: ['<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-6h4v6"/>', '<path d="M12 3 2.5 11h2.7v9h5.3v-6h3v6h5.3v-9h2.7z"/>'],
    grid: ['<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>', '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>'],
    search: ['<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', '<path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.2 4.2 1.8-1.8-4.2-4.2A7.5 7.5 0 0 0 10.5 3zm0 2.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>'],
    bag: ['<path d="M6 8h12l1 12H5z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', '<path d="M6 8h12l1 12H5zM9.5 8V6.5a2.5 2.5 0 0 1 5 0V8h1.5V6.5a4 4 0 0 0-8 0V8z"/>'],
    cart: ['<path d="M3 4h2l2.4 11h11l2-7H7"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>', '<path d="M3 3h2.8l.6 2H21l-2.4 8.5H8.2L5.5 5H3zm5 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>'],
    user: ['<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9a8 8 0 0 1 16 0z"/>'],
    heart: ['<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>'],
    bell: ['<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>', '<path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22zm7-5-1.5-2v-4a5.5 5.5 0 0 0-11 0v4L5 17z"/>'],
    tag: ['<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>', '<path d="M3 3h9l9 9-9 9-9-9zm5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>'],
    percent: ['<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', '<path d="M18.6 3.6 20.4 5.4 5.4 20.4 3.6 18.6zM7 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm10 10a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/>'],
    gift: ['<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M12 9c-3-1-4-3-3-5s4 0 3 5zm0 0c3-1 4-3 3-5s-4 0-3 5z"/>', '<path d="M3 9h18v3H3zm1 5h7v7H4zm9 0h7v7h-7zM12 8.5C9 8 7.5 5.5 9 4s3.5 1 3 4.5zm0 0c3-.5 4.5-3 3-4.5s-3.5 1-3 4.5z"/>'],
    whatsapp: ['<path d="M4 20l1.2-3.6A8 8 0 1 1 8 19z"/><path d="M9 9.5c.5 2.5 2.5 4.5 5 5l1.2-1.2 1.8.8-.4 1.6c-3.5.3-7.4-3.6-7.1-7.1l1.6-.4.8 1.8z"/>', '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.4 12.6c-.2.5-1.1 1-1.5 1-.4.1-.9.1-1.5-.1-.3-.1-.8-.3-1.4-.5-2.4-1-4-3.5-4.1-3.7-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 2c.1.1.1.3 0 .4l-.3.5-.4.5c-.1.1-.3.3-.1.5.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.4.2.5.3 0 .1 0 .7-.2 1.2z"/>'],
    chat: ['<path d="M4 5h16v11H9l-5 4z"/>', '<path d="M3 4h18v12H9.5L3 21z"/>'],
    star: ['<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.7 1.1-5.9-4.3-4.1 5.9-.8z"/>', '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>'],
    phone: ['<path d="M5 4h4l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v4A2 2 0 0 1 18 21 16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', '<path d="M6.6 2.5 10 3l1.8 4.6-2.3 1.8a12 12 0 0 0 5.1 5.1l1.8-2.3L21 14v3.4a2.6 2.6 0 0 1-2.8 2.6C9.7 19.5 4.5 14.3 4 5.8A2.6 2.6 0 0 1 6.6 2.5z"/>'],
    sparkles: ['<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>', '<path d="m12 2 2 6 6 2-6 2-2 6-2-6-6-2 6-2zM5 16l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>'],
    truck: ['<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>', '<path d="M2 5h12v11H2zm13 4h4.5L22 12.5V16h-7zM6.5 15.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm11 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>']
  };
  function icon(name, solid) {
    var d = ICONS[name] || ICONS.star;
    return solid ? '<svg viewBox="0 0 24 24" fill="currentColor">' + d[1] + '</svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d[0] + '</svg>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(sel, el) { return (el || document).querySelector(sel); }

  /* ═══ tema CSS ═══ */
  function hexRgb(h) { h = (h || '#000000').replace('#', ''); return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function css(t) {
    var p = t.preset || 'classic', bg = t.bg || '#ffffff', ink = t.ink || '#374151', acc = t.accent || '#111827', r = (t.radius != null ? t.radius : 18) + 'px';
    var dark = p === 'dark';
    if (dark) { bg = t.bg && t.bg !== '#ffffff' ? t.bg : '#0f1115'; ink = t.ink && t.ink !== '#374151' ? t.ink : '#9ca3af'; acc = t.accent && t.accent !== '#111827' ? t.accent : '#ffffff'; }
    if (p === 'gradient' && acc === '#111827') acc = '#4f46e5'; // siyah gradyan sıkıcı; varsayılanı marka moru
    var shadow = t.show_shadow === false ? 'none' : (dark ? '0 -6px 24px rgba(0,0,0,.35)' : '0 -6px 24px rgba(15,23,42,.10)');
    var base = [
      ':host{all:initial;font-family:inherit;--bg:' + bg + ';--ink:' + ink + ';--acc:' + acc + ';--accrgb:' + hexRgb(acc) + ';--r:' + r + ';--sh:' + shadow + ';-webkit-font-smoothing:antialiased}',
      '*{box-sizing:border-box}a,button{font:inherit;color:inherit;text-decoration:none;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.wrap{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;transition:transform .25s ease;padding-bottom:env(safe-area-inset-bottom,0)}.wrap.hide{transform:translateY(110%)}',
      '.bar{display:flex;align-items:stretch;justify-content:space-around;background:var(--bg);color:var(--ink);box-shadow:var(--sh);min-height:58px;position:relative}',
      '.it{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 2px 7px;font-size:10.5px;font-weight:500;line-height:1;color:var(--ink);position:relative;transition:color .15s}',
      '.it svg{width:23px;height:23px;display:block}.it .lb{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.it.on{color:var(--acc);font-weight:600}',
      '.bd{position:absolute;top:4px;left:calc(50% + 6px);min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#dc2626;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px var(--bg)}',
      '.nolabel .it{padding:12px 2px}.nolabel .lb{display:none}.nolabel .it svg{width:25px;height:25px}',
      /* sheet */
      '.ov{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:2147482001;opacity:0;pointer-events:none;transition:opacity .2s}.ov.on{opacity:1;pointer-events:auto}',
      '.sh{position:fixed;left:0;right:0;bottom:0;z-index:2147482002;background:#fff;color:#111827;border-radius:20px 20px 0 0;max-height:82vh;display:flex;flex-direction:column;transform:translateY(105%);transition:transform .25s ease;box-shadow:0 -10px 40px rgba(0,0,0,.2);padding-bottom:env(safe-area-inset-bottom,0)}.sh.on{transform:none}',
      '.sh .hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;font-weight:700;font-size:16px}.sh .hd button{font-size:22px;line-height:1;color:#6b7280;padding:4px}',
      '.sh .grab{width:38px;height:4px;border-radius:2px;background:#e5e7eb;margin:10px auto 0}',
      '.sh .bd2{overflow:auto;padding:0 12px 16px}',
      '.cat{display:flex;align-items:center;justify-content:space-between;padding:13px 8px;border-bottom:1px solid #f1f2f5;font-size:15px;font-weight:600}.cat .c{font-size:12px;color:#9ca3af;font-weight:500;margin-left:auto;margin-right:10px}.cat svg{width:16px;height:16px;stroke:#9ca3af;fill:none;stroke-width:2}',
      '.sub{display:none;padding:2px 0 8px 8px}.cat.open+.sub{display:block}.sub a{display:flex;align-items:center;justify-content:space-between;padding:10px 10px;font-size:14px;color:#374151;border-radius:10px}.sub a:active{background:#f3f4f6}.sub a .c{font-size:12px;color:#9ca3af}.sub a.all{color:var(--acc);font-weight:600}',
      '.cat.open{color:var(--acc)}.cat.open svg{transform:rotate(90deg)}',
      '.toast{position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0));z-index:2147482003;background:#111827;color:#fff;font-size:13px;line-height:1.4;border-radius:12px;padding:10px 14px;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}.toast.on{opacity:1;transform:none}'
    ];
    if (p === 'classic') base.push('.bar{border-top:1px solid rgba(0,0,0,.06);border-radius:16px 16px 0 0}.it.on:after{content:"";position:absolute;top:0;width:22px;height:3px;border-radius:0 0 3px 3px;background:var(--acc)}');
    /* soft: aktif ikonun arkasında pastel daire, ikon büyük, etiket küçük */
    if (p === 'soft') base.push('.bar{border-top:1px solid rgba(0,0,0,.05);min-height:64px}.it{gap:2px;padding:7px 2px 6px}.it .ic{width:48px;height:32px;border-radius:16px;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .2s}.it.on .ic{background:rgba(var(--accrgb),.14);transform:translateY(-2px)}.it.on svg{stroke-width:2.1}.it.on{color:var(--acc)}.it .bd{top:0;left:calc(50% + 8px)}');
    /* expand: pasif sekmeler yalnız ikon; aktif sekme vurgu renkli hap olarak genişler ve etiketi gösterir */
    if (p === 'expand') base.push('.bar{min-height:62px;padding:0 10px;border-top:1px solid rgba(0,0,0,.05);justify-content:space-between}.it{flex:0 1 auto;flex-direction:row;gap:8px;padding:8px 12px;margin:9px 0;border-radius:999px;transition:background .25s,color .25s,padding .25s}.it .lb{display:none;font-size:12.5px;font-weight:600}.it.on{background:var(--acc);color:' + (dark ? '#111' : '#fff') + ';padding:8px 16px 8px 13px;flex:0 0 auto}.it.on .lb{display:inline}.it .ic{position:relative;display:flex}.it .bd{top:-6px;left:auto;right:-9px}.it.on .bd{box-shadow:0 0 0 2px var(--acc)}');
    /* pill: yüzen kapsül; aktif ikonun arkasında vurgu renkli yuvarlak kare */
    if (p === 'pill') base.push('.wrap{padding:0 14px calc(12px + env(safe-area-inset-bottom,0))}.bar{border-radius:var(--r);min-height:62px;box-shadow:0 12px 34px rgba(15,23,42,.18),0 0 0 1px rgba(0,0,0,.04)}.it{gap:3px;padding:7px 2px 6px}.it .ic{width:40px;height:32px;border-radius:12px;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s}.it.on .ic{background:var(--acc);color:' + (dark ? '#111' : '#fff') + '}.it.on{color:var(--acc)}.it .bd{top:-2px;left:calc(50% + 8px)}.it.on .bd{box-shadow:0 0 0 2px var(--bg)}');
    /* float: yüzen bar + ortada yükseltilmiş daire buton */
    if (p === 'float') base.push('.wrap{padding:0 14px calc(12px + env(safe-area-inset-bottom,0))}.bar{border-radius:var(--r);min-height:62px;box-shadow:0 12px 34px rgba(15,23,42,.2)}.it.on{color:var(--acc)}.it.on:not(.mid):after{content:"";position:absolute;bottom:6px;width:5px;height:5px;border-radius:50%;background:var(--acc)}.it.mid{margin-top:-24px}.it.mid .ic{width:56px;height:56px;border-radius:50%;background:var(--acc);color:' + (dark ? '#111' : '#fff') + ';display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(var(--accrgb),.4),0 0 0 5px var(--bg);margin-bottom:3px}.it.mid .ic svg{width:25px;height:25px}.it.mid .bd{top:-4px;left:calc(50% + 12px)}.it.mid .lb{color:var(--acc);font-weight:600}');
    /* gradient: vurgu renginden koyuya geçen zemin, beyaz ikonlar, aktif sekmede yarı saydam hap */
    if (p === 'gradient') base.push('.bar{background-color:var(--acc);background-image:linear-gradient(135deg,rgba(255,255,255,.14),rgba(0,0,0,.28));color:rgba(255,255,255,.72);border-radius:20px 20px 0 0;min-height:62px;box-shadow:0 -8px 28px rgba(var(--accrgb),.35)}.it{gap:3px}.it .ic{width:42px;height:30px;border-radius:15px;display:flex;align-items:center;justify-content:center;transition:background .2s}.it.on{color:#fff}.it.on .ic{background:rgba(255,255,255,.22)}.bd{background:#fff;color:var(--acc);box-shadow:none;top:0;left:calc(50% + 8px)}.sh .hd{color:#111827}');
    if (p === 'dark') base.push('.bar{border-top:1px solid rgba(255,255,255,.06);border-radius:18px 18px 0 0;background-image:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0))}.it.on{color:var(--acc);text-shadow:0 0 12px rgba(var(--accrgb),.6)}.it.on svg{filter:drop-shadow(0 0 6px rgba(var(--accrgb),.55))}.it.on:after{content:"";position:absolute;top:0;width:26px;height:2px;background:var(--acc);box-shadow:0 0 10px var(--acc)}.bd{box-shadow:0 0 0 2px #0f1115}.sh{background:#15171c;color:#f3f4f6}.cat{border-color:#262930}.sub a{color:#d1d5db}.sub a:active{background:#1f2229}.sh .grab{background:#2d3139}');
    if (p === 'minimal') base.push('.bar{min-height:54px;border-top:1px solid rgba(0,0,0,.08);box-shadow:none}.it{gap:2px;padding:7px 2px 6px;font-size:10px}.it svg{width:21px;height:21px}.it.on:after{content:"";position:absolute;bottom:0;width:28px;height:2px;background:var(--acc)}');
    return base.join('');
  }

  /* ═══ dinamik kaynaklar (Ticimax) ═══ */
  function readCart() {
    if (!isNaN(DEMO_CART)) return DEMO_CART;
    try {
      var m = window.cart && window.cart.get && window.cart.get.model && window.cart.get.model.cart;
      if (m && (m.totalProductQuantity != null || m.totalNumberProducts != null)) return parseInt(m.totalProductQuantity != null ? m.totalProductQuantity : m.totalNumberProducts, 10) || 0;
    } catch (e) { }
    try {
      var raw = localStorage.getItem('member-cart');
      if (raw) { var c = JSON.parse(raw); var cc = c && (c.cart || c); if (cc && (cc.totalProductQuantity != null || cc.totalNumberProducts != null)) return parseInt(cc.totalProductQuantity != null ? cc.totalProductQuantity : cc.totalNumberProducts, 10) || 0; }
    } catch (e) { }
    try {
      var el = qs('.sepetUrunSayisi, .cartCount, .cart-count, .headerCartCount, [class*="sepetAdet" i]');
      if (el) { var n = parseInt((el.textContent || '').replace(/\D/g, ''), 10); if (!isNaN(n)) return n; }
    } catch (e) { }
    return 0;
  }
  function readMember() {
    if (DEMO_NAME) return DEMO_NAME;
    try {
      var g = window.globalModel;
      if (g && g.isAuthenticated && g.member) {
        var n = (g.member.memberFirstName || (g.member.memberName || '').split(' ')[0] || '').trim();
        return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
      }
    } catch (e) { }
    return '';
  }
  function isLoggedIn() { try { return !!(DEMO_NAME || (window.globalModel && window.globalModel.isAuthenticated)); } catch (e) { return false; } }

  function pageType() {
    var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (p === '/') return 'home';
    var cartPath = (cfg.cart_url || '').replace(/^https?:\/\/[^/]+/, '').toLowerCase();
    if (cartPath && p.indexOf(cartPath.replace(/\/$/, '')) === 0) return 'cart';
    if (/^\/(hesabim|uyegiris|uye|account|login)/.test(p)) return 'account';
    // Ürün detayı: Ticimax productDetailModel globali veya satın alma bloğu (kategoride kart içi .productDetail olabilir, o yüzden önce liste kontrolü)
    if ((cfg.category_paths || []).indexOf(p) >= 0 || (qs('.ProductListContent') && qs('.filterBlock'))) return 'category';
    if (window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage')) return 'product';
    return 'other';
  }
  function itemActive(it, pt) {
    if (DEMO_ACTIVE) return it.type === DEMO_ACTIVE;
    if (it.type === 'home') return pt === 'home';
    if (it.type === 'categories') return pt === 'category';
    if (it.type === 'cart') return pt === 'cart';
    if (it.type === 'account' || it.type === 'favorites') return pt === 'account' && (it.type === 'account' ? location.hash.indexOf('Favori') < 0 : location.hash.indexOf('Favori') >= 0);
    if (it.url && it.url !== '/') { try { var u = it.url.replace(/^https?:\/\/[^/]+/, '').split('#')[0].toLowerCase(); return u && location.pathname.toLowerCase().indexOf(u) === 0; } catch (e) { } }
    return false;
  }
  function shouldHide() {
    var paths = (cfg.rules.hide_paths || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var p = location.pathname.toLowerCase();
    for (var i = 0; i < paths.length; i++) if (p.indexOf(paths[i]) === 0) return true;
    // Sepet sayfası ve ödeme akışı DAİMA gizli: müşteri ödeme adımından bara tıklayıp geri dönmesin
    var pt = pageType();
    if (pt === 'cart') return true;
    if (/sepet|checkout|odeme|siparis|payment|basket/.test(p)) return true;
    // Panelden seçilen sayfa tipleri (ör. ürün detayı: alttaki sepete ekle butonunu kapatmasın)
    var types = cfg.rules.hide_page_types || [];
    if (types.indexOf(pt) >= 0) return true;
    return false;
  }
  function mobileOk() { return FORCE || window.innerWidth <= (cfg.rules.max_width || 899); }

  /* ═══ render ═══ */
  function barHTML() {
    var t = cfg.theme, pt = pageType(), items = (cfg.items || []).slice(), solid = t.icon_style === 'solid';
    var midIdx = -1;
    if (t.preset === 'float' && items.length) {
      // Orta buton: panelden seçilen sekme ortaya taşınır; seçim yoksa ortadaki sekme
      midIdx = Math.floor(items.length / 2);
      if (t.center_item) {
        for (var k = 0; k < items.length; k++) if (items[k].key === t.center_item) { var picked = items.splice(k, 1)[0]; items.splice(midIdx, 0, picked); break; }
      }
    }
    return '<div class="bar' + (t.labels === false ? ' nolabel' : '') + '">' + items.map(function (it, i) {
      var label = it.label;
      if (it.type === 'account' && cfg.rules.account_name) { var n = readMember(); if (n) label = n; }
      var badge = (it.type === 'cart' && cfg.rules.cart_badge && cartCount > 0) ? '<span class="bd">' + (cartCount > 99 ? '99+' : cartCount) + '</span>' : '';
      var href = itemHref(it);
      return '<a class="it' + (itemActive(it, pt) ? ' on' : '') + (i === midIdx ? ' mid' : '') + '" href="' + esc(href) + '" data-key="' + esc(it.key) + '" data-type="' + esc(it.type) + '" aria-label="' + esc(it.label) + '">' +
        '<span class="ic">' + icon(it.icon, solid) + badge + '</span><span class="lb">' + esc(label) + '</span></a>';
    }).join('') + '</div>';
  }
  function itemHref(it) {
    var shop = cfg.shop_url || '';
    if (it.type === 'home') return shop ? shop + '/' : '/';
    if (it.type === 'cart') return abs(cfg.cart_url || '/checkout');
    if (it.type === 'account') return abs(isLoggedIn() ? (it.url || '/Hesabim') : '/UyeGiris');
    if (it.type === 'whatsapp') return cfg.whatsapp ? 'https://wa.me/' + cfg.whatsapp.replace(/\D/g, '') : (it.url ? abs(it.url) : 'javascript:void(0)');
    if (it.type === 'categories' || it.type === 'search') return 'javascript:void(0)';
    return it.url ? abs(it.url) : 'javascript:void(0)';
  }
  function abs(u) { if (!u) return '#'; if (/^https?:\/\//i.test(u)) return u; var shop = cfg.shop_url || ''; return shop && u.charAt(0) === '/' ? shop + u : u; }
  function sheetHTML() {
    var cats = cfg.categories || [];
    return '<div class="ov" id="ov"></div><div class="sh" id="sh"><div class="grab"></div><div class="hd"><span>Kategoriler</span><button id="shx" aria-label="Kapat">×</button></div><div class="bd2">' +
      cats.map(function (c, i) {
        var kids = c.children || [];
        if (!kids.length) return '<a class="cat" href="' + esc(abs(c.url)) + '" data-cat="' + esc(c.url) + '">' + esc(c.name) + '<span class="c">' + c.count + '</span></a>';
        return '<div class="cat" data-toggle="' + i + '">' + esc(c.name) + '<span class="c">' + c.count + '</span><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div><div class="sub">' +
          '<a class="all" href="' + esc(abs(c.url)) + '" data-cat="' + esc(c.url) + '">Tüm ' + esc(c.name) + ' →</a>' +
          kids.map(function (k) { return '<a href="' + esc(abs(k.url)) + '" data-cat="' + esc(k.url) + '">' + esc(k.name) + '<span class="c">' + k.count + '</span></a>'; }).join('') + '</div>';
      }).join('') + '</div></div>';
  }
  function render() {
    if (!root) return;
    var w = qs('#wrap', root);
    w.innerHTML = barHTML();
    try { document.body.style.paddingBottom = (w.offsetHeight + 8) + 'px'; } catch (e) { }
  }
  /* ═══ görsel viewport takibi (tarayıcı çubuğu gizlenince alt kenara yapış) ═══ */
  var vvRaf = 0, vvGap = 0, vvLoopUntil = 0, BBDBG = /[?&#]yunbi_bbdebug=1/.test(location.href);
  /* Chrome iOS (CriOS) kilidi: alt araç çubuğu gizlenirken görünür alan bir an büyür (gap>0), animasyon bitince Chrome
     sabit-eleman alanını ESKİ boyutuna geri çeker ama çubuk gizli kalır → sayfa içinden ölçülen hiçbir değer boşluğu
     göstermez, bar havada kalır. Çözüm: aşağı kaydırma sırasında görülen tepe boşluğu KİLİTLE ve yukarı kaydırana
     (ya da sayfa başına dönene) kadar uygula. Safari'de sabit alan gerçekten büyüdüğü için kilit hiç devreye girmez. */
  var IS_CRIOS = /CriOS\//.test(navigator.userAgent);
  var latchGap = 0, latchPeak = 0, baseVisible = 0, latchLastY = 0, latchDir = 0;
  function trackScrollDir() {
    var y = window.scrollY || window.pageYOffset || 0;
    if (y < latchLastY - 6 || y <= 0) { latchDir = -1; if (latchGap || latchPeak) { latchGap = 0; latchPeak = 0; vvGap = -1; } }
    else if (y > latchLastY + 6) latchDir = 1;
    latchLastY = y;
  }
  function queueViewportSync() { if (!vvRaf) vvRaf = requestAnimationFrame(syncViewport); }
  /* Kaydırma/dokunma sonrası ~1,2 sn boyunca her karede ölç: tarayıcı araç çubuğu animasyonla gizlenirken
     innerHeight / visualViewport / dvh farklı anlarda güncellenir; hangisi önce büyürse ona yapışırız. */
  function burst() { vvLoopUntil = Date.now() + 1200; queueViewportSync(); }
  function syncViewport() {
    vvRaf = 0;
    var vv = window.visualViewport; if (!root) return;
    var probe = qs('#vvp', root), dvp = qs('#vvd', root), w = qs('#wrap', root), sh = qs('#sh', root);
    if (!probe || !w) return;
    var gap = 0, fixedBottom = probe.getBoundingClientRect().bottom;
    var cVv = vv ? vv.offsetTop + vv.height : 0, cIn = window.innerHeight || 0, cDoc = document.documentElement.clientHeight || 0;
    var cDvh = dvp ? dvp.getBoundingClientRect().bottom : 0; // 100dvh probu: tarayıcının dinamik viewport alt kenarı
    var visibleBottom = Math.max(cVv, cIn, cDoc, cDvh);
    if (!(vv && vv.scale > 1.01)) { // pinch-zoom yokken
      gap = Math.round(visibleBottom - fixedBottom); // pozitif = fixed kenarın altında görünür boşluk var
      // Chrome iOS alt araç çubuğu + adres çubuğu + güvenli alan birlikte 160 px'i AŞIYOR (~170-190 px): eski 160 tavanı
      // tam gizlenince gap'i 0'a çeviriyordu → bar önce yapışıp sonra tekrar havaya kalkıyordu. Tavan artık ekranın %45'i.
      var cap = Math.max(200, Math.round((window.screen && screen.height ? screen.height : 900) * 0.45));
      if (gap < 0 || gap > cap) gap = 0; // klavye açıkken (negatif) ve sapmalarda dokunma
    }
    if (IS_CRIOS) {
      if (!baseVisible) baseVisible = visibleBottom;
      if (gap > 0 && latchDir >= 0) latchPeak = Math.max(latchPeak, gap);       // aşağı kayarken görülen tepe boşluk
      if (gap === 0 && latchPeak > 0 && latchDir >= 0 && visibleBottom <= baseVisible + 4) latchGap = latchPeak; // alan geri çekildi, çubuk hâlâ gizli
      if (gap === 0 && latchGap) gap = latchGap;
    }
    if (BBDBG) {
      // geçmiş: gap değişimlerini zamanla kaydet (tek ekran görüntüsünde salınım görülsün)
      window.__bbHist = window.__bbHist || []; var hl = window.__bbHist; var last = hl[hl.length - 1];
      var sig = gap + '|' + cIn + '|' + Math.round(cVv) + '|' + Math.round(cDvh) + '|' + Math.round(fixedBottom);
      if (!last || last.sig !== sig) { hl.push({ t: Date.now(), sig: sig }); if (hl.length > 10) hl.shift(); }
      var d = qs('#bbdbg', root);
      if (!d) { d = document.createElement('div'); d.id = 'bbdbg'; d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;font:11px/1.4 monospace;padding:6px 8px;border-radius:8px;pointer-events:none;white-space:pre'; root.appendChild(d); }
      d.textContent = 'fixedBottom ' + Math.round(fixedBottom) + '  gap ' + gap + (IS_CRIOS ? '  latch ' + latchGap + '/' + latchPeak + ' dir ' + latchDir : '') + '\ninnerH ' + cIn + '  docH ' + cDoc + '  vv ' + Math.round(cVv) + '  dvh ' + Math.round(cDvh) + '\nscreenH ' + screen.height + '  scrollY ' + Math.round(scrollY) + '  ' + (navigator.userAgent.match(/CriOS\/[\d.]+|Safari\/[\d.]+/) || [''])[0];
      d.textContent += '\n-- geçmiş (gap|innerH|vv|dvh|fixedBottom) --\n' + hl.map(function (x) { return ((x.t - hl[0].t) / 1000).toFixed(1) + 's ' + x.sig; }).join('\n');
    }
    if (Date.now() < vvLoopUntil) queueViewportSync();
    if (gap === vvGap) return;
    vvGap = gap;
    var b = gap ? (-gap) + 'px' : '';
    w.style.bottom = b;
    if (sh) sh.style.bottom = b;
    if (DEBUG) try { console.log('[yunbi-bottombar] viewport gap', gap, 'inner', window.innerHeight, 'vv', vv && vv.height, vv && vv.offsetTop); } catch (e) { }
  }
  function refreshDynamic() {
    var c = readCart();
    if (c !== cartCount) { cartCount = c; render(); }
  }

  /* ═══ olaylar ═══ */
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, page_type: pageType() }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }
  function toast(msg) {
    var t = qs('#toast', root);
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; root.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }
  function openSheet() { sheetOpen = true; qs('#ov', root).classList.add('on'); qs('#sh', root).classList.add('on'); track('sheet_open', { item: 'categories' }); }
  function closeSheet() { sheetOpen = false; qs('#ov', root).classList.remove('on'); qs('#sh', root).classList.remove('on'); }
  function openSearch() {
    if (cfg.rules.search_action !== 'theme' && window.YunbiSearch && typeof window.YunbiSearch.open === 'function') { window.YunbiSearch.open(''); return; }
    var t = qs('.newSearcBtnClick a, .mobile-search-item a, .search-icon, .searchIcon, .btnArama, [class*="search" i] a, a[href*="arama" i]');
    if (t) { t.click(); return; }
    var inp = qs('input[type="search"], input[name*="ara" i], input[id*="search" i]');
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); }
  }
  function openThemeMenu() {
    var t = qs('.newMenuBtnClick a, .mobile-menu-item a, .mobileMenuBtn, .navbar-toggle, .hamburger, [class*="menuBtn" i]');
    if (t) { t.click(); return true; }
    return false;
  }
  function bind() {
    var wrap = qs('#wrap', root);
    wrap.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('.it') : null;
      if (!a) return;
      var type = a.getAttribute('data-type'), key = a.getAttribute('data-key');
      // Demo/önizleme: hiçbir şey açma, sayfaya gitme; yalnız aktif sekmeyi değiştir (tıklanmış gibi göster)
      if (FORCE) { e.preventDefault(); DEMO_ACTIVE = type; render(); return; }
      track('click', { item: key });
      if (type === 'categories') {
        e.preventDefault();
        // Akıllı Menü (menu.js) aktifse Kategoriler onu açar (tema menüsü ve Yunbi alt sayfası yerine)
        if (window.YunbiMenu && typeof window.YunbiMenu.open === 'function') { window.YunbiMenu.open('bottombar'); return; }
        if (cfg.rules.categories_source === 'theme') {
          if (openThemeMenu()) return;
          // Demo sayfasında tema menüsü yok: yanıltmamak için bilgi ver; mağazada menü bulunamazsa Yunbi alt sayfası yedek
          if (FORCE) { toast('Mağazada bu sekme temanızın kendi kategori menüsünü açar.'); return; }
        }
        openSheet(); return;
      }
      if (type === 'search') { e.preventDefault(); openSearch(); return; }
      if (type === 'cart' && cfg.rules.cart_action === 'side') {
        try { if (window.cart && window.cart.render && typeof window.cart.render.rightSide === 'function') { e.preventDefault(); window.cart.render.rightSide(); return; } } catch (x) { }
      }
      if (type === 'account' && !isLoggedIn()) {
        try { if (window.mem && window.mem.init && typeof window.mem.init.bind === 'function' && window.siteSettings && window.siteSettings.uyeGirisPopupAktif) { e.preventDefault(); window.mem.init.bind('login'); return; } } catch (x) { }
      }
    });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('#ov, #shx, [data-toggle], [data-cat]') : null;
      if (!t) return;
      if (t.id === 'ov' || t.id === 'shx') { e.preventDefault(); closeSheet(); return; }
      if (t.hasAttribute('data-toggle')) { e.preventDefault(); t.classList.toggle('open'); return; }
      if (t.hasAttribute('data-cat')) { track('sheet_click', { item: 'categories', value: t.getAttribute('data-cat') }); }
    });
    if (cfg.theme.hide_on_scroll) {
      lastY = window.pageYOffset;
      window.addEventListener('scroll', function () {
        var y = window.pageYOffset, w = qs('#wrap', root);
        if (sheetOpen) return;
        if (y > lastY + 12 && y > 120) { if (!hidden) { hidden = true; w.classList.add('hide'); } }
        else if (y < lastY - 12 || y < 80) { if (hidden) { hidden = false; w.classList.remove('hide'); } }
        lastY = y;
      }, { passive: true });
    }
    window.addEventListener('resize', function () { host.style.display = mobileOk() ? '' : 'none'; });
    // Tarayıcı araç çubuğu (Chrome iOS alt bar / Android URL çubuğu) gizlenince görünür alan büyür ama bazı tarayıcılar
    // fixed elemanları yeni alt kenara taşımaz → görsel viewport ile ölçüp barı aşağı kaydır (Safari'de fark 0 = etkisiz)
    if (!MOUNT_SEL) {
      var vv = window.visualViewport;
      if (vv) { vv.addEventListener('resize', burst); vv.addEventListener('scroll', queueViewportSync); }
      window.addEventListener('orientationchange', function () { setTimeout(syncViewport, 300); });
      window.addEventListener('resize', burst); // innerHeight değişimi (araç çubuğu gizlenme/çıkma)
      window.addEventListener('scroll', function () { trackScrollDir(); burst(); }, { passive: true });
      window.addEventListener('touchend', burst, { passive: true }); // çubuk animasyonu bitene kadar ölçmeye devam
      window.addEventListener('touchmove', queueViewportSync, { passive: true });
      burst();
    }
    // Sepet değişimlerini yakala: Ticimax sepete ekleme sonrası localStorage/model güncellenir
    setInterval(refreshDynamic, 1500);
    window.addEventListener('storage', refreshDynamic);
    window.addEventListener('popstate', render);
  }

  function mount() {
    var target = MOUNT_SEL ? qs(MOUNT_SEL) : document.body;
    if (!target) return false;
    host = document.createElement('div');
    host.id = 'yunbi-bottombar';
    host.style.cssText = 'display:block;position:static;width:0;height:0';
    target.appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style');
    st.textContent = css(cfg.theme);
    root.appendChild(st);
    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.id = 'wrap';
    root.appendChild(wrap);
    var probe = document.createElement('div');
    probe.id = 'vvp';
    probe.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:0;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden';
    root.appendChild(probe);
    // 100dvh probu: tarayıcının DİNAMİK viewport yüksekliği (araç çubuğu gizlenince büyür) — fixed alt kenarla farkı = boşluk
    var dvp = document.createElement('div');
    dvp.id = 'vvd';
    dvp.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;height:100dvh;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden';
    root.appendChild(dvp);
    var sheet = document.createElement('div');
    sheet.innerHTML = sheetHTML();
    while (sheet.firstChild) root.appendChild(sheet.firstChild);
    if (MOUNT_SEL) { wrap.style.position = 'absolute'; qs('#sh', root).style.position = 'absolute'; qs('#ov', root).style.position = 'absolute'; }
    return true;
  }

  function start() {
    fetch(API + '/config', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (c) {
      cfg = c || {}; cfg.rules = cfg.rules || {}; cfg.theme = cfg.theme || {};
      if (FORCE_PRESET) cfg.theme.preset = FORCE_PRESET;
      if (FORCE_THEME) cfg.theme = Object.assign({}, cfg.theme, FORCE_THEME);
      if (!cfg.items || !cfg.items.length) { dbg('sekme yok'); return; }
      if (!FORCE && shouldHide()) { dbg('bu sayfada gizli'); return; }
      if (!mount()) return;
      cartCount = readCart();
      memberName = readMember();
      render();
      bind();
      host.style.display = mobileOk() ? '' : 'none';
      if (mobileOk()) track('view');
      window.YunbiBottomBar = { refresh: render, openSheet: openSheet, closeSheet: closeSheet };
    }).catch(function (e) { dbg('config error', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
