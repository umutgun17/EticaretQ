(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi Akıllı Menü (CRO) — görselli, dinamik ve kişiye göre sıralanan mobil menü.
     Segment sekmeleri (Kadın/Erkek/Çocuk) → ürün görselli kategori kartları; sıra = satış hızı × sezon
     eğrisi × cihazda gezilen kategoriler; sanal kategoriler (Çok satanlar, 299–399 TL…); popüler / kişisel ürün satırı.
     Temanın hamburger menüsünü ve Yunbi Mobil Alt Bar'ın "Kategoriler" sekmesini yakalar.
     Kurulum (bottombar.js'ten bağımsız): <script src="https://eticaretq.com/widget/menu.js?v=12" data-tenant="tonnyblack"></script>
     v12: sanal kategoride segment başına hedef (v.urls[seg.url]) — kampanya + Ticimax native cinsiyet filtresi.
     Demo öznitelikleri: data-force="1" (masaüstünde de + tıklamalar sayfa açmaz), data-open="1", data-preset, data-theme (JSON),
     data-profile (JSON cihaz profili), data-inline="1" (fixed yerine belge akışında, galeri iframe'i için)
     Teşhis: sayfa adresine ?yunbi_debug=1 ekle → ekranda durum kutusu (konsolsuz telefonda); hatalar 'error' olayıyla panele düşer.
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiMenuLoaded) return;
  window.__yunbiMenuLoaded = true;

  var API = SCRIPT.src.replace(/\/widget\/menu\.js.*$/, '/w/' + TENANT + '/menu');
  var FORCE = SCRIPT.getAttribute('data-force') === '1';
  var AUTO_OPEN = SCRIPT.getAttribute('data-open') === '1';
  var INLINE = SCRIPT.getAttribute('data-inline') === '1';
  var FORCE_PRESET = (SCRIPT.getAttribute('data-preset') || '').toLowerCase();
  var FORCE_THEME = null, FORCE_PROFILE = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { }
  try { FORCE_PROFILE = SCRIPT.getAttribute('data-profile') ? JSON.parse(SCRIPT.getAttribute('data-profile')) : null; } catch (e) { }
  var URL_DEBUG = /[?&]yunbi_debug=1/.test(location.search);
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1' || URL_DEBUG;
  var dbgBox = null;
  function dbg() {
    var args = [].slice.call(arguments);
    if (DEBUG && window.console) console.log.apply(console, ['[YunbiMenu]'].concat(args));
    if (!URL_DEBUG) return;
    try {
      if (!dbgBox) { dbgBox = document.createElement('div'); dbgBox.id = 'yunbi-menu-dbg'; dbgBox.style.cssText = 'position:fixed;left:8px;right:8px;bottom:70px;z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;font:11px/1.4 monospace;padding:8px 10px;border-radius:8px;max-height:40vh;overflow:auto;pointer-events:none;white-space:pre-wrap'; dbgBox.textContent = 'YunbiMenu v11 · ' + innerWidth + 'px · ' + (navigator.userAgent.match(/iPhone|iPad|Android|Windows|Macintosh/) || ['?'])[0] + '\n'; (document.body || document.documentElement).appendChild(dbgBox); }
      dbgBox.textContent += new Date().toTimeString().slice(0, 8) + ' ' + args.map(function (a) { return typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a); }).join(' ') + '\n';
    } catch (e) { }
  }
  function report(stage, err) {
    var msg = stage + ': ' + (err && err.message ? err.message : String(err || ''));
    dbg('HATA', msg);
    try { var body = JSON.stringify({ type: 'error', sid: SID, path: location.pathname, source: stage.slice(0, 24), value: (msg + ' | ' + innerWidth + 'px | ' + navigator.userAgent).slice(0, 200) }); if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' })); else fetch(API + '/event', { method: 'POST', body: body, keepalive: true }); } catch (e) { }
  }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var cfg = null, host = null, root = null, isOpen = false, tab = null, clickedSinceOpen = false, personal = null, personalData = null, personalTried = false, moreOpen = {}, tabsFrozen = null, whyFrozen = '';

  /* ═══ cihaz profili (kişiselleştirme; yalnız bu cihazda) ═══ */
  var PKEY = 'yunbi_menu_p';
  function loadProfile() {
    if (FORCE_PROFILE) return Object.assign({ tab: '', cats: {}, recent: [], products: [] }, FORCE_PROFILE);
    try { var p = JSON.parse(localStorage.getItem(PKEY) || '{}'); return { tab: p.tab || '', cats: p.cats || {}, recent: p.recent || [], products: p.products || [] }; } catch (e) { return { tab: '', cats: {}, recent: [], products: [] }; }
  }
  function saveProfile(p) { if (FORCE_PROFILE) return; try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { } }
  var profile = loadProfile();

  /* Ürün sayfası fiyatı: Ticimax #fiyat = liste, #indirimliFiyat = satış. Eski seçici ilk eşleşen "Fiyat" etiketini (lineTitle) alıyordu. */
  function priceText(sel) { var e = qs(sel); var t = e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; return /\d/.test(t) ? t : ''; }
  function productPrice() {
    var out = { price: '', old: '' };
    try {
      var list = priceText('#fiyat .spanFiyat'), sale = priceText('#indirimliFiyat .spanFiyat');
      var num = function (t) { return Number(String(t).replace(/[^\d,]/g, '').replace(',', '.')) || 0; };
      if (sale && list && num(sale) < num(list)) { out.price = sale; out.old = list; }
      else out.price = sale || list || priceText('.productPrice .discountPriceSpan') || priceText('.productPrice .price');
      if (!out.price) { var ld = [].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).map(function (x) { var m = x.textContent.match(/"price"\s*:\s*"?([\d.]+)/); return m ? m[1] : ''; }).filter(Boolean)[0]; if (ld) out.price = money(ld); }
    } catch (e) { }
    return out;
  }
  /* Ürün sayfası: son bakılan ürünler (og etiketlerinden; girişsiz ziyaretçiye "Son baktığın ürünler" satırı) */
  function trackProductView() {
    try {
      var isProd = !!(window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage'));
      if (!isProd) return;
      var og = function (n) { var m = qs('meta[property="' + n + '"]'); return m ? m.getAttribute('content') : ''; };
      var name = og('og:title') || document.title, img = og('og:image'), url = location.pathname;
      if (!name || !img) return;
      var pr = productPrice();
      profile.products = [{ url: url, name: name.split('|')[0].trim(), img: img, price: pr.price, old: pr.old, ts: Date.now() }].concat((profile.products || []).filter(function (r) { return r.url !== url; })).slice(0, 8);
      // ürünün segmentini de hatırla (kategori sayfasına uğramadan gelen reklam trafiği)
      var seg = ''; (cfg.segments || []).forEach(function (s) { if (!seg && new RegExp('(^|[^a-z])' + s.name.toLowerCase().replace(/[^a-zçğıöşü]/g, '') + '([^a-z]|$)', 'i').test((url + ' ' + name).toLowerCase())) seg = s.url; });
      if (seg && !profile.tab) profile.tab = seg;
      saveProfile(profile);
    } catch (e) { }
  }
  /* Sayfa ziyareti: bulunulan yol bir kategori ise sayacı artır, "kaldığın yer"e yaz, segmenti hatırla */
  function trackVisit() {
    if (FORCE) return;
    trackProductView();
    var p = location.pathname.toLowerCase().replace(/\/$/, '');
    if (!p) return;
    var hit = null, segUrl = '';
    (cfg.segments || []).forEach(function (s) {
      if (s.url.toLowerCase() === p) segUrl = s.url;
      (s.tiles || []).forEach(function (t) { if (t.url.toLowerCase() === p) { hit = t; segUrl = s.url; } });
    });
    if (!hit && !segUrl) return;
    if (hit) {
      profile.cats[hit.url] = (profile.cats[hit.url] || 0) + 1;
      profile.recent = [{ url: hit.url, label: hit.label, seg: segUrl, ts: Date.now() }].concat((profile.recent || []).filter(function (r) { return r.url !== hit.url; })).slice(0, 5);
    }
    profile.tab = segUrl;
    saveProfile(profile);
  }

  /* ═══ yardımcılar ═══ */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function abs(u) { if (!u) return '#'; if (/^https?:\/\//i.test(u)) return u; var shop = cfg.shop_url || ''; return shop && u.charAt(0) === '/' ? shop + u : u; }
  /* Ürün adı: sondaki stok kodu (TBTYLDZ005, V2QNT-0…) atılır; uzunsa SONDAN kelime sınırında alınır
     ("…Bağcıklı Sneaker Kadın Bej Kahve Sneaker" → tür + cinsiyet + renk kalır, özellik listesi düşer) */
  function shortName(n, max) {
    n = String(n || '').replace(/\s+/g, ' ').trim();
    n = n.replace(/(\s+[A-Z0-9][A-Z0-9-]{4,})+$/g, '').trim();
    max = max || 34;
    if (n.length <= max) return n;
    var words = n.split(' '), out = '';
    for (var i = words.length - 1; i >= 0; i--) { var cand = words[i] + (out ? ' ' + out : ''); if (cand.length > max) break; out = cand; }
    return out || n.slice(0, max);
  }
  function money(n) { n = Number(n || 0); return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; }
  function mobileOk() { return FORCE || window.innerWidth <= (cfg.rules.max_width || 899); }
  function hexRgb(h) { h = (h || '#000000').replace('#', ''); return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function isLoggedIn() { try { return !!(window.globalModel && window.globalModel.isAuthenticated); } catch (e) { return false; } }
  function memberId() { try { var m = window.globalModel && window.globalModel.member; if (!m) return ''; return String(m.memberId || m.uyeId || m.id || m.memberID || ''); } catch (e) { return ''; } }
  function memberName() { try { var m = window.globalModel && window.globalModel.isAuthenticated && window.globalModel.member; var n = m ? (m.memberFirstName || (m.memberName || '').split(' ')[0] || '') : ''; return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : ''; } catch (e) { return ''; } }

  var ICONS = {
    close: '<path d="M6 6l12 12M18 6 6 18"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', chev: '<path d="m9 6 6 6-6 6"/>',
    fire: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5.2 1.2.8 2 1.5 2.3C11.5 8.5 10.5 5.5 12 3z"/>', sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>', truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M12 9c-3-1-4-3-3-5s4 0 3 5zm0 0c3-1 4-3 3-5s-4 0-3 5z"/>', star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.7 1.1-5.9-4.3-4.1 5.9-.8z"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', bag: '<path d="M6 8h12l1 12H5z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', snow: '<path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[n] || ICONS.tag) + '</svg>'; }

  /* ═══ tema CSS ═══ */
  function css(t) {
    var p = t.preset || 'cards', dark = p === 'dark';
    var bg = dark ? (t.bg && t.bg !== '#ffffff' ? t.bg : '#0f1115') : (t.bg || '#ffffff');
    var ink = dark ? (t.ink && t.ink !== '#111827' ? t.ink : '#f3f4f6') : (t.ink || '#111827');
    var acc = dark ? (t.accent && t.accent !== '#111827' ? t.accent : '#ffffff') : (t.accent || '#111827');
    var tile = dark ? (t.tile_bg && t.tile_bg !== '#f3f4f6' ? t.tile_bg : '#1b1e25') : (t.tile_bg || '#f3f4f6');
    var r = (t.radius != null ? t.radius : 14) + 'px', cols = t.columns === 3 ? 3 : 2, fit = t.image_fit === 'contain' ? 'contain' : 'cover';
    var mono = p === 'mono';
    if (mono) { r = '0px'; }
    var line = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)';
    var mut = dark ? 'rgba(243,244,246,.55)' : 'rgba(17,24,39,.5)';
    var onAcc = (function (h) { h = h.replace('#', ''); var l = (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000; return l > 150 ? '#111827' : '#ffffff'; })(acc);
    var base = [
      ':host{all:initial;font-family:inherit;--bg:' + bg + ';--bgrgb:' + hexRgb(bg) + ';--ink:' + ink + ';--acc:' + acc + ';--onacc:' + onAcc + ';--accrgb:' + hexRgb(acc) + ';--tile:' + tile + ';--r:' + r + ';--line:' + line + ';--mut:' + mut + ';-webkit-font-smoothing:antialiased}',
      '*{box-sizing:border-box}a,button{font:inherit;color:inherit;text-decoration:none;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:0;margin:0}',
      '.ov{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:2147482100;opacity:0;pointer-events:none;transition:opacity .2s}.ov.on{opacity:1;pointer-events:auto}',
      '.pn{position:fixed;top:0;bottom:0;left:0;width:min(100%,430px);z-index:2147482101;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;transform:translateX(-104%);transition:transform .28s cubic-bezier(.2,.8,.2,1);box-shadow:10px 0 40px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.35}.pn.on{transform:none}.pn.full{width:100%;box-shadow:none}',
      '.inl .ov{position:absolute}.inl .pn{position:absolute;width:100%;box-shadow:none;transform:none}',
      '.hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;gap:10px}.hd .lg{font-weight:800;font-size:17px;letter-spacing:.02em;text-transform:lowercase}.hd .lg b{font-weight:800}.hd .lgi{height:32px;max-width:62%;object-fit:contain;display:block}.hd.logo{justify-content:center;position:relative;padding:12px 16px 10px}.hd.logo .x{position:absolute;right:12px;top:50%;transform:translateY(-50%)}.hd.logo .hi{position:absolute;left:16px;top:50%;transform:translateY(-50%);max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hd .x{width:34px;height:34px;border-radius:50%;background:var(--tile);display:flex;align-items:center;justify-content:center;color:var(--ink)}.hd .x svg{width:16px;height:16px}',
      '.hi{font-size:12px;color:var(--mut);font-weight:500}',
      '.sr{margin:0 14px 6px;background:var(--tile);border-radius:calc(var(--r) - 4px);padding:10px 12px;display:flex;align-items:center;gap:8px;color:var(--mut);font-size:14px}.sr svg{width:17px;height:17px;flex:0 0 auto;stroke:var(--ink)}',
      '.tabs{display:flex;gap:6px;padding:8px 14px 4px}.tabs button{flex:1 1 0;min-width:0;padding:10px 6px;border:1px solid var(--line);border-radius:calc(var(--r) - 4px);font-weight:700;font-size:13.5px;color:var(--ink);position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent}.tabs button.on{background:var(--acc);color:var(--onacc);border-color:var(--acc)}.tabs button .why{position:absolute;top:-1px;right:-1px;font-size:8.5px;background:var(--acc);color:var(--onacc);padding:2px 6px;border-radius:0 calc(var(--r) - 4px) 0 8px;font-weight:700;letter-spacing:.02em;opacity:.95}.tabs button.on .why{background:var(--onacc);color:var(--acc)}',
      '.bd{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding-bottom:calc(20px + env(safe-area-inset-bottom,0))}',
      '.row{display:flex;gap:8px;overflow-x:auto;padding:8px 14px 4px;scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding-left:14px}.row::-webkit-scrollbar{display:none}.row .chip{scroll-snap-align:start}.row .rowend{flex:0 0 1px}',
      /* kaydırma ipucu: sağda solan kenar + ok; sona gelince kaybolur */
      '.rowwrap{position:relative}.rowwrap .fade{position:absolute;top:8px;bottom:4px;right:0;width:54px;pointer-events:none;background:linear-gradient(90deg,rgba(var(--bgrgb),0),var(--bg) 55%);display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:var(--mut);transition:opacity .2s}.rowwrap .fade svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.2;animation:ymnudge 1.8s ease-in-out infinite}.rowwrap.end .fade{opacity:0}',
      '@keyframes ymnudge{0%,100%{transform:translateX(0)}50%{transform:translateX(3px)}}@media (prefers-reduced-motion:reduce){.rowwrap .fade svg{animation:none}}',
      '.chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:7px 12px 7px 10px;font-size:12.5px;font-weight:600;white-space:nowrap;color:var(--ink);background:var(--bg);position:relative}.chip svg{width:14px;height:14px}.chip .em{font-size:14px;line-height:1}.chip .cn{font-size:10.5px;font-weight:600;opacity:.65;margin-left:1px}.chip.rc{background:var(--tile);border-color:transparent}',
      /* öne çıkan görünümler: solid = vurgu dolgu; gradient = vurgudan açığa yavaş kayan parıltı; glow = nefes alan halka (kurumsal: düşük genlik, yavaş) */
      '.chip.solid,.vc.solid{background:var(--acc);color:var(--onacc);border-color:var(--acc)}',
      '.chip.gradient,.vc.gradient{color:var(--onacc);border-color:transparent;background-image:linear-gradient(110deg,var(--acc) 0%,var(--acc) 35%,rgba(var(--accrgb),.72) 50%,var(--acc) 65%,var(--acc) 100%);background-size:220% 100%;animation:ymsheen 5.5s ease-in-out infinite}',
      '.chip.glow{border-color:var(--acc);color:var(--acc);animation:ymglow 2.8s ease-in-out infinite}.vc.glow{box-shadow:0 0 0 0 rgba(var(--accrgb),.35);animation:ymglowc 2.8s ease-in-out infinite}',
      '@keyframes ymsheen{0%{background-position:100% 0}50%{background-position:0 0}100%{background-position:100% 0}}',
      '@keyframes ymglow{0%,100%{box-shadow:0 0 0 0 rgba(var(--accrgb),.28)}50%{box-shadow:0 0 0 5px rgba(var(--accrgb),0)}}',
      '@keyframes ymglowc{0%,100%{box-shadow:0 0 0 0 rgba(var(--accrgb),.3)}50%{box-shadow:0 0 0 7px rgba(var(--accrgb),0)}}',
      '@media (prefers-reduced-motion:reduce){.chip.gradient,.vc.gradient,.chip.glow,.vc.glow{animation:none}}',
      '.h{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px 6px;font-size:13px;font-weight:700}.h span{font-weight:500;color:var(--mut);font-size:11.5px}.h a{color:var(--acc);font-weight:600;font-size:12px}',
      '.note{margin:6px 14px 4px;padding:9px 12px;border-radius:calc(var(--r) - 4px);background:rgba(var(--accrgb),.09);color:var(--ink);font-size:12px;line-height:1.35}',
      '.grid{display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:8px;padding:4px 14px 6px}',
      '.tl{position:relative;background:var(--tile);border-radius:var(--r);padding:8px 8px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--ink);overflow:hidden;transition:transform .12s}.tl:active{transform:scale(.97)}',
      '.tl .im{width:100%;aspect-ratio:1;border-radius:calc(var(--r) - 5px);overflow:hidden;background:' + (dark ? '#23262e' : '#fff') + ';display:flex;align-items:center;justify-content:center}.tl .im img{width:100%;height:100%;object-fit:' + fit + ';display:block}.tl .im .ph{font-size:26px;font-weight:800;color:var(--mut)}',
      '.tl .tx{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;width:100%}.tl.wide .tx{align-items:flex-start;flex:1}',
      '.tl .nm{font-size:12.5px;font-weight:600;text-align:center;line-height:1.2' + (t.label_case === 'upper' || mono ? ';text-transform:uppercase;letter-spacing:.05em;font-size:11.5px' : '') + '}.tl .ct{font-size:11px;color:var(--mut);margin-top:-3px}',
      '.tl .bg{position:absolute;top:8px;left:8px;font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:999px;background:var(--bg);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12);letter-spacing:.02em;z-index:1}.tl .bg.hot{background:var(--acc);color:var(--onacc)}.tl .bg.szn{background:#ffe8d3;color:#9a4a00}.tl .bg.you{background:#e9e3fb;color:#4c2ab8}.tl .bg.new{background:#dcf5ea;color:#177a55}',
      '.tl.wide{grid-column:1 / -1;flex-direction:row;justify-content:flex-start;gap:14px;padding:10px 14px}.tl.wide .im{width:78px;flex:0 0 78px}.tl.wide .nm{text-align:left;font-size:14px}.tl.wide .ct{margin:0}',
      '.gh{padding:10px 16px 2px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}',
      '.more{display:block;margin:2px 14px 6px;padding:10px;text-align:center;border:1px dashed var(--line);border-radius:calc(var(--r) - 4px);font-size:12.5px;font-weight:600;color:var(--acc)}',
      '.pr{display:flex;gap:10px;overflow-x:auto;padding:4px 14px 10px;scrollbar-width:none}.pr::-webkit-scrollbar{display:none}.pd{flex:0 0 132px;background:var(--tile);border-radius:var(--r);overflow:hidden;color:var(--ink);display:flex;flex-direction:column}.pd img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#fff}.pd .n{font-size:11px;line-height:1.3;padding:6px 8px 0;height:35px;overflow:hidden;color:var(--ink);opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.pd .p{padding:4px 8px 8px;font-size:12.5px;font-weight:700;white-space:nowrap;display:flex;align-items:baseline;gap:5px;overflow:hidden}.pd .p s{color:var(--mut);font-weight:400;font-size:10.5px}.pd .sz{font-size:10px;color:var(--acc);font-weight:600;padding:0 8px 6px;margin-top:-4px}',
      /* kampanya bandı (style=hero): sekmelerin hemen altında, en üstte; ilk kart tam genişlik, sonrakiler 2'li. emoji alanı = rozet ("1+1") */
      '.pz{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px 14px 0}.pm{grid-column:span 1;position:relative;overflow:hidden;display:flex;align-items:center;gap:8px;min-height:44px;padding:7px 10px;border-radius:var(--r);color:var(--onacc);background:var(--acc);background-image:linear-gradient(120deg,var(--acc) 0%,var(--acc2) 100%);isolation:isolate}.pm.w{grid-column:1/-1;min-height:50px;padding:7px 10px}',
      '.pm::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:45%;background:linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.28) 50%,rgba(255,255,255,0) 100%);transform:skewX(-18deg);animation:ympmshine 3.6s ease-in-out infinite;z-index:-1;pointer-events:none}.pm:nth-child(2)::after{animation-delay:1.2s}.pm:nth-child(3)::after{animation-delay:2.4s}',
      '.pm .bg{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 5px;border-radius:8px;background:#fff;color:var(--acc);font-weight:900;font-size:12px;letter-spacing:-.02em;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.18)}.pm.w .bg{min-width:38px;height:34px;font-size:15px;transform:rotate(-4deg);animation:ympmpop 2.4s ease-in-out infinite}.pm .bg svg{width:16px;height:16px}',
      '.pm .tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}.pm b{font-weight:800;font-size:11.5px;letter-spacing:.02em;line-height:1.1;white-space:nowrap;text-transform:uppercase;display:flex;align-items:center;gap:6px;text-shadow:0 1px 2px rgba(0,0,0,.18)}.pm.w b{font-size:14px}.pm small{font-weight:500;font-size:10px;opacity:.88;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pm.w small{font-size:11px}',
      '.pm .dt{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.9);animation:ympmdot 1s ease-in-out infinite}',
      '.pm .go{flex:0 0 auto;display:none;align-items:center;gap:1px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:4px 6px 4px 9px;font-size:11px;font-weight:700;white-space:nowrap}.pm.w .go{display:inline-flex}.pm .go svg{width:12px;height:12px}.pm.glow{animation:ympmpulse 1.8s ease-in-out infinite}',
      '@keyframes ympmshine{0%{left:-60%}55%,100%{left:130%}}@keyframes ympmpop{0%,100%{transform:rotate(-4deg) scale(1)}50%{transform:rotate(3deg) scale(1.07)}}@keyframes ympmdot{0%,100%{opacity:1}50%{opacity:.3}}',
      '@keyframes ympmpulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--accrgb),.55)}50%{box-shadow:0 0 0 6px rgba(var(--accrgb),0)}}',
      '.pm:not(.w) b{letter-spacing:0}@media (max-width:379px){.pz .pm:not(.w){gap:6px;padding:7px 8px}.pm:not(.w) b{font-size:10.5px;gap:4px}.pm:not(.w) .bg{min-width:24px;height:24px}.pm:not(.w) .bg svg{width:14px;height:14px}}',
      /* 4 kampanya: üstte geniş kart, altında 3'lü sıra (kompakt: küçük rozet, 2 satıra kırılan başlık, not/nokta gizli) */
      '.pz.t3{grid-template-columns:repeat(3,1fr)}.pz.t3 .pm:not(.w){gap:5px;padding:6px 7px;min-height:44px}.pz.t3 .pm:not(.w) b{font-size:10px;white-space:normal;line-height:1.15;letter-spacing:0;gap:0}.pz.t3 .pm:not(.w) small,.pz.t3 .pm:not(.w) .dt{display:none}.pz.t3 .pm:not(.w) .bg{min-width:22px;height:22px;padding:0 3px;border-radius:6px;font-size:10px}.pz.t3 .pm:not(.w) .bg svg{width:13px;height:13px}.pm:nth-child(4)::after{animation-delay:3s}@media (max-width:379px){.pm.w b{font-size:12.5px;letter-spacing:0}.pm.w .go{font-size:10px;padding:3px 4px 3px 7px}}',
      '@media (prefers-reduced-motion:reduce){.pm::after,.pm.w .bg,.pm .dt,.pm.glow{animation:none}}',
      '.vc{margin:6px 14px;padding:14px 16px;border-radius:var(--r);background:var(--acc);color:var(--onacc);display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:700;font-size:14px}.vc small{display:block;font-weight:500;font-size:11.5px;opacity:.8;margin-top:2px}.vc svg{width:18px;height:18px}.vc.img{background-size:cover;background-position:center;min-height:86px;text-shadow:0 1px 6px rgba(0,0,0,.4);color:#fff}',
      '.ft{display:flex;gap:6px;padding:10px 14px 0}.ft a{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 4px;border-radius:calc(var(--r) - 4px);background:var(--tile);font-size:11.5px;font-weight:600;color:var(--ink)}.ft a svg{width:18px;height:18px}',
      ''
    ];
    if (p === 'list') base.push('.grid{display:flex;flex-direction:column;gap:0;padding:0 8px}.tl{flex-direction:row;justify-content:flex-start;gap:12px;padding:8px 10px;background:transparent;border-radius:calc(var(--r) - 4px);border-bottom:1px solid var(--line)}.tl .im{width:58px;flex:0 0 58px;border-radius:calc(var(--r) - 6px);background:var(--tile)}.tl .tx{flex-direction:row;align-items:center;justify-content:space-between;flex:1}.tl .nm{text-align:left;font-size:14px}.tl .ct{margin:0}.tl .bg{position:static;box-shadow:none;margin-left:6px;order:3}.tl.wide{grid-column:auto}.tl.wide .im{width:58px;flex-basis:58px}.tl .arr{width:16px;height:16px;stroke:var(--mut);fill:none;stroke-width:2;flex:0 0 auto}');
    if (p === 'story') base.push('.grid{grid-template-columns:repeat(4,1fr);gap:6px 4px;padding:6px 10px}.tl{background:transparent;padding:4px 2px 6px;gap:5px}.tl .im{width:68px;aspect-ratio:1;border-radius:50%;border:2px solid var(--line);padding:2px;background:var(--tile)}.tl .im img{border-radius:50%}.tl .nm{font-size:10.5px}.tl .ct{display:none}.tl .bg{top:0;left:50%;transform:translateX(-50%);font-size:8.5px;padding:2px 6px}.tl.wide{grid-column:1 / -1;flex-direction:row;background:var(--tile);padding:10px 14px;border-radius:var(--r)}.tl.wide .im{width:64px;flex-basis:64px;border:0;padding:0}.tl.wide .nm{font-size:14px;text-align:left}.tl.wide .ct{display:block}.tl.wide .bg{position:absolute;left:8px;top:8px;transform:none}');
    if (p === 'bento') base.push('.grid{grid-template-columns:repeat(6,1fr)}.tl{grid-column:span 3}.tl.b3{grid-column:span 2}.tl.b3 .nm{font-size:11.5px}.tl.b3 .ct{display:none}.tl.wide{grid-column:span 6}');
    if (mono) base.push('.pn{font-family:Helvetica,Arial,sans-serif}.tl{background:transparent;border:1px solid var(--ink);padding:0 0 8px;gap:8px}.tl .im{border-radius:0;border-bottom:1px solid var(--ink);background:var(--tile)}.tl .im img{object-fit:contain;mix-blend-mode:multiply}.tabs button{border-radius:0;border-color:var(--ink);text-transform:uppercase;letter-spacing:.08em;font-size:12px}.tabs button .why{border-radius:0}.chip{border-radius:0;border-color:var(--ink);text-transform:uppercase;font-size:11px;letter-spacing:.05em}.sr,.note,.more,.pd,.vc,.ft a,.hd .x{border-radius:0}.tl .bg{border-radius:0;box-shadow:none;border:1px solid var(--ink)}.tl.wide{padding:0;gap:0}.tl.wide .im{border-bottom:0;border-right:1px solid var(--ink);align-self:stretch;aspect-ratio:auto}.tl.wide .tx{padding:10px 12px}.tl.wide .nm{padding:0}.h{text-transform:uppercase;letter-spacing:.08em;font-size:11.5px}');
    if (dark) base.push('.pn{box-shadow:10px 0 40px rgba(0,0,0,.5)}.tl .bg{background:#23262e;color:#f3f4f6}.tl .bg.hot{background:var(--acc);color:var(--onacc)}.pd img{background:#23262e}');
    return base.join('');
  }

  /* ═══ sıralama / rozet mantığı ═══ */
  function seasonMul(t) { if (!cfg.rules.season_boost) return 1; var s = Number(t.season || 1); return Math.max(0.5, Math.min(2.5, s)); }
  function personalMul(t) {
    if (!cfg.rules.personalize) return 1;
    var v = profile.cats[t.url] || 0, m = 1 + Math.min(v, 5) * 0.35;
    // üye: satın aldığı kategoriler (en yeni alışveriş en güçlü)
    if (personalData && personalData.categories && personalData.categories.length) {
      var tp = String(t.path || '');
      if (tp) for (var i = 0; i < personalData.categories.length; i++) { var c = String(personalData.categories[i] || ''); if (!c) continue; if (tp === c || c.indexOf(tp + ' > ') === 0 || tp.indexOf(c + ' > ') === 0) { m *= 1.9 - Math.min(i, 8) * 0.1; break; } }
    }
    return m;
  }
  function orderedTiles(seg) {
    var sort = cfg.rules.sort || 'sales_30d', list = (seg.tiles || []).slice();
    var recentUrl = cfg.rules.personalize && profile.recent && profile.recent[0] && profile.recent[0].seg === seg.url ? profile.recent[0].url : '';
    var maxQ = 0; list.forEach(function (t) { if (t.q30 > maxQ) maxQ = t.q30; });
    list.forEach(function (t, i) {
      var base = sort === 'sales_7d' ? t.q7 : t.q30;
      t._catalog = i;
      t._score = sort === 'catalog' ? (1000 - i) : ((base + 1) * seasonMul(t) * personalMul(t));
      t._src = sort === 'catalog' ? 'catalog' : 'sales';
      if (sort !== 'catalog' && cfg.rules.season_boost && seasonMul(t) >= 1.35) t._src = 'season';
      if (cfg.rules.personalize && (profile.cats[t.url] || 0) > 0 && sort !== 'catalog') t._src = 'personal';
      t._badge = null;
      if (cfg.rules.badges) {
        if (t.url === recentUrl) t._badge = ['Son baktığın', 'you'];
        else if (t.path && personalData && personalData.categories && personalData.categories.indexOf(t.path) === 0) t._badge = ['Son aldığın', 'you'];
        else if (t.path && personalData && personalData.categories && personalData.categories.indexOf(t.path) > 0) t._badge = ['Aldığın', 'you'];
        else if (cfg.rules.season_boost && Number(t.season || 1) >= 1.4) t._badge = ['Sezon ↑', 'szn'];
        else if (maxQ > 0 && t.q30 === maxQ) t._badge = ['Çok satan', 'hot'];
      }
      if (t.pinned) { t._score += 1e6; t._src = 'pinned'; }
      if (t.url === recentUrl) { t._score += 5e5; t._src = 'personal'; }
    });
    list.sort(function (a, b) { return b._score - a._score || a._catalog - b._catalog; });
    return list;
  }
  function tabOrder() {
    var segs = (cfg.segments || []).slice(), mode = cfg.rules.default_tab || 'remember';
    var remembered = mode === 'remember' && cfg.rules.personalize ? profile.tab : '';
    // cihazda iz yoksa üyenin son alışveriş segmenti
    if (!remembered && mode === 'remember' && cfg.rules.personalize && personalData && personalData.last_segment) { segs.forEach(function (s) { if (s.name === personalData.last_segment) remembered = s.url; }); }
    if (mode !== 'catalog') segs.sort(function (a, b) { return (b.q30 || 0) - (a.q30 || 0); });
    if (remembered) { var i = -1; segs.forEach(function (s, k) { if (s.url === remembered) i = k; }); if (i > 0) { var s = segs.splice(i, 1)[0]; segs.unshift(s); } }
    return segs;
  }
  function segmentOf(url) { var f = null; (cfg.segments || []).forEach(function (s) { if (s.url === url) f = s; }); return f; }

  /* ═══ hızlı görseller ═══
     Ticimax 'buyuk' (5000px, 1-3 MB) yerine 'thumb' (400x600, ~18 KB); Trendyol CDN 600/800 → 300/400.
     Yüklenemezse (data-o) orijinale döner; ilk kartlar eager+high priority; config gelince boşta ön yükleme. */
  function fastImg(u) { if (!u) return u; try { return String(u).replace(/\/UrunResimleri\/buyuk\//i, '/UrunResimleri/thumb/').replace(/\/mnresize\/\d+\/\d+\//, '/mnresize/300/400/'); } catch (e) { return u; } }
  function imgTag(u, i) { var f = fastImg(u); return '<img src="' + esc(f) + '"' + (f !== u ? ' data-o="' + esc(u) + '"' : '') + ' alt="" decoding="async" loading="' + (i < 6 ? 'eager' : 'lazy') + '"' + (i < 4 ? ' fetchpriority="high"' : '') + '>'; }
  var warmed = false;
  function warm() {
    if (warmed || !cfg) return; warmed = true;
    var run = function () {
      try {
        var seg = tabOrder()[0]; if (!seg) return;
        var urls = [];
        orderedTiles(seg).slice(0, 12).forEach(function (t) { if (t.img) urls.push(fastImg(t.img)); });
        ((cfg.products || {})[seg.name] || []).slice(0, cfg.rules.products_count || 6).forEach(function (p) { if (p.img) urls.push(fastImg(p.img)); });
        var lg = logoSrc(); if (lg) urls.push(lg);
        urls.forEach(function (u) { var im = new Image(); im.decoding = 'async'; im.src = u; });
        dbg('ön yükleme: ' + urls.length + ' görsel');
      } catch (e) { }
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 2000);
  }

  /* ═══ render ═══ */
  function tileHTML(t, i, wide, seg) {
    var badge = t._badge ? '<span class="bg ' + t._badge[1] + '">' + esc(t._badge[0]) + '</span>' : '';
    var img = t.img ? imgTag(t.img, i) : '<span class="ph">' + esc((t.label || '?').charAt(0)) + '</span>';
    var ct = cfg.rules.show_counts ? '<span class="ct">' + t.count + ' ürün</span>' : '';
    var cls = 'tl' + (wide ? ' wide' : '') + (cfg.theme.preset === 'bento' && !wide && i > 0 && ((i - 1) % 5 >= 2) ? ' b3' : '');
    var arr = cfg.theme.preset === 'list' ? '<svg class="arr" viewBox="0 0 24 24">' + ICONS.chev + '</svg>' : '';
    return '<a class="' + cls + '" href="' + esc(abs(t.url)) + '" data-tile="' + esc(t.url) + '" data-pos="' + (i + 1) + '" data-src="' + esc(t._src) + '" data-seg="' + esc(seg.name) + '">' + badge + '<span class="im">' + img + '</span><span class="tx"><span class="nm">' + esc(t.label) + '</span>' + ct + '</span>' + arr + '</a>';
  }
  function band(v, seg) { return v.auto_price && v.bands && seg ? v.bands[seg.url] : null; }
  function virtualUrl(v, seg) {
    var u = (v.url || '').replace(/\{seg\}/g, seg ? seg.url : '');
    if (seg && v.urls && v.urls[String(seg.url).toLowerCase()]) u = v.urls[String(seg.url).toLowerCase()]; // segment başına hedef
    var b = band(v, seg); if (b) u = u.replace(/\{min\}/g, b.min).replace(/\{max\}/g, b.max);
    return abs(u);
  }
  function virtualLabel(v, seg) { var b = band(v, seg); var l = v.label || ''; if (b) l = l.replace(/\{min\}/g, b.min).replace(/\{max\}/g, b.max); return l; }
  function virtualCount(v, seg) { var b = band(v, seg); if (b) return b.count; return v.counts ? v.counts[seg ? seg.url : ''] : v.count; }
  /* çip renkleri: panelden seçilen renk; yoksa öne çıkan çipler için markayla uyumlu sıralı palet (sekmelerin vurgu renginden ayrışır) */
  var PALETTE = ['#d97706', '#e11d48', '#0284c7', '#059669', '#7c3aed', '#ea580c'];
  function chipStyle(v, i) {
    if (!v.look || v.look === 'plain') return '';
    var c = v.color || PALETTE[i % PALETTE.length];
    var on = (function (h) { h = h.replace('#', ''); var l = (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000; return l > 150 ? '#111827' : '#ffffff'; })(c);
    return ' style="--acc:' + c + ';--onacc:' + on + ';--accrgb:' + hexRgb(c) + '"';
  }
  function chipsHTML(seg) {
    var vs = (cfg.virtual || []).filter(function (v) { return v.style === 'chip' && (!v.auto_price || band(v, seg)); });
    if (!vs.length) return '';
    var k = 0;
    return '<div class="rowwrap"><div class="row" data-row>' + vs.map(function (v) {
      var look = v.look && v.look !== 'plain' ? ' ' + v.look : '';
      var lead = v.emoji ? '<span class="em">' + esc(v.emoji) + '</span>' : icon(v.icon);
      var n = virtualCount(v, seg);
      var cnt = (n != null && n > 0) ? '<span class="cn">' + n + '</span>' : '';
      var st = chipStyle(v, look ? k++ : 0);
      return '<a class="chip' + look + '"' + st + ' href="' + esc(virtualUrl(v, seg)) + '" data-virt="' + esc(v.key) + '">' + lead + esc(virtualLabel(v, seg)) + cnt + '</a>';
    }).join('') + '<span class="rowend"></span></div><span class="fade"><svg viewBox="0 0 24 24">' + ICONS.chev + '</svg></span></div>';
  }
  function heroHTML(seg) {
    var vs = (cfg.virtual || []).filter(function (v) { return v.style === 'hero'; });
    if (!vs.length) return '';
    var t3 = vs.length === 4;
    return '<div class="pz' + (t3 ? ' t3' : '') + '">' + vs.map(function (v, i) {
      var c = v.color || PALETTE[i % PALETTE.length];
      var cs = '--acc:' + c + ';--accrgb:' + hexRgb(c) + ';--onacc:#fff;--acc2:' + (v.color2 || c); // hero: renk görünümden bağımsız, yazı hep beyaz
      var n = virtualCount(v, seg);
      var note = v.note || (n != null && n > 0 ? n + ' ürün' : '');
      var wide = i === 0 || (!t3 && vs.length % 2 === 0 && i === vs.length - 1 && vs.length > 2);
      var look = v.look === 'glow' ? ' glow' : '';
      var badge = v.emoji ? esc(v.emoji) : icon(v.icon);
      var dot = v.look === 'glow' || v.look === 'gradient' ? '<span class="dt"></span>' : '';
      return '<a class="pm' + (wide ? ' w' : '') + look + '" style="' + cs + '" href="' + esc(virtualUrl(v, seg)) + '" data-virt="' + esc(v.key) + '"><span class="bg">' + badge + '</span><span class="tx"><b>' + dot + esc(virtualLabel(v, seg)) + '</b>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</span><span class="go">Keşfet' + icon('chev') + '</span></a>';
    }).join('') + '</div>';
  }
  function cardsHTML(seg) {
    var vs = (cfg.virtual || []).filter(function (v) { return v.style === 'card'; });
    return vs.map(function (v) {
      if (v.auto_price && !band(v, seg)) return '';
      var look = v.look && v.look !== 'plain' ? ' ' + v.look : '';
      var cs = chipStyle(v, 0).replace(' style="', '').replace(/"$/, '');
      var st = v.image ? ' img" style="background-image:url(' + esc(fastImg(v.image)) + ');' + cs + '"' : '" style="' + cs + '"';
      var n = virtualCount(v, seg);
      var note = v.note || (n != null && n > 0 ? n + ' ürün' : '');
      return '<a class="vc' + look + st + ' href="' + esc(virtualUrl(v, seg)) + '" data-virt="' + esc(v.key) + '"><span>' + (v.emoji ? esc(v.emoji) + ' ' : '') + esc(virtualLabel(v, seg)) + (note ? '<small>' + esc(note) + '</small>' : '') + '</span>' + icon('chev') + '</a>';
    }).join('');
  }
  function recentHTML(seg) {
    if (!cfg.rules.show_recent || !cfg.rules.personalize) return '';
    var rc = (profile.recent || []).slice(0, 4);
    if (!rc.length) return '';
    return '<div class="h">Kaldığın yer <span>son gezdiklerin</span></div><div class="row">' + rc.map(function (r) { return '<a class="chip rc" href="' + esc(abs(r.url)) + '" data-recent="' + esc(r.url) + '">' + icon('clock') + esc(r.label) + '</a>'; }).join('') + '</div>';
  }
  function bareP(t) { return String(t || '').replace(/₺|TL/g, '').replace(/\s+/g, ' ').trim(); }
  function recentPriceHTML(p) {
    var f = recentPrices && recentPrices[pidOf(p.url)];
    if (f && Number(f.price) > 0) return '<span class="p">' + (f.dprice ? '<s>' + esc(money(f.price).replace(' TL', '')) + '</s>' + esc(money(f.dprice)) : esc(money(f.price))) + '</span>';
    return /\d/.test(p.price || '') ? '<span class="p">' + (/\d/.test(p.old || '') ? '<s>' + esc(bareP(p.old)) + '</s>' : '') + esc(bareP(p.price) + ' TL') + '</span>' : '';
  }
  function recentProductsHTML() {
    if (!cfg.rules.personalize || !cfg.rules.show_recent) return '';
    var rp = (profile.products || []).slice(0, 6);
    if (!rp.length) return '';
    return '<div class="h">Son baktığın ürünler <span>bu cihazda</span></div><div class="pr">' + rp.map(function (p, i) {
      return '<a class="pd" href="' + esc(abs(p.url)) + '" data-recent="' + esc(p.url) + '" data-pos="' + (i + 1) + '">' + imgTag(p.img, i) + '<span class="n" title="' + esc(p.name) + '">' + esc(shortName(p.name, cfg.rules.product_name_max)) + '</span>' + recentPriceHTML(p) + '</a>';
    }).join('') + '</div>';
  }
  function productsHTML(seg) {
    if (!cfg.rules.show_products) return '';
    var src = cfg.rules.products_source || 'auto';
    var list = null, title = 'Şu an en çok satanlar', sub = seg.name + ' · son 14 gün';
    if ((src === 'personal' || src === 'auto') && personal && personal.length) { list = personal; title = 'Sana özel'; sub = memberName() ? memberName() + ' için seçildi' : 'alışverişlerine göre'; }
    if (!list && src !== 'personal') list = (cfg.products || {})[seg.name] || [];
    if (!list || !list.length) return '';
    return '<div class="h">' + esc(title) + ' <span>' + esc(sub) + '</span></div><div class="pr">' + list.map(function (p, i) {
      var price = p.dprice ? '<s>' + esc(money(p.price).replace(' TL', '')) + '</s>' + esc(money(p.dprice)) : esc(money(p.price));
      return '<a class="pd" href="' + esc(abs(p.url)) + '" data-prod="' + esc(p.pid || p.url) + '" data-pos="' + (i + 1) + '">' + imgTag(p.img, i) + '<span class="n" title="' + esc(p.name) + '">' + esc(shortName(p.name, cfg.rules.product_name_max)) + '</span><span class="p">' + price + '</span>' + (p.size ? '<span class="sz">' + esc(p.size) + ' numara stokta</span>' : '') + '</a>';
    }).join('') + '</div>';
  }
  function bodyHTML(seg) {
    var tiles = orderedTiles(seg), max = cfg.rules.max_tiles > 0 ? cfg.rules.max_tiles : 9999, rest = tiles.slice(max), shown = tiles.slice(0, max);
    var vp = cfg.rules.virtual_position || 'top';
    var h = '';
    h += heroHTML(seg);
    if (vp === 'top' || vp === 'both') h += chipsHTML(seg);
    h += recentHTML(seg);
    var why = cfg.rules.sort === 'catalog' ? 'katalog sırası' : (cfg.rules.sort === 'sales_7d' ? 'bu haftanın satışları' : 'son 30 günün satışları');
    h += '<div class="h">' + esc(seg.name) + ' kategorileri <span>' + esc(why) + '</span></div>';
    var wideFirst = (cfg.theme.preset === 'cards' || cfg.theme.preset === 'bento' || cfg.theme.preset === 'story' || cfg.theme.preset === 'mono') && cfg.rules.sort !== 'catalog';
    if (cfg.rules.group_headers) {
      var groups = {}, order = [];
      shown.forEach(function (t) { var g = t.group || ''; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(t); });
      order.forEach(function (g) { h += (g ? '<div class="gh">' + esc(g) + '</div>' : '') + '<div class="grid">' + groups[g].map(function (t, i) { return tileHTML(t, i, false, seg); }).join('') + '</div>'; });
    } else {
      h += '<div class="grid">' + shown.map(function (t, i) { return tileHTML(t, i, wideFirst && i === 0, seg); }).join('') + (moreOpen[seg.url] ? rest.map(function (t, i) { return tileHTML(t, i + shown.length, false, seg); }).join('') : '') + '</div>';
      if (rest.length && !moreOpen[seg.url]) h += '<button class="more" data-more="' + esc(seg.url) + '">+ ' + rest.length + ' kategori daha</button>';
    }
    if (cfg.rules.show_all_link) h += '<div class="h"><a href="' + esc(abs(seg.url)) + '" data-all="' + esc(seg.name) + '">Tüm ' + esc(seg.name) + ' ürünleri (' + seg.count + ') →</a></div>';
    h += recentProductsHTML();
    h += productsHTML(seg);
    if (vp === 'bottom' || vp === 'both') h += cardsHTML(seg); else h += cardsHTML(seg);
    if (cfg.rules.footer_links) {
      var acc = isLoggedIn() ? '/Hesabim' : '/UyeGiris';
      h += '<div class="ft"><a href="' + esc(abs(acc)) + '" data-ft="account">' + icon('user') + (memberName() || 'Hesabım') + '</a><a href="' + esc(abs('/Hesabim.aspx#/Favorilerim')) + '" data-ft="favorites">' + icon('heart') + 'Favorilerim</a><a href="' + esc(abs(cfg.cart_url || '/checkout')) + '" data-ft="cart">' + icon('bag') + 'Sepetim</a></div>';
    }
    return h;
  }
  /* Logo: panelden URL verilmişse o; yoksa temanın header logosu sayfadan alınır (Ticimax .header_logo, genel .logo img) */
  var logoCache;
  function logoSrc() {
    if (cfg.theme && cfg.theme.logo_url) return cfg.theme.logo_url;
    if (logoCache !== undefined) return logoCache;
    logoCache = '';
    try {
      var im = qs('img.header_logo, img.header-logo, .header-logo img, .headerLogo img, .logo img, a.logo img, [class*="logo" i] img');
      var src = im ? (im.currentSrc || im.getAttribute('src') || im.getAttribute('data-src') || '') : '';
      if (src && !/ticimax\.com|1x1|blank|placeholder/i.test(src)) logoCache = src;
    } catch (e) { }
    return logoCache;
  }
  function render() {
    if (!root) return;
    if (!tabsFrozen) { tabsFrozen = tabOrder(); whyFrozen = cfg.rules.personalize && cfg.rules.default_tab === 'remember' && tabsFrozen[0] && ((profile.tab && tabsFrozen[0].url === profile.tab) ? 'Son gezdiğin' : ((personalData && personalData.last_segment === tabsFrozen[0].name) ? 'Alışverişin' : '')) || ''; }
    var segs = tabsFrozen, why = whyFrozen;
    if (!tab || !segmentOf(tab)) tab = segs[0] ? segs[0].url : null;
    var seg = segmentOf(tab);
    var name = memberName();
    var logo = logoSrc();
    var h = '<div class="hd' + (logo ? ' logo' : '') + '">' + (logo ? '<img class="lgi" src="' + esc(logo) + '" alt="' + esc(cfg.store_name || '') + '">' : '<span class="lg">' + esc(cfg.store_name || 'Menü') + '</span>') + (name ? '<span class="hi">Merhaba ' + esc(name) + '</span>' : '') + '<button class="x" id="x" aria-label="Kapat">' + icon('close') + '</button></div>';
    if (cfg.rules.show_search) h += '<button class="sr" id="sr">' + icon('search') + '<span>Ürün, kategori ara…</span></button>';
    h += '<div class="tabs">' + segs.map(function (s, i) { return '<button data-tab="' + esc(s.url) + '" class="' + (s.url === tab ? 'on' : '') + '">' + esc(s.name) + (why && i === 0 ? '<span class="why">' + why + '</span>' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="bd" id="bd">' + (seg ? bodyHTML(seg) : '') + '</div>';
    qs('#pn', root).innerHTML = h;
    root.querySelectorAll('[data-row]').forEach(function (r) {
      var upd = function () { var end = r.scrollLeft + r.clientWidth >= r.scrollWidth - 6; r.parentNode.classList.toggle('end', end || r.scrollWidth <= r.clientWidth + 6); };
      r.addEventListener('scroll', upd, { passive: true }); setTimeout(upd, 60);
    });
  }

  /* ═══ olaylar ═══ */
  function track(type, extra) {
    try {
      var seg = cfg ? segmentOf(tab) : null;
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, segment: seg ? seg.name : '' }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }
  function loadPersonal() {
    if (personalTried) return; personalTried = true;
    if (!cfg.rules.personalize && ((cfg.rules.products_source || 'auto') === 'popular' || !cfg.rules.show_products)) return;
    var m = memberId(); if (!m || !isLoggedIn()) return;
    fetch(API + '/personal?member=' + encodeURIComponent(m) + '&limit=' + (cfg.rules.products_count || 6), { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      personalData = d || null; personal = d && d.items && d.items.length ? d.items : null;
      if (d && ((d.items && d.items.length) || (d.categories && d.categories.length)) && isOpen) { tabsFrozen = null; render(); }
    }).catch(function () { });
  }
  /* Son baktığın ürünler: güncel fiyat sunucudan (cihazdaki fiyat bayatlayabilir; eski sürüm "Fiyat" yazısı kaydetmişti) */
  var recentPrices = null, recentPricesTried = false;
  function pidOf(u) { var m = String(u || '').replace(/[?#].*$/, '').match(/-(\d+)\/?$/); return m ? m[1] : ''; }
  function loadRecentPrices() {
    if (recentPricesTried) return; recentPricesTried = true;
    if (!cfg.rules.personalize || !cfg.rules.show_recent) return;
    var ids = (profile.products || []).slice(0, 6).map(function (p) { return pidOf(p.url); }).filter(Boolean);
    if (!ids.length) return;
    fetch(API + '/prices?ids=' + ids.join(','), { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      recentPrices = (d && d.items) || {};
      if (isOpen) render();
    }).catch(function () { });
  }
  function open(source) {
    if (!root) return;
    isOpen = true; clickedSinceOpen = false; tabsFrozen = null;
    render();
    qs('#ov', root).classList.add('on'); qs('#pn', root).classList.add('on');
    if (!INLINE) { try { document.documentElement.style.overflow = 'hidden'; } catch (e) { } }
    track('open', { source: source || 'api' });
    loadPersonal();
  }
  function close() {
    if (!root) return;
    isOpen = false;
    qs('#ov', root).classList.remove('on'); qs('#pn', root).classList.remove('on');
    if (!INLINE) { try { document.documentElement.style.overflow = ''; } catch (e) { } }
    if (!clickedSinceOpen) track('close', { value: 'noclick' });
  }
  function bind() {
    root.addEventListener('error', function (e) { var im = e.target; if (im && im.tagName === 'IMG' && im.getAttribute('data-o')) { im.src = im.getAttribute('data-o'); im.removeAttribute('data-o'); } }, true);
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('#ov, #x, #sr, [data-tab], [data-more], [data-tile], [data-virt], [data-prod], [data-recent], [data-all], [data-ft]') : null;
      if (!t) return;
      if (t.id === 'ov' || t.id === 'x') { e.preventDefault(); close(); return; }
      if (t.id === 'sr') { e.preventDefault(); track('search'); clickedSinceOpen = true; close(); openSearch(); return; }
      if (t.hasAttribute('data-tab')) { e.preventDefault(); tab = t.getAttribute('data-tab'); var s = segmentOf(tab); if (s && cfg.rules.personalize) { profile.tab = tab; saveProfile(profile); } track('tab', { value: s ? s.name : tab }); render(); return; }
      if (t.hasAttribute('data-more')) { e.preventDefault(); moreOpen[t.getAttribute('data-more')] = true; track('more', { value: t.getAttribute('data-more') }); render(); return; }
      clickedSinceOpen = true;
      if (t.hasAttribute('data-tile')) track('tile', { value: t.getAttribute('data-tile'), pos: t.getAttribute('data-pos'), source: t.getAttribute('data-src') });
      else if (t.hasAttribute('data-virt')) track('virtual', { value: t.getAttribute('data-virt') });
      else if (t.hasAttribute('data-prod')) track('product', { value: t.getAttribute('data-prod'), pos: t.getAttribute('data-pos') });
      else if (t.hasAttribute('data-recent')) track('recent', { value: t.getAttribute('data-recent') });
      else if (t.hasAttribute('data-all')) track('all', { value: t.getAttribute('data-all') });
      else if (t.hasAttribute('data-ft')) track('footer', { value: t.getAttribute('data-ft') });
      if (FORCE) { e.preventDefault(); flash(t); }
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close(); });
    // Tema hamburger'ını yakala (capture: Ticimax'ın kendi handler'ı çalışmadan)
    if (cfg.rules.mount === 'hamburger' || cfg.rules.mount === 'both') {
      document.addEventListener('click', function (e) {
        if (FORCE) return;
        var t = e.target && e.target.closest ? e.target.closest('.newMenuBtnClick, .mobileMenuBtn, .navbar-toggle, .hamburger, .menu-toggle, [class*="menuBtn" i], [class*="mobile-menu-btn" i], [aria-label="Menü"]') : null;
        if (!t) return;
        if (!mobileOk()) { dbg('hamburger tıklandı ama genişlik ' + innerWidth + 'px > ' + (cfg.rules.max_width || 899) + ' → tema menüsü'); return; }
        dbg('hamburger yakalandı');
        try { open('hamburger'); } catch (err) { report('open', err); return; } // hata olursa tema menüsü engellenmez
        e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }, true);
    }
  }
  function flash(el) { try { el.style.outline = '2px solid rgba(' + hexRgb(cfg.theme.accent || '#111827') + ',.9)'; setTimeout(function () { el.style.outline = ''; }, 350); } catch (e) { } }
  function openSearch() {
    if (window.YunbiSearch && typeof window.YunbiSearch.open === 'function') { window.YunbiSearch.open(''); return; }
    var t = qs('.newSearcBtnClick a, .mobile-search-item a, .search-icon, .searchIcon, .btnArama');
    if (t) { t.click(); return; }
    var inp = qs('input[type="search"], input[name*="ara" i], input[id*="search" i]');
    if (inp) { inp.focus(); }
  }
  function shouldHide() {
    if (FORCE) return false;
    var paths = (cfg.rules.hide_paths || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var p = location.pathname.toLowerCase();
    for (var i = 0; i < paths.length; i++) if (paths[i] && p.indexOf(paths[i]) === 0) return true;
    return false;
  }
  function mount() {
    host = document.createElement('div');
    host.id = 'yunbi-menu';
    host.style.cssText = INLINE ? 'display:block;position:relative;width:100%;height:100%' : 'display:block;position:static;width:0;height:0';
    var target = INLINE && SCRIPT.getAttribute('data-mount') ? qs(SCRIPT.getAttribute('data-mount')) : document.body;
    (target || document.body).appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = css(cfg.theme); root.appendChild(st);
    var w = document.createElement('div'); w.className = INLINE ? 'inl' : ''; w.innerHTML = '<div class="ov" id="ov"></div><div class="pn' + (cfg.theme.full_width ? ' full' : '') + '" id="pn"></div>'; root.appendChild(w);
    return true;
  }
  /* Config önbelleği: son config cihazda 15 dk saklanır → menü sayfa açılır açılmaz hazır, taze config arkada gelir */
  var CKEY = 'yunbi_menu_cfg_' + TENANT + '_14';
  function readCache() { try { var j = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (j && j.t && Date.now() - j.t < 15 * 60 * 1000 && j.c && j.c.segments) return j.c; } catch (e) { } return null; }
  function writeCache(c) { try { localStorage.setItem(CKEY, JSON.stringify({ t: Date.now(), c: c })); } catch (e) { } }
  function normalize(c) {
    c = c || {}; c.rules = c.rules || {}; c.theme = c.theme || {};
    if (FORCE_PRESET) c.theme.preset = FORCE_PRESET;
    if (FORCE_THEME) c.theme = Object.assign({}, c.theme, FORCE_THEME);
    return c;
  }
  /* Masaüstü tema menüsü (Ticimax .newHeaderNavUl): 'hero' kampanyaları aynı renk/rozetle vurgular — genişlikten bağımsız, document'a tek <style>.
     Seçici öneki (html body) temadaki eski elle yazılmış kampanya CSS'ini ezer. */
  function navGap() { try { var u = document.querySelector('.newHeaderNavUl'); var g = u ? parseFloat(getComputedStyle(u).columnGap) : NaN; return isFinite(g) && g > 12 ? Math.round(g) : 40; } catch (e) { return 40; } }
  function navPromo() {
    try {
      var old = document.getElementById('yunbi-nav-promo');
      var vs = cfg && cfg.rules && cfg.rules.nav_promo ? (cfg.virtual || []).filter(function (v) { return v.style === 'hero' && v.enabled !== false && v.url && v.url.indexOf('{') < 0; }) : [];
      if (!vs.length) { if (old) old.parentNode.removeChild(old); return; }
      var P = 'html body .newHeaderNavUl .nav-item-link';
      var css = '';
      vs.forEach(function (v, i) {
        var path = String(v.url).split('?')[0].replace(/["\\]/g, '');
        var c = v.color || PALETTE[i % PALETTE.length], c2 = v.color2 || c, rgb = hexRgb(c), k = 'ynp' + i;
        var a = P + '[href="' + path + '"]', sp = a + ' span';
        if (v.nav === 'text') { // sade vurgu: kapsül/parlama yok — yalnız marka renginde kalın yazı + küçük canlı nokta
          css += a + '{padding:0 4px!important;background:transparent!important;box-shadow:none!important;animation:none!important}';
          css += sp + '{display:inline-flex;align-items:center;gap:6px;color:' + c + '!important;font-weight:800!important;background:none!important;box-shadow:none!important;animation:none!important;padding:0!important;opacity:1!important;-webkit-text-fill-color:currentColor}';
          css += sp + '::before{content:"";width:6px;height:6px;margin:0;flex:0 0 auto;border-radius:50%;background:' + c + ';box-shadow:0 0 5px rgba(' + rgb + ',.7);animation:ynpDot 1.4s ease-in-out infinite}';
          css += a + ':hover span{color:' + c2 + '!important}';
          return;
        }
        css += a + '{padding:0 4px!important;background:transparent!important}';
        css += sp + '{position:relative;overflow:hidden;isolation:isolate;display:inline-flex;align-items:center;gap:7px;color:#fff!important;padding:7px 11px;border-radius:999px;font-weight:800;letter-spacing:.2px;line-height:1;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.18);transform:none;transition:transform .2s ease,filter .2s ease;background:linear-gradient(110deg,' + c + ',' + c2 + ');animation:' + k + 'p 1.8s ease-in-out infinite ' + (i * 0.9) + 's}';
        css += sp + '::after{content:"";position:absolute;top:0;bottom:0;left:-70%;width:45%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.35),rgba(255,255,255,0));transform:skewX(-18deg);animation:ynpShine 3.6s ease-in-out infinite ' + (i * 1.8) + 's;z-index:-1;pointer-events:none}';
        if (v.emoji && v.nav !== 'dot') css += sp + '{padding-left:6px}' + sp + '::before{content:"' + String(v.emoji).replace(/["\\]/g, '') + '";flex:0 0 auto;background:#fff;color:' + c + ';font-weight:900;font-size:11px;letter-spacing:-.2px;text-shadow:none;padding:4px 6px;border-radius:999px;width:auto;height:auto;margin:0;box-shadow:none;animation:ynpWiggle 2.4s ease-in-out infinite}';
        else css += sp + '::before{content:"";width:7px;height:7px;margin:0;flex:0 0 auto;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.9);animation:ynpDot 1s ease-in-out infinite}';
        css += a + ':hover span,' + sp + ':hover{color:#fff!important;background:linear-gradient(110deg,' + c + ',' + c2 + ');transform:translateY(-1px) scale(1.05);filter:brightness(1.08)}';
        css += '@keyframes ' + k + 'p{0%,100%{box-shadow:0 0 0 0 rgba(' + rgb + ',.5),0 2px 8px rgba(' + rgb + ',.3)}50%{box-shadow:0 0 0 7px rgba(' + rgb + ',0),0 2px 14px rgba(' + rgb + ',.55)}}';
      });
      // yan yana duran kampanya öğeleri: temanın geniş menü aralığını (flex gap) daralt → tek grup gibi dursun
      var lis = vs.map(function (v) { return 'html body .newHeaderNavUl > li:has(> a.nav-item-link[href="' + String(v.url).split('?')[0].replace(/["\\]/g, '') + '"])'; });
      var adj = []; lis.forEach(function (x, i) { lis.forEach(function (y, j) { if (i !== j) adj.push(x + ' + ' + y.replace('html body .newHeaderNavUl > ', '')); }); });
      if (adj.length) css += '@supports selector(:has(a)){' + adj.join(',') + '{margin-left:calc(10px - var(--ynp-gap,40px))}' + 'html body .newHeaderNavUl{--ynp-gap:' + navGap() + 'px}}';
      // kalabalık menü: tema header'ı sabit genişlik + logo flex-shrink:1 → yeni öğe eklenince logo eziliyordu (13 Eki, 0 px'e kadar).
      // Menü aralığını daralt, logoyu eski boyutunun altına inmekten koru.
      if (vs.length >= 3) css += 'html body .newHeaderNavUl{column-gap:20px!important;--ynp-gap:20px}html body .header-inner > #hb-logo{min-width:148px}';
      css += '@keyframes ynpShine{0%{left:-70%}55%,100%{left:130%}}@keyframes ynpDot{0%,100%{opacity:1}50%{opacity:.3}}@keyframes ynpWiggle{0%,100%{transform:rotate(-6deg) scale(1)}50%{transform:rotate(5deg) scale(1.08)}}';
      css += '@media (prefers-reduced-motion:reduce){' + P + ' span,' + P + ' span::before,' + P + ' span::after{animation:none!important}}';
      if (!old) { old = document.createElement('style'); old.id = 'yunbi-nav-promo'; (document.head || document.documentElement).appendChild(old); }
      if (old.textContent !== css) old.textContent = css;
    } catch (e) { report('navPromo', e); }
  }
  var booted = false;
  function boot(c, fromCache) {
    cfg = normalize(c);
    navPromo();
    dbg('config ' + (fromCache ? 'önbellekten' : 'sunucudan') + ': ' + (cfg.segments || []).length + ' segment, mount=' + cfg.rules.mount + ', tam genişlik=' + !!cfg.theme.full_width);
    if (!cfg.segments || !cfg.segments.length) { dbg('segment yok'); return; }
    if (shouldHide()) { dbg('bu sayfada gizli'); return; }
    booted = true;
    try { trackVisit(); } catch (e) { report('trackVisit', e); }
    if (!mount()) return;
    bind();
    window.YunbiMenu = { open: open, close: close, refresh: render, isOpen: function () { return isOpen; }, enabled: true, diag: function () { return { v: 11, width: innerWidth, mobile: mobileOk(), mount: cfg.rules.mount, open: isOpen, cached: !!fromCache, hamburgers: document.querySelectorAll('.newMenuBtnClick').length }; } };
    try { loadPersonal(); } catch (e) { report('personal', e); }
    try { loadRecentPrices(); } catch (e) { report('prices', e); }
    if (AUTO_OPEN) open('demo');
    warm();
    dbg('hazır: hamburger=' + document.querySelectorAll('.newMenuBtnClick, .mobileMenuBtn, .navbar-toggle, .hamburger, .menu-toggle').length + ' adet bulundu, mobil=' + mobileOk());
  }
  function start() {
    dbg('script çalıştı');
    var cached = FORCE ? null : readCache();
    if (cached) boot(cached, true);
    fetch(API + '/config', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (c) {
      if (!FORCE && c && c.segments) writeCache(c);
      if (!booted) { boot(c, false); return; }
      // taze config: veriyi ve temayı sessizce güncelle
      cfg = normalize(c); tabsFrozen = null; navPromo();
      try { var st = root && root.querySelector('style'); if (st) st.textContent = css(cfg.theme); var pn = root && root.getElementById('pn'); if (pn) pn.classList.toggle('full', !!cfg.theme.full_width); } catch (e) { }
      if (isOpen) render();
      dbg('config tazelendi');
    }).catch(function (e) { if (!booted) report('config', e); else dbg('config tazelenemedi', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
