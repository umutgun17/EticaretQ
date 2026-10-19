/*! Yunbi Ürün Rozetleri (CRO) — liste kartı + ürün detay rozetleri ve sosyal kanıt satırları.
 *  <script src="https://eticaretq.com/widget/badge.js?v=11" data-tenant="SLUG" async></script>
 *  Veri: /w/{slug}/badges/config (gerçek satış / GA4 görüntülenme / stok / kampanya kategorisi; 15 dk'da bir üretilir).
 *  Sahte aciliyet yok: her sayı mağazanın kendi verisinden gelir, eşik altı gösterilmez.
 */
(function () {
  'use strict';
  if (window.__yunbiBadgeLoaded) return;
  window.__yunbiBadgeLoaded = true;

  var SCRIPT = document.currentScript || document.querySelector('script[src*="/widget/badge.js"]');
  if (!SCRIPT) return;
  var SLUG = SCRIPT.getAttribute('data-tenant');
  if (!SLUG) return;
  var API = (SCRIPT.getAttribute('data-api') || SCRIPT.src.replace(/\/widget\/badge\.js.*$/, '')) + '/w/' + encodeURIComponent(SLUG) + '/badges';
  var DEMO = SCRIPT.getAttribute('data-demo') === '1';
  var DEBUG = /yunbi_debug=1/.test(location.search);
  var NS = 'ybdg';

  var C = null;              // config
  var TYPES = {};            // id → tip
  var seenCards = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  var impr = { total: 0, badged: 0, by: {} }, imprDirty = false;
  var io = null;

  function log() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-badge]'].concat([].slice.call(arguments))); }
  function sid() {
    try { var s = localStorage.getItem('yunbi_sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('yunbi_sid', s); } return s; } catch (e) { return ''; }
  }
  function device() { return (window.innerWidth || 1024) < 900 ? 'm' : 'd'; }
  function send(body, beacon) {
    if (DEMO) return;
    var payload = JSON.stringify(Object.assign({ sid: sid(), path: location.pathname, device: device() }, body));
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon(API + '/event', new Blob([payload], { type: 'text/plain' })); return; }
      fetch(API + '/event', { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) {}
  }
  function fmt(n) { n = +n || 0; try { return n.toLocaleString('tr-TR'); } catch (e) { return String(n); } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ── İkonlar (inline SVG, currentColor) ── */
  var IC = {
    gift: '<path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>',
    hourglass: '<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
    bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    cart: '<circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    ruler: '<path d="M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="M7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>'
  };
  function icon(name, size) {
    if (!name || name === 'none' || !IC[name]) return '';
    var solid = name === 'star' || name === 'flame' || name === 'bolt' || name === 'heart';
    return '<svg class="' + NS + '-ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + (solid ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="' + (solid ? '0' : '2.2') + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[name] + '</svg>';
  }

  /* ── Renk yardımcıları ── */
  function rgb(hex) { var h = String(hex || '#111827').replace('#', ''); return [parseInt(h.substr(0, 2), 16) || 0, parseInt(h.substr(2, 2), 16) || 0, parseInt(h.substr(4, 2), 16) || 0]; }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function darken(hex, f) { var c = rgb(hex); return 'rgb(' + Math.round(c[0] * f) + ',' + Math.round(c[1] * f) + ',' + Math.round(c[2] * f) + ')'; }
  function inkOn(hex) { var c = rgb(hex); return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 160 ? '#111827' : '#ffffff'; }

  /* ── Stil ── */
  function css() {
    var T = C.theme, fs = { s: 9.5, m: 10.5, l: 12 }[T.size] || 10.5, ph = { s: '3px 6px', m: '4px 8px', l: '5px 10px' }[T.size] || '4px 8px';
    var rad = { pill: '999px', rounded: '6px', square: '2px', ribbon: '2px 999px 999px 2px' }[T.shape] || '6px';
    var off = (+T.list_offset || 0) + 'px', pos = String(T.list_position || 'top-left').split('-');
    return '' +
      '.' + NS + '-host{position:relative!important}' +
      '.' + NS + '-wrap{position:absolute!important;' + pos[0] + ':' + off + '!important;' + pos[1] + ':' + off + '!important;z-index:4!important;display:flex!important;flex-direction:' + (T.list_direction === 'row' ? 'row' : 'column') + '!important;flex-wrap:' + (T.list_direction === 'row' ? 'wrap' : 'nowrap') + '!important;gap:4px!important;width:max-content!important;align-items:' + (pos[1] === 'right' ? 'flex-end' : 'flex-start') + '!important;pointer-events:none!important;max-width:calc(100% - ' + (2 * (+T.list_offset || 0)) + 'px)!important;margin:0!important;padding:0!important}' +
      '.' + NS + '-b{all:unset;box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;gap:4px!important;max-width:100%!important;font-weight:700!important;font-size:' + fs + 'px!important;line-height:1.15!important;font-family:' + (T.font ? T.font + ',' : '') + 'inherit!important;letter-spacing:' + (T.uppercase ? '.02em' : '0') + '!important;text-transform:' + (T.uppercase ? 'uppercase' : 'none') + '!important;padding:' + ph + '!important;border-radius:' + rad + '!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;' + (T.shadow ? 'box-shadow:0 1px 3px rgba(0,0,0,.18)!important;' : '') + '}' +
      '.' + NS + '-b span{overflow:hidden;text-overflow:ellipsis}' +
      '.' + NS + '-ic{flex:0 0 auto;display:block}' +
      '.' + NS + '-anc{display:block!important;position:relative!important;height:0!important;width:100%!important;margin:0!important;padding:0!important;overflow:visible!important;z-index:2!important;clear:both!important}' +
      '.' + NS + '-anc .' + NS + '-wrap{top:' + (Math.max(+T.list_offset || 0, 6) + 4) + 'px!important;bottom:auto!important;' + (pos[1] === 'right' ? 'right' : 'left') + ':' + (Math.max(+T.list_offset || 0, 6) + 4) + 'px!important}' +
      '.' + NS + '-anc .' + NS + '-b{font-size:' + (fs + 1) + 'px!important;padding:' + ({ s: '4px 8px', m: '5px 9px', l: '6px 11px' }[T.size] || '5px 9px') + '!important}' +
      '.' + NS + '-pdp{display:flex!important;flex-wrap:wrap!important;gap:6px!important;margin:8px 0 10px!important;clear:both!important}' +
      '.' + NS + '-pdp .' + NS + '-b{font-size:' + (fs + 1.5) + 'px!important;padding:' + ({ s: '4px 8px', m: '5px 10px', l: '6px 12px' }[T.size] || '5px 10px') + '!important;box-shadow:none!important}' +
      '.' + NS + '-proof{all:unset;box-sizing:border-box!important;display:block!important;width:100%!important;clear:both!important;margin:0!important;padding:16px 0!important}' +
      '.' + NS + '-pcard{display:block!important;font-weight:500!important;font-size:13px!important;line-height:1.4!important;font-family:' + (T.font ? T.font + ',' : '') + 'inherit!important;color:#374151!important;' +
        (T.proof_style === 'card' ? 'border:1px solid #e5e7eb!important;border-radius:10px!important;padding:8px 12px!important;background:#fff!important;' : '') + '}' +
      '.' + NS + '-pl{display:flex!important;align-items:center!important;gap:8px!important;padding:3px 0!important}' +
      '.' + NS + '-pl b{font-weight:700!important;color:' + (T.proof_accent || '#111827') + '!important}' +
      '.' + NS + '-pi{flex:0 0 auto;width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center}' +
      cornerCss(off) + spotCss(T) + barCss(T) +
      // Mobilde alt köşeler (liste kartı); ürün detay çapasında konum JS ile görselin altına göre hesaplanır
      (T.mobile_bottom ? '@media (max-width:599px){.' + NS + '-wrap.' + NS + '-l.' + NS + '-l{top:auto!important;bottom:' + off + '!important}}' : '') +
      (T.mobile_compact ? compactCss() : '');
  }
  /** Mobil liste kartında kompakt rozetler (mobile_compact): küçük gösterişli etiket, kartta tek gösterişli rozet, ince standart rozet. Ürün detay (.ybdg-anc) değişmez. */
  function compactCss() {
    var L = '.' + NS + '-l .' + NS;
    return '@media (max-width:599px){' +
      '.' + NS + '-wrap.' + NS + '-l{gap:3px!important}' +
      L + '-sp{border-radius:6px!important;margin:3px 2px!important;box-shadow:0 0 0 1.5px var(--ybc),0 3px 8px rgba(0,0,0,.28)!important}' +
      L + '-sp+.' + NS + '-sp{display:none!important}' +
      L + '-sp-t{font-size:12.5px!important;padding:3px 6px 2px!important}' +
      L + '-sp-s{font-size:8px!important;letter-spacing:.03em!important;padding:2px 5px!important;gap:2px!important}' +
      L + '-sp-s .' + NS + '-ic{width:9px!important;height:9px!important}' +
      L + '-b{font-size:8.5px!important;padding:2px 5px!important;gap:2px!important;border-radius:4px!important}' +
      L + '-b .' + NS + '-ic{width:9px!important;height:9px!important}}';
  }
  /** Tipe özel köşe: .ybdg-wrap.ybdg-c-{köşe} tema köşesini ezer (ürün detay çapasında alt köşeler üste alınır). */
  function cornerCss(off) {
    var out = '', anc = (Math.max(parseInt(off, 10) || 0, 6) + 4) + 'px';
    ['top-left', 'top-right', 'bottom-left', 'bottom-right'].forEach(function (c) {
      var p = c.split('-'), v = p[0] === 'top' ? 'bottom' : 'top', h = p[1] === 'left' ? 'right' : 'left';
      out += '.' + NS + '-wrap.' + NS + '-c-' + c + '{' + p[0] + ':' + off + '!important;' + v + ':auto!important;' + p[1] + ':' + off + '!important;' + h + ':auto!important;align-items:' + (p[1] === 'right' ? 'flex-end' : 'flex-start') + '!important}' +
        '.' + NS + '-anc .' + NS + '-wrap.' + NS + '-c-' + c + '{top:' + anc + '!important;bottom:auto!important;' + p[1] + ':' + anc + '!important;' + h + ':auto!important}';
    });
    return out;
  }
  /** Gösterişli kampanya etiketi (design=spotlight): koyu zemin + büyük ilk kelime + renkli şerit, hafif eğim, parıltı ve nabız. */
  function spotCss(T) {
    var f = (T.font ? T.font + ',' : '') + 'inherit';
    return '' +
      '.' + NS + '-sp{all:unset;box-sizing:border-box!important;position:relative!important;display:inline-flex!important;flex-direction:column!important;align-items:stretch!important;text-align:center!important;overflow:hidden!important;border-radius:9px!important;background:#0b0b0c!important;color:#fff!important;font-family:' + f + '!important;transform:rotate(-5deg)!important;transform-origin:center!important;box-shadow:0 0 0 2px var(--ybc),0 6px 16px rgba(0,0,0,.32)!important;margin:6px 4px!important;animation:' + NS + '-pulse 2.6s ease-in-out infinite!important}' +
      '.' + NS + '-sp-t{display:block!important;font-weight:900!important;font-size:21px!important;line-height:1!important;letter-spacing:-.02em!important;padding:6px 11px 5px!important;white-space:nowrap!important}' +
      '.' + NS + '-sp-s{display:flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;background:var(--ybc)!important;color:var(--ybi)!important;font-weight:900!important;font-size:12.5px!important;line-height:1!important;letter-spacing:.05em!important;text-transform:uppercase!important;padding:5px 10px!important;white-space:nowrap!important;-webkit-font-smoothing:antialiased!important}' +
      '.' + NS + '-sp-s .' + NS + '-ic{width:15px!important;height:15px!important;flex:none!important;stroke-width:2.8!important}' +
      '.' + NS + '-sp:after{content:""!important;position:absolute!important;top:-20%!important;left:-70%!important;width:45%!important;height:140%!important;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.5),rgba(255,255,255,0))!important;transform:skewX(-18deg)!important;animation:' + NS + '-shine 3.2s ease-in-out infinite!important;pointer-events:none!important}' +
      '@keyframes ' + NS + '-shine{0%,55%{left:-70%}100%{left:140%}}' +
      '@keyframes ' + NS + '-pulse{0%,100%{transform:rotate(-5deg) scale(1)}50%{transform:rotate(-5deg) scale(1.06)}}' +
      '.' + NS + '-anc .' + NS + '-sp-t{font-size:27px!important;padding:7px 14px 6px!important}' +
      '.' + NS + '-anc .' + NS + '-sp-s{font-size:14px!important;padding:6px 12px!important}.' + NS + '-anc .' + NS + '-sp-s .' + NS + '-ic{width:17px!important;height:17px!important}' +
      '.' + NS + '-pdp .' + NS + '-sp{transform:none!important;animation:none!important;margin:0!important}' +
      '@media (max-width:599px){.' + NS + '-sp-t{font-size:17px!important;padding:5px 8px 4px!important}.' + NS + '-sp-s{font-size:11px!important;letter-spacing:.04em!important;padding:4px 8px!important}.' + NS + '-sp-s .' + NS + '-ic{width:13px!important;height:13px!important}' +
        '.' + NS + '-anc .' + NS + '-sp-t{font-size:23px!important;padding:6px 12px 5px!important}.' + NS + '-anc .' + NS + '-sp-s{font-size:12.5px!important;padding:5px 10px!important}.' + NS + '-anc .' + NS + '-sp-s .' + NS + '-ic{width:15px!important;height:15px!important}}' +
      '@media (prefers-reduced-motion:reduce){.' + NS + '-sp{animation:none!important}.' + NS + '-sp:after{display:none!important}}';
  }
  function badgeStyle(t) {
    var st = C.theme.style, c = t.color;
    if (st === 'soft') return 'background:' + rgba(c, .12) + '!important;color:' + darken(c, .78) + '!important;box-shadow:none!important';
    if (st === 'outline') return 'background:#fff!important;color:' + darken(c, .85) + '!important;border:1.5px solid ' + c + '!important';
    if (st === 'glass') return 'background:rgba(255,255,255,.88)!important;color:' + darken(c, .85) + '!important;backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important';
    return 'background:' + c + '!important;color:' + inkOn(c) + '!important';
  }
  function label(t, val) {
    var s = t.label, parts = String(val == null ? '' : val).split('|');
    return s.replace(/\{n\}/g, fmt(parts[0])).replace(/\{rate\}/g, parts[0]).replace(/\{count\}/g, fmt(parts[1] || '')).replace(/\{price\}/g, parts[0]);
  }
  /** design=bar: fiyat/etiket altında tam genişlik şerit — "SEPETTE 474,95 TL" (ilk kelime küçük etiket, kalanı büyük) */
  function barHtml(t, val, ctx) {
    if (/\{price\}/.test(t.label) && !val) return ''; // sepet fiyatı yoksa bar basma ("{price}" görünmesin)
    var txt = label(t, val).trim(), k = txt.indexOf(' '), head = k < 0 ? '' : txt.slice(0, k), body = k < 0 ? txt : txt.slice(k + 1);
    return '<div class="' + NS + '-bar' + (ctx === 'pdp' ? ' ' + NS + '-bar-pdp' : '') + '" data-ybdg-type="' + esc(t.id) + '" style="--ybc:' + t.color + ';--ybi:' + inkOn(t.color) + '">' + icon(t.icon, ctx === 'pdp' ? 16 : 13) +
      (head ? '<small>' + esc(head) + '</small>' : '') + '<b>' + esc(body) + '</b></div>';
  }
  function barCss(T) {
    var f = (T.font ? T.font + ',' : '') + 'inherit';
    return '.' + NS + '-bar{all:unset;box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;width:100%!important;max-width:100%!important;margin:6px 0 4px!important;padding:6px 8px!important;border-radius:7px!important;background:var(--ybc)!important;color:var(--ybi)!important;font-family:' + f + '!important;font-weight:900!important;font-size:14px!important;line-height:1.1!important;letter-spacing:.2px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;box-shadow:0 2px 8px rgba(0,0,0,.18)!important}' +
      '.' + NS + '-bar small{font-size:10px!important;font-weight:800!important;letter-spacing:.8px!important;text-transform:uppercase!important;opacity:.92!important;padding:2px 5px!important;border-radius:4px!important;background:rgba(255,255,255,.18)!important}' +
      '.' + NS + '-bar b{font-weight:900!important;font-size:15px!important}' +
      '.' + NS + '-bar .' + NS + '-ic{width:13px!important;height:13px!important;flex:none!important;stroke-width:2.8!important}' +
      '.' + NS + '-bar-pdp{width:auto!important;display:inline-flex!important;margin:10px 0!important;padding:10px 16px!important;font-size:18px!important;border-radius:9px!important}.' + NS + '-bar-pdp b{font-size:21px!important}.' + NS + '-bar-pdp small{font-size:11.5px!important}.' + NS + '-bar-pdp .' + NS + '-ic{width:16px!important;height:16px!important}' +
      '@media (max-width:599px){.' + NS + '-bar{font-size:12.5px!important;padding:5px 6px!important;gap:4px!important;margin:4px 0 2px!important}.' + NS + '-bar b{font-size:13.5px!important}.' + NS + '-bar small{font-size:9px!important;padding:2px 4px!important}.' + NS + '-bar-pdp{font-size:16px!important;padding:9px 14px!important}.' + NS + '-bar-pdp b{font-size:18px!important}}';
  }
  function badgeHtml(t, val, ctx) {
    if (t.design === 'spotlight') {
      // "10/10 İNDİRİMİ" → büyük "10/10" + şeritte "İNDİRİMİ"; "|" varsa oradan bölünür
      var txt = label(t, val), k = txt.indexOf('|'), top, sub;
      if (k < 0) { k = txt.indexOf(' '); top = k < 0 ? txt : txt.slice(0, k); sub = k < 0 ? '' : txt.slice(k + 1); }
      else { top = txt.slice(0, k); sub = txt.slice(k + 1); }
      return '<span class="' + NS + '-sp" data-ybdg-type="' + esc(t.id) + '" style="--ybc:' + t.color + ';--ybi:' + inkOn(t.color) + '"><span class="' + NS + '-sp-t">' + esc(top.trim()) + '</span>' +
        (sub.trim() ? '<span class="' + NS + '-sp-s">' + icon(t.icon, 10) + '<span>' + esc(sub.trim()) + '</span></span>' : '') + '</span>';
    }
    var sz = { s: 10, m: 11, l: 13 }[C.theme.size] || 11;
    return '<span class="' + NS + '-b" data-ybdg-type="' + esc(t.id) + '" style="' + badgeStyle(t) + '">' + icon(t.icon, ctx === 'pdp' ? sz + 2 : sz) + '<span>' + esc(label(t, val)) + '</span></span>';
  }
  /** Tipin köşesi: kendi köşesi yoksa tema köşesi */
  function cornerOf(t) { return t.corner || C.theme.list_position || 'top-left'; }
  /** pid → [{t, val}] (öncelik sırası, bağlama göre filtreli; max her köşe için ayrı sayılır) */
  function badgesFor(pid, ctx) {
    var list = (C.b && C.b[pid]) || [], out = [], used = {}, max = ctx === 'pdp' ? C.rules.pdp_max : C.rules.list_max;
    for (var i = 0; i < list.length; i++) {
      var k = String(list[i]), j = k.indexOf(':'), id = j < 0 ? k : k.slice(0, j), t = TYPES[id];
      if (!t || (ctx === 'pdp' ? !t.pdp : !t.list)) continue;
      if (t.design !== 'bar') { var c = cornerOf(t); if ((used[c] || 0) >= max) continue; used[c] = (used[c] || 0) + 1; }
      out.push({ t: t, val: j < 0 ? null : k.slice(j + 1) });
    }
    return out;
  }
  /** Rozetleri köşelerine göre ayrı .ybdg-wrap kutularına dizer (tema köşesi sınıfsız, diğerleri .ybdg-c-*) */
  function wrapsHtml(bs, ctx, extra) {
    var groups = {}, order = [];
    bs.forEach(function (x) { if (x.t.design === 'bar') return; var c = cornerOf(x.t); if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(badgeHtml(x.t, x.val, ctx)); });
    return order.map(function (c) { return '<div class="' + NS + '-wrap' + (extra ? ' ' + extra : '') + (c !== (C.theme.list_position || 'top-left') ? ' ' + NS + '-c-' + c : '') + '">' + groups[c].join('') + '</div>'; }).join('');
  }

  /* ── Liste kartları ── */
  function cardId(card) {
    var el = card.matches && card.matches(C.rules.list_id_selector) ? card : card.querySelector(C.rules.list_id_selector);
    var id = el && (el.getAttribute('data-id') || el.getAttribute('data-product-id'));
    if (!id) id = card.getAttribute('data-product-id') || card.getAttribute('data-id');
    return id ? String(id).trim() : '';
  }
  function decorate(card) {
    if (seenCards ? seenCards.has(card) : card.__ybdg) return;
    var pid = cardId(card);
    if (!pid) return;
    if (seenCards) seenCards.add(card); else card.__ybdg = 1;
    card.setAttribute('data-ybdg-pid', pid);
    var bs = badgesFor(pid, 'list');
    if (bs.length) {
      var host = card.querySelector(C.rules.list_image_selector) || card;
      var old = host.querySelectorAll(':scope > .' + NS + '-wrap'); for (var o = 0; o < old.length; o++) old[o].remove();
      if (getComputedStyle(host).position === 'static') host.classList.add(NS + '-host');
      var tmp = document.createElement('div'); tmp.innerHTML = wrapsHtml(bs, 'list', NS + '-l');
      while (tmp.firstChild) host.appendChild(tmp.firstChild);
      unclash(host);
      var bars = bs.filter(function (x) { return x.t.design === 'bar'; });
      if (bars.length) {
        var oldb = card.querySelectorAll('.' + NS + '-bar'); for (var ob = 0; ob < oldb.length; ob++) oldb[ob].remove();
        var bt = targetIn(card, C.rules.bar_list_mount || 'after:.productPrice');
        if (bt) { var bw = document.createElement('div'); bw.innerHTML = bars.map(function (x) { return barHtml(x.t, x.val, 'list'); }).join(''); while (bw.firstChild) { var bn = bw.firstChild; put(bt, bn); bt = { el: bn, mode: 'after' }; } }
      }
      card.setAttribute('data-ybdg-first', bs[0].t.id);
      card.__ybdgTypes = bs.map(function (x) { return x.t.id; });
    }
    if (io) io.observe(card);
  }
  /** Dar kartta iki köşedeki rozet grupları yatayda çakışırsa sonraki grubu öncekinin altına kaydırır (mobil 2'li liste). */
  function unclash(host) {
    var ws = host.querySelectorAll(':scope > .' + NS + '-wrap'); if (ws.length < 2) return;
    function run() {
      for (var i = 1; i < ws.length; i++) {
        ws[i].style.removeProperty('margin-top'); ws[i].style.removeProperty('margin-bottom');
        var hr = host.getBoundingClientRect(), b = ws[i].getBoundingClientRect(), up = b.top > hr.top + hr.height / 2; // alt köşedeyse yukarı itilir
        for (var j = 0; j < i; j++) {
          var a = ws[j].getBoundingClientRect();
          if (!a.width || !b.width) continue;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            if (up) ws[i].style.setProperty('margin-bottom', Math.ceil(b.bottom - a.top + 4) + 'px', 'important');
            else ws[i].style.setProperty('margin-top', Math.ceil(a.bottom - b.top + 4) + 'px', 'important');
            b = ws[i].getBoundingClientRect();
          }
        }
      }
    }
    run(); setTimeout(run, 600);
    if (!unclash.bound) { unclash.bound = 1; window.addEventListener('resize', function () { clearTimeout(unclash.t); unclash.t = setTimeout(function () { var h = document.querySelectorAll('[data-ybdg-pid]'); for (var k = 0; k < h.length; k++) { var x = h[k].querySelector(C.rules.list_image_selector) || h[k]; unclash(x); } }, 250); }); }
  }
  function scan() {
    if (!C || !C.rules.list_enabled) return;
    var cards = document.querySelectorAll(C.rules.list_card_selector);
    for (var i = 0; i < cards.length; i++) decorate(cards[i]);
  }
  function setupImpressions() {
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        var card = e.target; io.unobserve(card);
        impr.total++;
        if (card.__ybdgTypes) { impr.badged++; card.__ybdgTypes.forEach(function (id) { impr.by[id] = (impr.by[id] || 0) + 1; }); }
        imprDirty = true;
      });
    }, { threshold: 0.5 });
    function flush(beacon) {
      if (!imprDirty || impr.total === 0) return;
      send({ type: 'list_view', counts: impr }, beacon);
      impr = { total: 0, badged: 0, by: {} }; imprDirty = false;
    }
    setInterval(function () { flush(false); }, 20000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
    window.addEventListener('pagehide', function () { flush(true); });
  }
  function setupClicks() {
    document.addEventListener('click', function (ev) {
      var card = ev.target && ev.target.closest && ev.target.closest('[data-ybdg-pid]');
      if (!card || !ev.target.closest('a')) return;
      send({ type: 'click', product_id: card.getAttribute('data-ybdg-pid'), badge: card.getAttribute('data-ybdg-first') || '' }, true);
    }, true);
  }

  /* ── Ürün detay ── */
  function pdpId() {
    try { var m = window.productDetailModel; if (m && m.productId) return String(m.productId); } catch (e) {}
    var d = SCRIPT.getAttribute('data-product-id'); return d ? String(d) : '';
  }
  function target(spec, visibleOnly) {
    var cands = String(spec || '').split(',');
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i].trim(); if (!s) continue;
      var m = s.match(/^(before|after|append|prepend):(.+)$/), mode = m ? m[1] : 'after', sel = (m ? m[2] : s).trim();
      var nodes; try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      var tgt = null;
      for (var j = 0; j < nodes.length; j++) { var r = nodes[j].getBoundingClientRect(); if (r.width > 40 && r.height > 40 || (!visibleOnly && (nodes[j].offsetParent !== null || nodes[j].getClientRects().length))) { tgt = nodes[j]; break; } }
      if (!tgt && !visibleOnly) tgt = nodes[0];
      if (tgt) return { el: tgt, mode: mode };
    }
    return null;
  }
  function targetIn(scope, spec) {
    var cands = String(spec || '').split(',');
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i].trim(); if (!s) continue;
      var m = s.match(/^(before|after|append|prepend):(.+)$/), mode = m ? m[1] : 'after', sel = (m ? m[2] : s).trim();
      var el; try { el = scope.querySelector(sel); } catch (e) { continue; }
      if (el) return { el: el, mode: mode };
    }
    return null;
  }
  function put(t, el) {
    if (t.mode === 'before') t.el.parentNode.insertBefore(el, t.el);
    else if (t.mode === 'append') t.el.appendChild(el);
    else if (t.mode === 'prepend') t.el.insertBefore(el, t.el.firstChild);
    else t.el.parentNode.insertBefore(el, t.el.nextSibling);
  }
  function mount(spec, el) { var t = target(spec, false); if (!t) return false; put(t, el); return true; }
  /** Görsel üstü rozet çapası: galeri (Yunbi/tema) sonradan çizilir veya değişirse görünür görselin önüne taşınır. */
  function placeImageAnchor() {
    var anc = document.querySelector('.' + NS + '-anc'); if (!anc) return;
    var t = target(C.rules.pdp_image_mount, true);
    if (t) {
      var ok = t.mode === 'before' ? anc.nextElementSibling === t.el : t.mode === 'prepend' ? anc.parentNode === t.el && anc === t.el.firstElementChild : anc.previousElementSibling === t.el;
      if (!ok) put(t, anc);
    }
    var mb = mobileBottom();
    if (!!anc.__mb !== mb) { renderPdp(); return; } // mobil↔masaüstü geçişinde dizilim değişir (mobilde tek köşe)
    if (pdpOnImage(anc, t && t.el, mb) && mb) return;
    avoidFixedTop(anc);
  }
  function def0() { return C.theme.list_position || 'top-left'; }
  function mobileBottom() { return !!(C.theme.mobile_bottom && window.matchMedia && window.matchMedia('(max-width:599px)').matches); }
  /** Ana görselin (shadow DOM galeri dahil) ekrandaki kutusu: içindeki en büyük görünür img/video, yoksa öğenin kendisi */
  function mainImageRect(el) {
    var best = null, area = 0;
    function walk(root, depth) {
      var ms = root.querySelectorAll('img,video,picture');
      for (var i = 0; i < ms.length; i++) { var r = ms[i].getBoundingClientRect(); if (r.width < 80 || r.height < 80 || r.right < 0 || r.left > (window.innerWidth || 400)) continue; if (r.width * r.height > area) { area = r.width * r.height; best = r; } }
      if (depth < 2) { var all = root.querySelectorAll('*'); for (var j = 0; j < all.length && j < 3000; j++) if (all[j].shadowRoot) walk(all[j].shadowRoot, depth + 1); }
    }
    if (el.shadowRoot) walk(el.shadowRoot, 1);
    walk(el, 0);
    return best;
  }
  /** Ürün detay rozetlerini sütuna değil GÖRSELİN KENDİSİNE göre konumlar (çapa yüksekliği 0, görselin önünde):
   *  masaüstü → görselin üst köşeleri (sütunun boş beyazına/ürün adının yanına kaymaz), mobil+mobile_bottom → görselin sol altı. */
  function pdpOnImage(anc, el, bottom) {
    var g = el || anc.nextElementSibling; if (!g) return false;
    var ir = mainImageRect(g); if (!ir) return false;
    var ar = anc.getBoundingClientRect(), off = Math.max(+C.theme.list_offset || 0, 6) + 4, ws = anc.querySelectorAll('.' + NS + '-wrap'), def = C.theme.list_position || 'top-left';
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i], m = w.className.match(new RegExp(NS + '-c-([a-z]+-[a-z]+)')), right = (m ? m[1] : def).indexOf('right') > 0;
      w.style.removeProperty('margin-top'); w.style.removeProperty('top'); w.style.removeProperty('left');
      var wr = w.getBoundingClientRect();
      w.style.setProperty('top', Math.round(bottom ? ir.bottom - ar.top - wr.height - off : ir.top - ar.top + off) + 'px', 'important');
      w.style.setProperty('bottom', 'auto', 'important');
      w.style.setProperty('left', Math.round(right ? ir.right - ar.left - wr.width - off : ir.left - ar.left + off) + 'px', 'important');
      w.style.setProperty('right', 'auto', 'important');
    }
    return true;
  }
  /** Mobilde sayfanın üstüne SABİT (position:fixed) duran menü/duyuru çubuğu, sayfa en üstteyken görselin üst kısmını
   *  örtüyorsa rozeti onun altına kaydırır (yalnız ilk görünüm için; kaydırınca sabit menünün altında kalması doğaldır). */
  function avoidFixedTop(anc) {
    var ws = anc.querySelectorAll('.' + NS + '-wrap'); if (!ws.length || !document.elementsFromPoint) return;
    if (ws.length > 1) { for (var q = 0; q < ws.length; q++) avoidFixedTopWrap(anc, ws[q]); return; }
    avoidFixedTopWrap(anc, ws[0]);
  }
  function avoidFixedTopWrap(anc, w) {
    w.style.removeProperty('margin-top');
    var r = w.getBoundingClientRect(), docTop = r.top + (window.pageYOffset || 0), vh = window.innerHeight || 800, bottom = 0, seen = [];
    var x = Math.max(2, Math.min(r.left + 10, (window.innerWidth || 400) - 2));
    for (var y = 1; y < Math.min(220, vh / 2); y += 10) {
      var els = document.elementsFromPoint(x, y);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (seen.indexOf(el) >= 0 || anc.contains(el) || el === document.body || el === document.documentElement) continue;
        seen.push(el);
        for (var a = el; a && a !== document.body; a = a.parentElement) {
          var cs = getComputedStyle(a);
          if (cs.position === 'fixed') {
            var ar = a.getBoundingClientRect();
            if (ar.top <= 4 && ar.height < vh * 0.4 && ar.width > (window.innerWidth || 400) * 0.5 && cs.visibility !== 'hidden' && +cs.opacity !== 0) bottom = Math.max(bottom, ar.bottom);
            break;
          }
        }
      }
    }
    if (bottom > 0 && docTop < bottom + 6) w.style.setProperty('margin-top', Math.ceil(bottom + 8 - docTop) + 'px', 'important');
    log('fixed üst', bottom, 'rozet', docTop);
  }
  /** Kutunun üst ve alt boşluğunu eşitler: komşuların kendi boşlukları (margin) ölçülür, ikisi de en büyüğüne çekilir
   *  (dikey margin'ler birleştiği için kutuya aynı değeri vermek görünür boşluğu eşitler). Sabit/mutlak komşular yok sayılır. */
  /** Kutunun üst ve alt boşluğunu eşitler. Ölçü GÖRÜNEN içeriğe göre: yazı/görsel yaprakları ve çerçeveli/zeminli kutular
   *  (kapsayıcı div'lerin iç boşlukları göz için boşluktur). Boşluk padding ile verilir: Ticimax masaüstünde blokları float
   *  yapar, margin "clearance" içinde yutulur ya da komşununkiyle toplanır. Sabit/mutlak öğeler (alt "Sepete Ekle" çubuğu) yok sayılır. */
  function balance(el) {
    if (!el.isConnected) return;
    // Yunbi kargo kutusu ("X dk içinde sipariş verirsen yarın kargoda") da Sepete Ekle'nin önüne girer; sıra: kanıt → kargo → Sepete Ekle
    var sib = el.previousElementSibling; if (sib && sib.id === 'yunbi-shipping-badge') el.parentNode.insertBefore(sib, el.nextSibling);
    var card = el.firstElementChild || el;
    function visible(n) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
      for (var a = n; a && a !== document.body; a = a.parentElement) { if (a.contains(el)) break; if (getComputedStyle(a).position === 'fixed') return null; } // ortak (örn. sticky sağ sütun) kapsayıcıdan yukarısı sayılmaz
      return cs;
    }
    /** Öğenin GÖZE görünen dikey kapsamı [üst, alt] ya da null: yazı/görsel yaprakları tam kutu; çerçeveli kutularda yalnız
     *  çizili kenar (yalnız üst çizgisi olan kutunun alt kenarı görünmez); zemin rengi yalnız küçük kutularda. */
    function painted(n, cs, r) {
      if (/^(IMG|SVG|INPUT|BUTTON|SELECT|TEXTAREA|VIDEO|CANVAS|IFRAME)$/i.test(n.tagName) || n.shadowRoot) return [r.top, r.bottom]; // shadow DOM widget'ı (örn. Yunbi kargo kutusu) içi taranamaz → kutusu dolu sayılır
      for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) return [r.top, r.bottom]; // doğrudan metni olan öğe (ikon+yazı span'ları dahil)
      var bg = (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent|rgb\(255, 255, 255\)/.test(cs.backgroundColor)) || cs.backgroundImage !== 'none';
      if (bg && r.height < 160) return [r.top, r.bottom];
      var bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0, bl = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
      if (bl > 0 && (bt > 0 || bb > 0)) return [r.top, r.bottom];
      if (bt > 0 && bb > 0) return [r.top, r.bottom];
      if (bt > 0) return [r.top, r.top + bt];
      if (bb > 0) return [r.bottom - bb, r.bottom];
      return null;
    }
    el.style.setProperty('padding-top', '0px', 'important'); el.style.setProperty('padding-bottom', '0px', 'important'); el.style.removeProperty('margin-bottom');
    var aEl = null, bEl = null, b = card.getBoundingClientRect(), above = null, below = null, all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length && i < 20000; i++) {
      var n = all[i];
      var r = n.getBoundingClientRect(); if (r.height <= 0 || r.width <= 0) continue;
      if (r.right < b.left - 2 || r.left > b.right + 2) continue; // yalnız aynı dikey sütundakiler
      if (r.bottom < b.top - 160 || r.top > b.bottom + 160) continue;
      if (el.contains(n) || n.contains(el)) continue;
      var cs = visible(n), v = cs && painted(n, cs, r); if (!v) continue;
      if (v[1] <= b.top + 1 && (above === null || v[1] > above)) { above = v[1]; aEl = n; }
      if (v[0] >= b.bottom - 1 && (below === null || v[0] < below)) { below = v[0]; bEl = n; }
    }
    var up = above === null ? 0 : Math.max(0, b.top - above), down = below === null ? 0 : Math.max(0, below - b.bottom);
    var g = Math.round(Math.max(16, up <= 48 ? up : 0)); // üst boşluk esas; alt fazlası aşağıda yukarı çekilir
    el.style.setProperty('padding-top', Math.max(0, g - up) + 'px', 'important');
    el.style.setProperty('padding-bottom', Math.max(0, g - down) + 'px', 'important');
    // Alttaki içerik temanın kendi boşluğuyla daha uzaktaysa (örn. sonraki bölümün üst dolgusu) onu yukarı çek → üst = alt
    if (below !== null && down > g) el.style.setProperty('margin-bottom', -Math.min(64, Math.round(down - g)) + 'px', 'important');
    log('boşluk', 'üst', Math.round(up), aEl && (aEl.className || aEl.tagName), 'alt', Math.round(down), bEl && (bEl.className || bEl.tagName), '→', g);
  }
  /** Aşağı yuvarlama: 237 → "200+", 1.143 → "1.100+" (gösterilen sayı hiçbir zaman gerçeği aşmaz). 20 altı aynen. */
  function roundDown(n) {
    n = +n || 0;
    if (!C.rules.proof_round || n < 20) return fmt(n);
    var step = n < 100 ? 10 : n < 1000 ? 50 : n < 10000 ? 100 : 1000, r = Math.floor(n / step) * step;
    return r === n ? fmt(n) : fmt(r) + '+';
  }
  function proofLines(pid) {
    var R = C.rules, p = (C.p && C.p[pid]) || {}, out = [], max = +R.proof_max_lines || 3;
    function line(ic, color, html) { if (out.length < max) out.push('<div class="' + NS + '-pl"><span class="' + NS + '-pi" style="background:' + rgba(color, .12) + ';color:' + color + '">' + icon(ic, 13) + '</span><span>' + html + '</span></div>'); }
    function num(tpl, n) { return esc(tpl).replace('{n}', '<b>' + roundDown(n) + '</b>'); }
    // 1) Kategori sırası
    if (R.proof_rank && p.rk) line('trophy', '#ca8a04', esc(R.proof_rank_text).replace('{category}', '<b>' + esc(p.rk.c) + '</b>').replace('{rank}', '<b>' + p.rk.r + '</b>').replace('#<b>', '<b>#'));
    // 2) Satış — ürün başına en güçlü gerçek pencere
    if (R.proof_sold_24h && p.s24) line('bag', '#ea580c', num(R.proof_sold_24h_text, p.s24));
    else if (R.proof_sold_7d && p.s7) line('bag', '#ea580c', num(R.proof_sold_7d_text, p.s7));
    else if (R.proof_sold_30d && p.s30) line('bag', '#ea580c', num(R.proof_sold_30d_text, p.s30));
    // 2b) Sepetinde (ödemesi tamamlanmamış gerçek denemeler, son 24 saat)
    if (R.proof_cart && p.ct) line('cart', '#7c3aed', num(R.proof_cart_text, p.ct));
    // 3) Favori
    if (R.proof_fav && p.fv) line('heart', '#e11d48', num(R.proof_fav_text, p.fv));
    // 4) Azalan bedenler (aciliyet; gerçek stok)
    if (R.proof_sizes && p.sz && p.sz.length) line('hourglass', '#c2410c', esc(R.proof_sizes_text).replace('{sizes}', '<b>' + esc(p.sz.join(', ')) + '</b>'));
    // 5) Sepete ekleme, 6) inceleme
    if (R.proof_atc && p.a7) line('bag', '#059669', num(R.proof_atc_text, p.a7));
    if (R.proof_views && p.v7) line('eye', '#2563eb', num(R.proof_views_text, p.v7));
    return out;
  }
  function renderPdp() {
    if (!C.rules.pdp_enabled) return;
    var pid = pdpId();
    if (!pid) return;
    var old = document.querySelectorAll('.' + NS + '-pdp,.' + NS + '-proof,.' + NS + '-anc');
    for (var i = 0; i < old.length; i++) old[i].remove();
    var bsAll = badgesFor(pid, 'pdp'), bs = bsAll.filter(function (x) { return x.t.design !== 'bar'; }), pbars = bsAll.filter(function (x) { return x.t.design === 'bar'; });
    var oldBars = document.querySelectorAll('.' + NS + '-bar-pdp'); for (var ob = 0; ob < oldBars.length; ob++) oldBars[ob].remove();
    if (pbars.length) {
      var bwrap = document.createElement('div'); bwrap.className = NS + '-pdp';
      bwrap.innerHTML = pbars.map(function (x) { return barHtml(x.t, x.val, 'pdp'); }).join('');
      mount(C.rules.bar_pdp_mount || 'after:#pnlFiyatlar', bwrap);
    }
    if (bs.length) {
      var where = C.rules.pdp_badge_position || 'image', html = bs.map(function (x) { return badgeHtml(x.t, x.val, where === 'image' ? 'list' : 'pdp'); }).join('');
      var w = document.createElement('div');
      if (where === 'image') {
        // Ürün detayda hepsi görselin SOL kenarında tek sütun (gösterişli rozet: mobilde en üstte, masaüstünde en altta): sağ kenar masaüstünde ürün adına
        // bitişik, mobilde sağ altta galerinin "1/5" sayacı var. Masaüstü sol üst, mobil (mobile_bottom) sol alt.
        var mb = mobileBottom();
        w.className = NS + '-anc'; w.__mb = mb;
        w.innerHTML = '<div class="' + NS + '-wrap' + (def0() !== 'top-left' ? ' ' + NS + '-c-top-left' : '') + '">' + bs.slice().sort(function (a, b) { var d = (a.t.design === 'spotlight' ? 0 : 1) - (b.t.design === 'spotlight' ? 0 : 1); return mb ? d : -d; }).map(function (x) { return badgeHtml(x.t, x.val, 'list'); }).join('') + '</div>';
        var t = target(C.rules.pdp_image_mount, true) || target(C.rules.pdp_image_mount, false);
        if (t) put(t, w); else { w.className = NS + '-pdp'; w.innerHTML = html; mount(C.rules.pdp_badge_mount, w); }
      } else {
        w.className = NS + '-pdp'; w.innerHTML = html;
        mount(where === 'price' ? C.rules.pdp_price_mount : C.rules.pdp_badge_mount, w);
      }
    }
    var lines = C.rules.proof_enabled ? proofLines(pid) : [];
    if (lines.length) {
      var pr = document.createElement('div'); pr.className = NS + '-proof'; pr.innerHTML = '<div class="' + NS + '-pcard">' + lines.join('') + '</div>';
      if (mount(C.rules.pdp_proof_mount, pr)) {
        balance(pr); setTimeout(function () { balance(pr); }, 1500); setTimeout(function () { balance(pr); }, 4000);
        // Komşu widget (kargo kutusu vb.) sonradan eklenirse boşluğu yeniden ölç (ilk 15 sn)
        if ('MutationObserver' in window && pr.parentNode) {
          var mo = new MutationObserver(function () { clearTimeout(mo.t); mo.t = setTimeout(function () { balance(pr); }, 150); });
          mo.observe(pr.parentNode, { childList: true }); setTimeout(function () { mo.disconnect(); }, 15000);
        }
      }
    }
    if (!renderPdp.sent) { renderPdp.sent = 1; send({ type: 'pdp_view', product_id: pid, badge: bs.length ? bs[0].t.id : '' }); }
    log('pdp', pid, bs.length, lines.length);
  }

  /* ── Başlat ── */
  function hidden() {
    var hp = String(C.rules.hide_paths || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean), p = location.pathname.toLowerCase();
    for (var i = 0; i < hp.length; i++) if (p.indexOf(hp[i]) === 0) return true;
    return false;
  }
  function start(cfg) {
    C = cfg;
    if (!C || !C.enabled) { log('kapalı'); return; }
    C.rules = C.rules || {}; C.theme = C.theme || {};
    (C.types || []).forEach(function (t) { TYPES[t.id] = t; });
    if (hidden()) return;
    var st = document.createElement('style'); st.id = NS + '-css'; st.textContent = css(); (document.head || document.documentElement).appendChild(st);
    setupImpressions(); setupClicks();
    scan(); renderPdp(); setTimeout(placeImageAnchor, 300); setTimeout(placeImageAnchor, 1500); setTimeout(placeImageAnchor, 4000); setTimeout(placeImageAnchor, 8000); window.addEventListener('load', function () { setTimeout(placeImageAnchor, 100); }); window.addEventListener('resize', function () { setTimeout(placeImageAnchor, 200); });
    var q = false;
    new MutationObserver(function () {
      if (q) return; q = true;
      (window.requestAnimationFrame || setTimeout)(function () { q = false; scan(); if (!document.querySelector('.' + NS + '-pdp,.' + NS + '-proof,.' + NS + '-anc') && pdpId()) renderPdp(); else placeImageAnchor(); });
    }).observe(document.body, { childList: true, subtree: true });
    log('hazır', Object.keys(C.b || {}).length, 'rozetli kart');
  }
  window.YunbiBadges = {
    refresh: function () { if (!C) return; var w = document.querySelectorAll('.' + NS + '-wrap'); for (var i = 0; i < w.length; i++) w[i].remove(); seenCards = typeof WeakSet !== 'undefined' ? new WeakSet() : null; var c = document.querySelectorAll('[data-ybdg-pid]'); for (var j = 0; j < c.length; j++) { c[j].__ybdg = 0; c[j].removeAttribute('data-ybdg-pid'); } var s = document.getElementById(NS + '-css'); if (s) s.textContent = css(); scan(); renderPdp(); },
    config: function () { return C; },
    _start: start
  };

  function boot() {
    if (window.__yunbiBadgeConfig) return start(window.__yunbiBadgeConfig); // demo/önizleme enjeksiyonu
    var KEY = 'yunbi_badge_' + SLUG, cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!DEMO && cached && cached.at && Date.now() - cached.at < 5 * 60 * 1000 && cached.cfg) return start(cached.cfg);
    fetch(API + '/config', { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      if (!cfg) return;
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), cfg: cfg })); } catch (e) {}
      start(cfg);
    }).catch(function (e) { log('config hatası', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
