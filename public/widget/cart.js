/*!
 * Yunbi "Sepet Kampanyası" widget'ı (CRO) — yan sepet (çekmece) + sepet/checkout sayfası.
 *
 *   <script src="https://eticaretq.com/widget/cart.js?v=1" data-tenant="tonnyblack" async></script>
 *   (checkout SPA tema scriptini yüklemez → aynı satır GTM Custom HTML ile de verilir; çift yükleme korumalı)
 *
 * Ne yapar:
 *   • Kademeli kampanya çubuğu: "Ücretsiz kargo için 300,10 TL daha ekle" → "Sepette ek %5 için …" → … ;
 *     kazanılan kademeler yeşil/tik, sıradaki kademe nabız; kademe kazanılınca kısa kutlama.
 *   • Satır fiyat/indirim gösterimi: liste fiyatı üstü çizili + indirimli fiyat vurgulu + "%50" rozeti.
 *   • Sepet özeti: liste fiyatı toplamı / ürün indirimi / kampanya indirimi / kargo / toplam / "kazancın".
 *   • v2: kalan tutar BÜYÜK, sıradaki kademenin parasal değeri ("en az 125 TL ek indirim"), "Sepetini tamamla" ürün önerileri
 *     (/cart/suggest: eşiği tek başına kapatan ürünler önde, numaraya uygun) + "Ekle" ile yenilemesiz sepete ekleme
 *     (yan sepet: /api/cart/AddToCartV3 + cart.get.execute; checkout: window.checkout_addToCart). "Alışverişe devam" butonu kaldırıldı (opsiyonel).
 * Veri kaynağı: yan sepette window.cart.get.model (Ticimax globalV2), checkout'ta window.checkout_basket + 'basketUpdated'.
 * Kampanyanın kendisi mağaza panelinde tanımlıdır; widget yalnız gösterir ve ölçer. Shadow DOM, bağımsız, tek async script.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  if (window.__yunbiCartLoaded) return;
  window.__yunbiCartLoaded = true;

  var SRC = new URL(script.src);
  var BASE = SRC.origin;
  /* Tenant: data-tenant → ?t= → mağaza alan adından çözüm (Ticimax checkout SPA'sı panel scriptini enjekte ederken
     data-* özniteliklerini düşürüyor: <script data-tcmx-origin="panel" src=…> — o yüzden URL/alan adı yedekleri şart). */
  var TENANT = script.getAttribute('data-tenant') || SRC.searchParams.get('t') || SRC.searchParams.get('tenant') || '';
  var API = '';
  var IS_HUB = location.origin === BASE;
  var DEBUG = /[?&]yunbi_debug=1/.test(location.search);
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-cart]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var T = null, R = null, TIERS = [];
  var SURFACE = 'side';
  var IKAS = false;            // ikas vitrini (Next.js) — ayrı veri/yerleşim dalı
  var lastReached = null;      // kutlama için son bilinen kazanılmış kademe sayısı
  var viewSent = {};           // surface → view gönderildi mi
  var updTimer = null;

  function qs(s, el) { try { return (el || document).querySelector(s); } catch (e) { return null; } }
  function qsa(s, el) { try { return [].slice.call((el || document).querySelectorAll(s)); } catch (e) { return []; } }
  function device() { return window.innerWidth <= (R.max_width || 991) ? 'm' : 'd'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { v = parseFloat(v); return isFinite(v) ? v : 0; }
  function rgba(hex, a) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')' : 'rgba(0,0,0,' + a + ')'; }

  /* Para: 1300.1 → "1.300,10 TL" (Ticimax "₺1.199,90" biçimi currency='₺' ile) */
  function money(n) {
    n = Math.round(num(n) * 100) / 100;
    var neg = n < 0; n = Math.abs(n);
    var parts = n.toFixed(2).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var s = int + ',' + parts[1];
    var cur = (R.currency || 'TL').trim();
    s = cur === '₺' ? '₺' + s : s + ' ' + cur;
    return (neg ? '-' : '') + s;
  }
  function moneyShort(n) { // etiketler: 1.500 TL (kuruş yoksa)
    n = num(n); var s = (Math.round(n) === n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : money(n).replace(/ ?TL$|^₺/g, '');
    var cur = (R.currency || 'TL').trim();
    return cur === '₺' ? '₺' + s : s + ' ' + cur;
  }
  function tpl(s, vars) { return String(s || '').replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; }); }

  function send(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, surface: SURFACE, sid: SID, path: location.pathname, device: device() }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) {}
  }

  /* ── Kademe hesabı ── */
  function computeState(basis) {
    var reached = [], next = null;
    for (var i = 0; i < TIERS.length; i++) { if (basis + 0.005 >= TIERS[i].threshold) reached.push(TIERS[i]); else if (!next) next = TIERS[i]; }
    var remaining = next ? Math.max(0, next.threshold - basis) : 0;
    // çubuk dolumu: her kademe arası eşit uzunlukta bir dilim, dilim içi doğrusal
    var n = TIERS.length, pct = 0;
    if (n) {
      var seg = reached.length;
      if (seg >= n) pct = 100;
      else {
        var prev = seg ? TIERS[seg - 1].threshold : 0, th = TIERS[seg].threshold;
        pct = (seg + Math.max(0, Math.min(1, (basis - prev) / (th - prev)))) / n * 100;
      }
    }
    return { basis: basis, reached: reached, next: next, remaining: remaining, pct: pct, all: n > 0 && reached.length === n, shippingFree: reached.some(function (t) { return t.type === 'shipping'; }) };
  }

  var ICON_TRUCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>';
  var ICON_GIFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7c-2-3-6-3-6 0h6zM12 7c2-3 6-3 6 0h-6z"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_TAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>';
  /* Sıradaki kademenin parasal karşılığı: "%5 → en az 125 TL ek indirim", "kargo ücreti bedava" */
  function tierValue(t) {
    if (!t) return '';
    if (t.type === 'percent' && num(t.value) > 0) return 'En az ' + moneyShort(Math.floor(t.threshold * num(t.value) / 100)) + ' ek indirim';
    if (t.type === 'amount' && num(t.value) > 0) return moneyShort(t.value) + ' indirim';
    if (t.type === 'shipping') return num(R.shipping_fee) > 0 ? moneyShort(R.shipping_fee) + ' kargo ücreti bedava' : 'Kargo ücreti ödemezsin';
    if (t.type === 'gift') return 'Hediye ürün';
    return '';
  }
  function tierIcon(t) { return t.type === 'shipping' ? ICON_TRUCK : t.type === 'gift' ? ICON_GIFT : '<i>' + esc(t.short) + '</i>'; }

  /* ── CSS (shadow) ── */
  function barCss() {
    var t = T;
    return ':host{all:initial;display:block;width:100%;box-sizing:border-box;font-family:' + (t.font ? t.font + ',' : '') + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;--acc:' + t.accent + ';--acc2:' + t.accent2 + ';--ok:' + t.ok + ';--ink:' + t.ink + ';--mut:' + t.muted + ';--bg:' + t.bg + ';--trk:' + t.track + ';--badge:' + (t.badge_color || '#dc2626') + ';--r:' + (t.radius || 0) + 'px;--ok10:' + rgba(t.ok, .1) + ';--acc210:' + rgba(t.accent2, .12) + '}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      '.yc{position:relative;overflow:hidden;background:var(--bg);border:1px solid #e9ebef;border-radius:var(--r);padding:13px 16px 12px;box-shadow:0 1px 2px rgba(17,24,39,.04);color:var(--ink);-webkit-font-smoothing:antialiased}' +
      '.yc.flat{border:0;box-shadow:none;padding:8px 0 4px;border-radius:0}' +
      '.hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}' +
      '.ttl{font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--mut)}' +
      '.sv{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:var(--ok);background:var(--ok10);border-radius:99px;padding:3px 9px;white-space:nowrap}' +
      '.sv svg{width:12px;height:12px}' +
      '.msg{font-size:13.5px;line-height:1.4;color:var(--ink);margin-bottom:14px}' +
      '.msg b{font-weight:800}.msg .rem{color:var(--acc2);font-weight:800}.msg .okl{color:var(--ok);font-weight:800}' +
      '.msg .l2{display:block;margin-top:2px}' +
      '.msg .tick{display:inline-flex;width:15px;height:15px;border-radius:50%;background:var(--ok);color:#fff;vertical-align:-3px;margin-right:4px;align-items:center;justify-content:center}.msg .tick svg{width:9px;height:9px}' +
      '.trk{position:relative;height:6px;background:var(--trk);border-radius:99px;margin:6px 16px 40px 6px}' +
      '.fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,var(--acc),var(--acc2));transition:width .7s cubic-bezier(.22,1,.36,1)}' +
      '.yc.all .fill{background:var(--ok)}' +
      '.ms{position:absolute;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center}' +
      '.dot{width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #cfd4dc;color:var(--mut);display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;line-height:1;transition:all .3s}' +
      '.dot svg{width:14px;height:14px}.dot i{font-style:normal;letter-spacing:-.2px}' +
      '.ms.done .dot{background:var(--ok);border-color:var(--ok);color:#fff}' +
      '.ms.next .dot{border-color:var(--acc2);color:var(--acc2);box-shadow:0 0 0 0 var(--acc210);animation:yp 1.8s ease-out infinite}' +
      '@keyframes yp{0%{box-shadow:0 0 0 0 ' + rgba(t.accent2, .45) + '}70%{box-shadow:0 0 0 9px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}' +
      '.lb{position:absolute;top:31px;white-space:nowrap;text-align:center;line-height:1.15;font-size:10.5px;color:var(--mut)}' +
      '.lb b{display:block;font-weight:800;font-size:10.5px;color:var(--mut)}' +
      '.ms.done .lb b{color:var(--ok)}.ms.next .lb b{color:var(--ink)}.ms.next .lb{color:var(--ink)}' +
      '.ms:first-child .lb{}' +
      '.l1{display:block;font-size:12.5px;color:var(--mut);margin-bottom:3px}.l1 .okl{color:var(--ok)}' +
      '.big{display:block;font-size:14.5px;line-height:1.35;font-weight:600;color:var(--ink)}' +
      '.big .rem{font-size:21px;font-weight:900;color:var(--acc2);letter-spacing:-.4px;font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.val{display:inline-flex;align-items:center;gap:6px;margin-top:7px;font-size:12px;font-weight:700;color:var(--ok);background:var(--ok10);border-radius:8px;padding:4px 9px;line-height:1.25}' +
      '.val svg{width:12px;height:12px;flex:none}' +
      '.sg{margin-top:2px;border-top:1px dashed #e5e7eb;padding-top:10px}' +
      '.sgh{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:800;color:var(--ink);margin-bottom:8px}' +
      '.sgh span{flex:1;min-width:0}.sgh small{font-weight:600;color:var(--mut);font-size:11px;white-space:nowrap}' +
      '.sgr{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.sgr::-webkit-scrollbar{display:none}' +
      '.cd{flex:0 0 122px;scroll-snap-align:start;border:1px solid #eceef2;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column;position:relative;box-shadow:0 1px 2px rgba(17,24,39,.04)}' +
      '.yc.co .cd{flex-basis:150px}' +
      '.cd.ul{border-color:var(--ok);box-shadow:0 0 0 1px var(--ok10)}' +
      '.cd .im{display:block;position:relative;aspect-ratio:3/4;background:#f3f4f6;overflow:hidden}.cd .im img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.cd .ub{position:absolute;top:6px;left:6px;right:6px;background:var(--ok);color:#fff;font-size:9.5px;font-weight:800;border-radius:6px;padding:3px 6px;line-height:1.2;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.18)}' +
      '.cd .pc{position:absolute;left:6px;bottom:6px;background:var(--badge);color:#fff;font-size:10px;font-weight:800;border-radius:6px;padding:2px 6px;line-height:1.2}' +
      '.cd .nm{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;line-height:1.3;color:var(--ink);padding:6px 7px 0;height:35px;text-decoration:none}' +
      '.cd .pr{padding:4px 7px 0;font-size:13px;font-weight:800;color:var(--ok);font-variant-numeric:tabular-nums;white-space:nowrap}.cd .pr s{color:var(--mut);font-weight:400;font-size:10.5px;margin-right:4px}' +
      '.cd .sz{font-size:10px;color:var(--mut);padding:1px 7px 0;min-height:13px}' +
      '.cd .ad{margin:6px 7px 7px;border:0;border-radius:8px;background:var(--acc);color:#fff;font-size:11.5px;font-weight:800;padding:7px 0;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-family:inherit;line-height:1}' +
      '.cd .ad svg{width:12px;height:12px}.cd .ad.busy{opacity:.55;pointer-events:none}.cd .ad.ok{background:var(--ok)}' +
      '.sgl{font-size:11.5px;color:var(--mut);padding:6px 0}' +
      '.ft{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}' +
      '.cta{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--ink);text-decoration:none;border:1px solid #e5e7eb;border-radius:99px;padding:6px 12px;transition:all .2s;background:#fff}' +
      '.cta:hover{border-color:var(--ink)}.cta svg{width:13px;height:13px}' +
      '.yc.all .msg .all{color:var(--ok)}' +
      '.cf{position:absolute;width:7px;height:7px;border-radius:2px;pointer-events:none;animation:yc 1.1s ease-out forwards}' +
      '@keyframes yc{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(280deg);opacity:0}}' +
      '@media (max-width:480px){.yc{padding:11px 12px 8px}.msg{font-size:13px;margin-bottom:10px}.trk{margin-bottom:36px}.lb{font-size:10px}.lb b{font-size:10px}.trk{margin:6px 14px 38px 4px}.big{font-size:14px}.big .rem{font-size:20px}}' +
      '@media (prefers-reduced-motion:reduce){.ms.next .dot{animation:none}.fill{transition:none}.cf{display:none}}';
  }
  function sumCss() {
    var t = T;
    return ':host{all:initial;display:block;width:100%;box-sizing:border-box;font-family:' + (t.font ? t.font + ',' : '') + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;--ok:' + t.ok + ';--ink:' + t.ink + ';--mut:' + t.muted + ';--acc2:' + t.accent2 + ';--ok10:' + rgba(t.ok, .1) + '}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      '.ys{color:var(--ink);text-transform:none;letter-spacing:0;font-weight:400;-webkit-font-smoothing:antialiased;border-top:1px dashed #e5e7eb;padding-top:6px}' +
      '.ys:empty{display:none}.ys-h{font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--mut);padding:2px 0 4px}' +
      '.rw.ok.tot .v{font-size:15px}' +
      '.rw{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:4px 0;font-size:13px;color:var(--mut)}' +
      '.rw .v{font-weight:600;color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.rw.ok .v,.rw.ok .k{color:var(--ok);font-weight:700}' +
      '.rw.tot{border-top:1px solid #eceef2;margin-top:4px;padding-top:8px;font-size:14px;color:var(--ink);font-weight:800}.rw.tot .v{font-size:18px;font-weight:800}' +
      '.rw .k small{display:block;font-size:11px;color:var(--mut);font-weight:400}' +
      '.rw .v s{color:var(--mut);font-weight:400;font-size:12px;margin-right:6px}' +
      '.sv{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;font-size:12px;font-weight:800;color:var(--ok);background:var(--ok10);border-radius:8px;padding:6px 10px}.sv svg{width:13px;height:13px}' +
      '.rw.ship .v.free{color:var(--ok);font-weight:800}.rw.ship .v.left{color:var(--acc2);font-weight:700;font-size:12px}';
  }

  /* ── Çubuk ── */
  function buildBar() {
    var host = document.createElement('div');
    host.id = 'yunbi-cart-bar';
    host.setAttribute('data-yunbi', '1');
    host.style.cssText = 'display:block!important;width:100%!important;max-width:100%!important;position:static;float:none!important;clear:both!important;margin:0 0 12px!important;padding:0!important;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = barCss(); root.appendChild(st);
    var box = document.createElement('div'); box.className = 'yc' + (T.style === 'flat' ? ' flat' : '') + (SURFACE === 'checkout' ? ' co' : ''); root.appendChild(box);
    return { host: host, root: root, box: box, state: null, lastHtml: '', lastData: null };
  }

  function renderBar(bar, data) {
    var s = computeState(data.basis);
    var box = bar.box;
    bar.lastData = data;
    box.classList.toggle('all', s.all);
    var vars = function (t) { return { label: t ? t.label : '', short: t ? t.short : '', threshold: t ? moneyShort(t.threshold) : '', remaining: money(s.remaining) }; };
    var msg;
    if (!TIERS.length) msg = '';
    else if (data.items === 0 || s.basis <= 0) msg = '<span class="big">' + esc(tpl(R.msg_empty, vars(TIERS[0]))) + '</span>';
    else if (s.all) msg = '<span class="big all"><span class="tick">' + ICON_CHECK + '</span>' + esc(tpl(R.msg_all, vars(s.reached[s.reached.length - 1]))) + '</span>';
    else {
      var nx = tpl(R.msg_next, vars(s.next));
      nx = esc(nx).replace(esc(s.next.label), '<b>' + esc(s.next.label) + '</b>').replace(esc(money(s.remaining)), '<span class="rem">' + esc(money(s.remaining)) + '</span>');
      var l1 = '';
      if (s.reached.length) {
        var last = s.reached[s.reached.length - 1];
        l1 = '<span class="l1"><span class="tick">' + ICON_CHECK + '</span>' + esc(tpl(R.msg_reached, vars(last))).replace(esc(last.label), '<span class="okl">' + esc(last.label) + '</span>') + '</span>';
      }
      var val = R.show_value !== false ? tierValue(s.next) : '';
      msg = l1 + '<span class="big">' + nx + '</span>' + (val ? '<span class="val">' + ICON_TAG + esc(val) + '</span>' : '');
    }
    var savings = R.show_savings && data.savings > 0.5 ? '<span class="sv">' + ICON_CHECK + 'Kazancın ' + esc(money(data.savings)) + '</span>' : '';
    var ms = TIERS.map(function (t, i) {
      var cls = s.reached.indexOf(t) >= 0 ? 'done' : (s.next === t ? 'next' : '');
      return '<div class="ms ' + cls + '" style="left:' + ((i + 1) / TIERS.length * 100) + '%"><div class="dot">' + (cls === 'done' ? ICON_CHECK : tierIcon(t)) + '</div><div class="lb"><b>' + esc(t.short) + '</b>' + (t.threshold > 1 ? esc(moneyShort(t.threshold)) : (t.type === 'shipping' ? 'Ücretsiz' : 'Herkese')) + '</div></div>';
    }).join('');
    var cta = (R.show_cta && !s.all && R.cta_text) ? '<a class="cta" href="' + esc(R.cta_url || '/') + '">' + esc(R.cta_text) + ICON_ARROW + '</a>' : '';
    var sg = SURFACE === 'side' ? '' : suggestHtml(data, s);
    var html = '<div class="hd"><span class="ttl">' + esc(R.title || '') + '</span>' + savings + '</div>' +
      '<div class="msg">' + msg + '</div>' +
      '<div class="trk"><div class="fill" style="width:' + (bar.state ? bar.state.pct : 0) + '%"></div>' + ms + '</div>' +
      sg + (cta ? '<div class="ft"><span></span>' + cta + '</div>' : '');
    if (html !== bar.lastHtml) {
      bar.lastHtml = html;
      box.innerHTML = html;
      var a = box.querySelector('.cta'); if (a) a.addEventListener('click', function () { send('cta', evPayload(s, data)); });
      bindSuggest(bar, data, s);
    }
    // dolumu bir kare sonra hedefe götür (geçiş animasyonu)
    var fill = box.querySelector('.fill');
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (fill) fill.style.width = s.pct + '%'; }); });

    // kutlama + unlock olayı (yalnız kazanılan sayı ARTINCA)
    var prev = lastReached; if (prev == null) { try { prev = parseInt(sessionStorage.getItem('yunbi_cart_tier') || '', 10); } catch (e) {} }
    if (prev != null && !isNaN(prev) && s.reached.length > prev) {
      if (T.celebrate) celebrate(box, s.reached.length);
      send('unlock', Object.assign(evPayload(s, data), { tier: s.reached.length, value: s.reached[s.reached.length - 1].label }));
    }
    lastReached = s.reached.length;
    try { sessionStorage.setItem('yunbi_cart_tier', String(s.reached.length)); } catch (e) {}
    bar.state = s;
    if (SURFACE === 'side') renderSideSuggest(data, s);
    fetchSuggest(bar, data, s);
    return s;
  }
  /* Yan sepet: öneri şeridi ürün satırlarının ALTINDA ayrı bir kutu (çekmecenin küçük kaydırma alanında adet +/− butonları en üstte kalsın) */
  var sideSg = null;
  function renderSideSuggest(data, s) {
    var drawer = qs('#globalLiteCart'); if (!drawer) return;
    var html = suggestHtml(data, s);
    if (!html) { if (sideSg && sideSg.host.parentNode) sideSg.host.parentNode.removeChild(sideSg.host); if (sideSg) sideSg.lastHtml = ''; return; }
    if (!sideSg) {
      var host = document.createElement('div'); host.id = 'yunbi-cart-suggest'; host.setAttribute('data-yunbi', '1');
      host.style.cssText = 'display:block!important;width:100%!important;max-width:100%!important;position:static;float:none!important;clear:both!important;margin:10px 0 4px!important;padding:0!important;';
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var st = document.createElement('style'); st.textContent = barCss() + '.yc.sg-only{padding:10px 12px 6px}.yc.sg-only .sg{border-top:0;padding-top:0;margin-top:0}'; root.appendChild(st);
      var box = document.createElement('div'); box.className = 'yc sg-only' + (T.style === 'flat' ? ' flat' : ''); root.appendChild(box);
      sideSg = { host: host, root: root, box: box, lastHtml: '' };
    }
    var content = qs('.miniCartContent', drawer) || drawer;
    if (!sideSg.host.isConnected || sideSg.host.parentNode !== content) content.appendChild(sideSg.host);
    else if (sideSg.host !== content.lastElementChild) content.appendChild(sideSg.host);
    if (html !== sideSg.lastHtml) { sideSg.lastHtml = html; sideSg.box.innerHTML = html; bindSuggest(sideSg, data, s); }
  }

  /* ── "Sepetini tamamla" ürün önerileri ── */
  var SG = { key: '', items: null, loading: '', cache: {}, sent: {}, holdUntil: 0, holdItems: {}, added: {} };
  function suggestOn(data, s) {
    if (!R.suggest_enabled || !TIERS.length || !(data.items > 0)) return false;
    if (SURFACE === 'checkout' ? R.suggest_checkout === false : R.suggest_side === false) return false;
    if (s.all && R.suggest_hide_all !== false) return false;
    return true;
  }
  function suggestKey(data) { return SURFACE + '|' + (data.lines || []).map(function (l) { return (l.p || '') + ':' + (l.v || '') + ':' + (l.b || ''); }).join(','); }
  function unitPrice(it) { return num(it.discounted) || num(it.price); }
  function suggestItems(data, s) {
    var key = suggestKey(data), list = SG.cache[key]; if (!list) return null;
    var max = Math.max(2, Math.min(8, parseInt(R.suggest_max, 10) || 4));
    var inCart = {}; (data.lines || []).forEach(function (l) { if (l.v) inCart['v' + l.v] = 1; if (l.p) inCart['p' + l.p] = 1; });
    var arr = list.filter(function (it) { return !inCart['v' + it.variant_id] && !inCart['p' + it.pid]; }).map(function (it) { return Object.assign({}, it, { unlocks: s.next ? unitPrice(it) + 0.005 >= s.remaining : false }); });
    arr.sort(function (a, b) { if (a.unlocks !== b.unlocks) return a.unlocks ? -1 : 1; return a.unlocks ? unitPrice(a) - unitPrice(b) : unitPrice(b) - unitPrice(a); });
    return arr.slice(0, max);
  }
  // ikas: "+Ekle" sonrası liste 3,5 sn sabit kalır (sepet yanıtı gelince boşalıp yeniden çizilmesin) ve eklenen kart "Eklendi" kalır
  function currentItems(data, s) {
    if (IKAS && SG.holdUntil > Date.now() && SG.holdItems[SURFACE]) return SG.holdItems[SURFACE];
    var items = suggestItems(data, s);
    if (IKAS && items && items.length) SG.holdItems[SURFACE] = items;
    return items;
  }
  function wasAdded(it) { return IKAS && SG.added[it.id] && Date.now() - SG.added[it.id] < 4000; }
  function suggestHtml(data, s) {
    if (!suggestOn(data, s)) return '';
    var items = currentItems(data, s);
    var head = '<div class="sgh"><span>' + esc(R.suggest_title || 'Sepetini tamamla') + '</span>' + (s.next ? '<small>' + esc(money(s.remaining)) + ' kaldı</small>' : '') + '</div>';
    if (items === null) return SG.loading === suggestKey(data) ? '<div class="sg">' + head + '<div class="sgl">Sana uygun ürünler seçiliyor…</div></div>' : '';
    if (!items.length) return '';
    var ul = s.next ? tpl(R.suggest_unlock || 'Bunu ekle → {label}', { label: s.next.label, short: s.next.short, threshold: moneyShort(s.next.threshold), remaining: money(s.remaining) }) : '';
    var cards = items.map(function (it, i) {
      var pct = pctBadge(it.price, it.discounted), up = unitPrice(it);
      return '<div class="cd' + (it.unlocks ? ' ul' : '') + '" data-i="' + i + '">' +
        '<a class="im" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '') + (pct > 0 ? '<span class="pc">%' + pct + '</span>' : '') + '</a>' +
        (it.unlocks && ul ? '<span class="ub">' + esc(ul) + '</span>' : '') +
        '<a class="nm" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a>' +
        '<div class="pr">' + (pct > 0 ? '<s>' + esc(money(it.price)) + '</s>' : '') + esc(money(up)) + '</div>' +
        '<div class="sz">' + (it.size ? 'Numara ' + esc(it.size) : '') + (it.low_stock ? ' · son ' + esc(it.low_stock) : '') + '</div>' +
        (wasAdded(it) ? '<button type="button" class="ad ok" data-i="' + i + '">' + ICON_CHECK + 'Eklendi</button>' : '<button type="button" class="ad" data-i="' + i + '">' + ICON_PLUS + 'Ekle</button>') + '</div>';
    }).join('');
    return '<div class="sg">' + head + '<div class="sgr">' + cards + '</div></div>';
  }
  function fetchSuggest(bar, data, s) {
    if (!suggestOn(data, s)) return;
    var key = suggestKey(data);
    if (SG.cache[key] || SG.loading === key) return;
    SG.loading = key;
    var done = function (list) {
      SG.cache[key] = list || [];
      if (SG.loading === key) SG.loading = '';
      if (bar.lastData && suggestKey(bar.lastData) === key) { renderBar(bar, bar.lastData); var its = suggestItems(bar.lastData, bar.state); if (its && its.length && !SG.sent[key]) { SG.sent[key] = 1; send('suggest', Object.assign(evPayload(bar.state, bar.lastData), { value: its.map(function (it) { return it.id; }).join(',') })); } }
    };
    if (IS_HUB && window.__yunbiCartDemo && window.__yunbiCartDemo.suggest) { setTimeout(function () { done(window.__yunbiCartDemo.suggest(data)); }, 250); return; }
    var q = 'items=' + encodeURIComponent((data.lines || []).map(function (l) { return (l.p || '') + ':' + (l.v || '') + ':' + (l.q || 1) + ':' + (l.b || ''); }).join(',')) + '&remaining=' + encodeURIComponent(Math.round(s.remaining * 100) / 100) + '&surface=' + SURFACE;
    var m = data.member || memberId(); if (m) q += '&member=' + encodeURIComponent(m);
    fetch(API + '/suggest?' + q, { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { done(j && j.items); }).catch(function () { done([]); });
  }
  function memberId() { try { var g = window.globalModel; if (g && g.memberId) return String(g.memberId); var c = document.cookie.match(/(?:^|; )UyeId=(\d+)/); return c ? c[1] : ''; } catch (e) { return ''; } }
  function bindSuggest(bar, data, s) {
    var items = currentItems(data, s); if (!items) return;
    qsa('.cd .ad', bar.box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var it = items[parseInt(btn.getAttribute('data-i'), 10)]; if (!it || btn.classList.contains('busy') || btn.classList.contains('ok')) return;
        btn.classList.add('busy'); btn.innerHTML = '…';
        var before = evPayload(s, data);
        addToCart(it, function (ok) {
          if (ok) { btn.classList.remove('busy'); btn.classList.add('ok'); btn.innerHTML = ICON_CHECK + 'Eklendi'; send('add', Object.assign(before, { value: String(it.id) })); }
          else { btn.classList.remove('busy'); btn.innerHTML = ICON_PLUS + 'Ekle'; send('add_fail', Object.assign(before, { value: String(it.id) })); try { window.open(it.url, '_blank'); } catch (e) {} }
        });
      });
    });
  }
  function restAdd(it, cb) {
    var vid = parseInt(it.variant_id, 10) || 0, pid = parseInt(it.pid, 10) || 0;
    if (!vid) return cb(false);
    fetch('/api/cart/AddToCartV3', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ AsortiUrunKartId: 0, KampanyaId: 0, BagliUrunId: 0, UrunKartId: pid, UrunId: vid, Adet: 1, UrunNot: '', AssortmentQuantities: [] }) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { cb(!!(j && !j.isError)); }).catch(function () { cb(false); });
  }
  function addToCart(it, cb) {
    if (IS_HUB && window.__yunbiCartDemo && window.__yunbiCartDemo.add) { setTimeout(function () { cb(window.__yunbiCartDemo.add(it) !== false); }, 400); return; }
    if (IKAS) return ikasAdd(it, cb);
    if (SURFACE === 'checkout') {
      var vid = parseInt(it.variant_id, 10) || 0;
      if (typeof window.checkout_addToCart === 'function' && vid) {
        try { window.checkout_addToCart({ productId: vid, quantity: 1 }); } catch (e) { return restAdd(it, function (ok) { if (ok) setTimeout(function () { location.reload(); }, 600); cb(ok); }); }
        var n0 = 0; try { n0 = (window.checkout_basket.products || []).length; } catch (e) {}
        var tries = 40, t = setInterval(function () { var h = window.checkout_basket, has = false; try { has = !!(h && h.products && (h.products.length > n0 || h.products.some(function (p) { return String(p.productId || p.id) === String(vid); }))); } catch (e) {} if (has || --tries <= 0) { clearInterval(t); cb(has); } }, 250);
        return;
      }
      return restAdd(it, function (ok) { if (ok) setTimeout(function () { location.reload(); }, 600); cb(ok); });
    }
    restAdd(it, function (ok) {
      if (!ok) return cb(false);
      // yan sepet modelini tazele + çekmeceyi yeniden çiz (tema kancası → sideRender)
      try {
        var c = window.cart;
        if (c && c.get && typeof c.get.execute === 'function') {
          c.get.model = null;
          var fired = false, fin = function () { if (fired) return; fired = true; try { c.render && c.render.rightSide && c.render.rightSide(); } catch (e) {} setTimeout(sideRender, 80); cb(true); };
          c.get.execute(false, fin); setTimeout(fin, 6000);
          return;
        }
      } catch (e) {}
      setTimeout(function () { location.reload(); }, 600); cb(true);
    });
  }
  function evPayload(s, data) { return { basis: Math.round(s.basis * 100) / 100, tier: s.reached.length, remaining: Math.round(s.remaining * 100) / 100, items: data.items || 0 }; }
  function celebrate(box, n) {
    var ms = box.querySelectorAll('.ms')[n - 1]; if (!ms) return;
    var r = ms.getBoundingClientRect(), b = box.getBoundingClientRect();
    var cols = [T.ok, T.accent2, T.accent, '#3b82f6', '#ec4899'];
    for (var i = 0; i < 16; i++) {
      var p = document.createElement('span'); p.className = 'cf';
      var ang = Math.random() * Math.PI * 2, d = 30 + Math.random() * 50;
      p.style.cssText = 'left:' + (r.left - b.left + r.width / 2) + 'px;top:' + (r.top - b.top + r.height / 2) + 'px;background:' + cols[i % cols.length] + ';--dx:' + (Math.cos(ang) * d) + 'px;--dy:' + (Math.sin(ang) * d - 20) + 'px;animation-delay:' + (Math.random() * .15) + 's';
      box.appendChild(p);
      setTimeout(function (el) { return function () { if (el.parentNode) el.parentNode.removeChild(el); }; }(p), 1400);
    }
  }
  function trackView(s, data) {
    if (!viewSent[SURFACE]) { viewSent[SURFACE] = true; trackView.last = JSON.stringify(evPayload(s, data)); send('view', evPayload(s, data)); return; }
    var pl = evPayload(s, data), key = JSON.stringify(pl);
    if (key === trackView.last) return; trackView.last = key;
    clearTimeout(updTimer); updTimer = setTimeout(function () { send('update', pl); }, 1500);
  }

  /* ── Özet ── */
  function buildSummary(id, pad) {
    var host = document.createElement('div');
    host.id = id; host.setAttribute('data-yunbi', '1');
    host.style.cssText = 'display:block!important;width:100%!important;max-width:100%!important;position:static;float:none!important;clear:both!important;margin:0!important;padding:' + (pad || '0') + '!important;text-align:left!important;box-sizing:border-box!important;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = sumCss(); root.appendChild(st);
    var box = document.createElement('div'); box.className = 'ys'; root.appendChild(box);
    return { host: host, box: box };
  }
  function campRows(data) {
    var cs = data.camps && data.camps.length ? data.camps : (data.campaignDiscount > 0.005 ? [{ label: data.campaignLabel || 'Kampanya indirimi', value: data.campaignDiscount }] : []);
    return cs.filter(function (c) { return c.value > 0.005; }).map(function (c) { return '<div class="rw ok"><span class="k">' + esc(c.label) + '</span><span class="v">-' + esc(money(c.value)) + '</span></div>'; });
  }
  function renderSummary(sum, data, s, withTotal, withShip) {
    var rows = [];
    if (SURFACE === 'side') { // kompakt: çekmecenin sabit alt bloğu ürün listesini yemesin
      if (data.listTotal > data.cartTotal + 0.005) rows.push('<div class="rw ok"><span class="k">Ürün indirimi<small>liste fiyatı ' + esc(money(data.listTotal)) + '</small></span><span class="v">-' + esc(money(data.listTotal - data.cartTotal)) + '</span></div>');
      campRows(data).forEach(function (r) { rows.push(r); });
      if (data.voucher > 0.005) rows.push('<div class="rw ok"><span class="k">Hediye çeki</span><span class="v">-' + esc(money(data.voucher)) + '</span></div>');
      var sh = null; for (var j = 0; j < TIERS.length; j++) if (TIERS[j].type === 'shipping') { sh = TIERS[j]; break; }
      if (sh && data.items > 0) rows.push(s.shippingFree || data.freeCargo ? '<div class="rw ship"><span class="k">Kargo</span><span class="v free">Ücretsiz</span></div>' : '<div class="rw ship"><span class="k">Kargo</span><span class="v left">' + esc(money(Math.max(0, sh.threshold - data.basis))) + ' kaldı</span></div>');
      if (R.show_savings && data.savings > 0.5) rows.push('<div class="rw ok tot"><span class="k">Bu sepette kazancın</span><span class="v">' + esc(money(data.savings)) + '</span></div>');
      sum.box.innerHTML = rows.length ? '<div class="ys-h">Sepet özeti</div>' + rows.join('') : '';
      return;
    }
    if (data.listTotal > data.cartTotal + 0.005) {
      rows.push('<div class="rw"><span class="k">Ürünlerin liste fiyatı</span><span class="v">' + esc(money(data.listTotal)) + '</span></div>');
      rows.push('<div class="rw ok"><span class="k">Ürün indirimi</span><span class="v">-' + esc(money(data.listTotal - data.cartTotal)) + '</span></div>');
    } else rows.push('<div class="rw"><span class="k">Ürünler</span><span class="v">' + esc(money(data.cartTotal)) + '</span></div>');
    campRows(data).forEach(function (r) { rows.push(r); });
    if (data.voucher > 0.005) rows.push('<div class="rw ok"><span class="k">Hediye çeki</span><span class="v">-' + esc(money(data.voucher)) + '</span></div>');
    var shipTier = null; for (var i = 0; i < TIERS.length; i++) if (TIERS[i].type === 'shipping') { shipTier = TIERS[i]; break; }
    if (withShip && shipTier && data.items > 0) {
      if (s.shippingFree || data.freeCargo) rows.push('<div class="rw ship"><span class="k">Kargo</span><span class="v free">Ücretsiz</span></div>');
      else rows.push('<div class="rw ship"><span class="k">Kargo<small>' + esc(moneyShort(shipTier.threshold)) + ' üzeri ücretsiz</small></span><span class="v left">' + esc(money(Math.max(0, shipTier.threshold - data.basis))) + ' kaldı</span></div>');
    }
    if (withTotal) rows.push('<div class="rw tot"><span class="k">Toplam</span><span class="v">' + esc(money(data.total)) + '</span></div>');
    if (R.show_savings && data.savings > 0.5) rows.push('<div class="sv">' + ICON_CHECK + 'Bu sepette toplam kazancın ' + esc(money(data.savings)) + '</div>');
    sum.box.innerHTML = rows.join('');
  }

  /* ── Yerleştirme: "prepend:SEL, append:SEL, before:SEL, after:SEL" — ilk GÖRÜNÜR aday ── */
  function placeHost(spec, host, scope, allowHidden) {
    var cands = String(spec || '').split(',');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i].trim(); if (!c) continue;
      var mode = 'before', sel = c, m = /^(before|after|prepend|append):(.+)$/i.exec(c);
      if (m) { mode = m[1].toLowerCase(); sel = m[2].trim(); }
      var nodes = qsa(sel, scope);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (!allowHidden && !el.offsetParent && el !== document.body && getComputedStyle(el).position !== 'fixed') continue;
        try {
          if (mode === 'before') el.parentNode.insertBefore(host, el);
          else if (mode === 'after') el.parentNode.insertBefore(host, el.nextSibling);
          else if (mode === 'prepend') el.insertBefore(host, el.firstChild);
          else el.appendChild(host);
          return true;
        } catch (e) {}
      }
    }
    return false;
  }
  function pageStyle(id, css) {
    var el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
  }
  function pctBadge(sell, cart) {
    sell = num(sell); cart = num(cart);
    if (sell <= 0 || (IKAS && cart <= 0) || cart >= sell - 0.005) return 0; // indirimli fiyat yoksa (ikas: discounted=null) rozet yok
    return Math.round((1 - cart / sell) * 100);
  }

  /* Satır rozeti: ürün indirimi ile sepet kampanyası AYRI — "%50 indirim + sepette %10".
     prodDisc = ürünün kampanyasız indirimli fiyatı (checkout: discountPriceWithVat); yoksa kazanılmış yüzde kademesinden geri hesaplanır. */
  function campPct(basis) { var v = 0, st = computeState(basis); st.reached.forEach(function (t) { if (t.type === 'percent' && num(t.value) > v) v = num(t.value); }); return v; }
  function splitLine(sell, cart, prodDisc, v) {
    sell = num(sell); cart = num(cart); prodDisc = num(prodDisc);
    if (sell <= 0 || cart <= 0) return { p: 0, c: 0, base: cart };
    if (prodDisc > 0 && prodDisc <= sell + 0.01 && prodDisc >= cart - 0.01) {
      return { p: pctBadge(sell, prodDisc), c: cart < prodDisc - 0.005 ? Math.round((1 - cart / prodDisc) * 100) : 0, base: prodDisc };
    }
    if (v > 0) { var base = cart / (1 - v / 100); if (base <= sell + 0.01 && base > cart + 0.005) return { p: pctBadge(sell, base), c: v, base: base }; }
    return { p: pctBadge(sell, cart), c: 0, base: cart };
  }
  /* 1 Alana 1 Bedava (X al Y öde) — Ticimax en ucuz ürün(ler)i bedava yapar, sepet kademesini (%5/%10) 1+1 DÜŞÜLMÜŞ tutara uygular.
     Ürün tespiti: kategori adı / özel alan 1 (bogo_match, varsayılan "1 ALANA 1 BEDAVA") veya kategori id (bogo_categories). */
  function bogoRe() { var m = R.bogo_match == null ? '1 ALANA 1 BEDAVA' : String(R.bogo_match); return m ? new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i') : null; }
  function bogoLabel() { return R.bogo_label || '1 Alana 1 Bedava'; }
  function isBogo(p) {
    if (!p || R.bogo_enabled === false) return false;
    var ids = String(R.bogo_categories || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (ids.length && ids.indexOf(String(p.categoryId)) >= 0) return true;
    var re = bogoRe(); if (!re) return false;
    var tx = [p.categori, p.specialField1];
    (p.categories || []).forEach(function (c) { tx.push(c && c.name); });
    (p.specialAreas || []).forEach(function (a) { tx.push(a && a.value); });
    for (var i = 0; i < tx.length; i++) if (tx[i] && re.test(String(tx[i]))) return true;
    return false;
  }
  /* bedava olacak birimler: tüm 1+1 birimleri artan fiyata dizilir, ilk floor(n/2) tanesi */
  function bogoDiscount(units) { units = units.slice().sort(function (a, b) { return a - b; }); var d = 0, k = Math.floor(units.length / 2); for (var i = 0; i < k; i++) d += units[i]; return d; }
  /* checkout kampanya tanımı sepet kademesi mi? (tanımda kademe yüzdesi geçiyor ya da tutarı kademe yüzdesine birebir uyuyor) */
  function tierPctValues() { return TIERS.filter(function (t) { return t.type === 'percent'; }).map(function (t) { return num(t.value); }); }
  function isTierDef(d, basisIfTier) {
    var vals = tierPctValues(), m = /%\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*%/.exec(String(d.definition || d.name || ''));
    if (m) { var n = num(String(m[1] || m[2]).replace(',', '.')); if (vals.indexOf(n) >= 0) return true; }
    var val = num(d.value); if (!(basisIfTier > 0) || !(val > 0)) return false;
    for (var i = 0; i < TIERS.length; i++) { var t = TIERS[i]; if (t.type === 'percent' && basisIfTier + 0.005 >= t.threshold && Math.abs(basisIfTier * num(t.value) / 100 - val) < 1 + basisIfTier * 0.002) return true; }
    return false;
  }
  function badgeText(sp) { if (sp.b) return sp.b + (sp.p > 0 ? '\n%' + sp.p + ' indirim' : '') + (sp.c > 0 ? '\n+ sepette %' + sp.c : ''); return sp.p > 0 && sp.c > 0 ? '%' + sp.p + ' indirim\n+ sepette %' + sp.c : sp.p > 0 ? '%' + sp.p + ' indirim' : sp.c > 0 ? 'Sepette %' + sp.c + ' indirim' : ''; }
  function setBadge(pr, tx) {
    var b = qs('.yb-pct', pr);
    if (tx) { if (!b) { b = document.createElement('span'); b.className = 'yb-pct'; b.setAttribute('data-yunbi', '1'); pr.insertBefore(b, pr.firstChild); } if (b.textContent !== tx) b.textContent = tx; }
    else if (b) b.parentNode.removeChild(b);
  }

  /* ════════════════════ YAN SEPET (tema sayfaları) ════════════════════ */
  var sideBar = null, sideSum = null, sideBusy = false;
  function sideModel() { try { var m = window.cart && window.cart.get && window.cart.get.model; return m && m.cart ? m.cart : null; } catch (e) { return null; } }
  function sideData(c) {
    var prods = c.productsToShow || c.products || [];
    var list = 0, cartT = 0, lineT = 0, items = 0;
    for (var i = 0; i < prods.length; i++) {
      var p = prods[i] || {};
      var sell = num(p.totalSellPriceToShow) || num(p.sellPriceToShow) * num(p.piece || 1);
      var ct = num(p.totalCartPriceToShow) || num(p.productTotalPriceVatIncluded) || num(p.cartPriceToShow) * num(p.piece || 1);
      list += sell; lineT += ct; items += num(p.piece || 1);
    }
    var disc = num(c.discountsTotal), voucher = num(c.giftVoucherAmount), total = num(c.totalAmount);
    // satır fiyatlarına kampanya yedirilmişse (toplam ≈ satırlar toplamı, ayrıca indirim satırı yoksa) ürün-düzeyi tutarı geri hesapla
    // satırlara kampanya yedirilmiş mi? (toplam ≈ satırlar toplamı) → ürün-düzeyi tutar = satırlar + kampanya indirimi
    var linesPost = lineT > 0 && Math.abs(total - lineT) < 1 && (disc > 0.5 || voucher > 0.5);
    cartT = lineT;
    if (linesPost) cartT = lineT + disc;
    else if (lineT > 0 && Math.abs(total - lineT) < 1) { var v = campPct(lineT); if (v > 0) { cartT = 0; for (var k = 0; k < prods.length; k++) { var q = prods[k] || {}; cartT += splitLine(num(q.totalSellPriceToShow) || num(q.sellPriceToShow) * num(q.piece || 1), num(q.totalCartPriceToShow) || num(q.cartPriceToShow) * num(q.piece || 1), 0, v).base; } disc = Math.max(0, cartT - lineT); } }
    var before = cartT || (total + disc + voucher);
    var label = ''; try { if (c.campaigns && c.campaigns.length) label = String(c.campaigns[0].definition || ''); } catch (e) {}
    // 1+1: kampanya indiriminin bedava ürün kısmı kademe tabanını DÜŞÜRÜR (Ticimax %5/%10'u 1+1 sonrası tutara uygular); kalan kısım kademe indirimidir
    var units = [], bogoIdx = {}, camps = null;
    for (var b = 0; b < prods.length; b++) { var bp = prods[b] || {}; if (!isBogo(bp)) continue; bogoIdx[b] = 1; var u = num(bp.productDiscountedPriceVatIncluded) > 0 && num(bp.productDiscountedPriceVatIncluded) < num(bp.sellPriceToShow) ? num(bp.productDiscountedPriceVatIncluded) : num(bp.sellPriceToShow); for (var n = 0; n < num(bp.piece || 1); n++) units.push(u); }
    var bogoD = Math.min(bogoDiscount(units), disc);
    if (bogoD > 0.5) {
      before = Math.max(0, before - bogoD);
      var tierD = disc - bogoD; camps = [{ label: bogoLabel(), value: bogoD }];
      if (tierD > 0.5) { var tl = ''; computeState(before).reached.forEach(function (t) { if (t.type === 'percent') tl = t.label; }); camps.push({ label: label || tl || 'Sepet indirimi', value: tierD }); }
    }
    var basis = R.basis === 'after_discount' ? total : before;
    return { basis: basis, items: items || num(c.productCount), listTotal: list, cartTotal: cartT, campaignDiscount: disc, campaignLabel: label, camps: camps, bogoIdx: bogoIdx, voucher: voucher, total: total, savings: (list - cartT) + disc, freeCargo: false, products: prods };
  }
  /* Çekmece satırlarından ürün kartı id (URL sonu "-9421") + varyant id (Sil → executeClient(47493,…)) */
  function sideLines(drawer, data) {
    var out = [];
    qsa('.miniCartItem', drawer).forEach(function (it, i) {
      var a = qs('.miniurunAdi a, .miniCartRight a, a[href]', it), p = '', v = '';
      if (a) { var m = /-(\d+)(?:[?#].*)?$/.exec(a.getAttribute('href') || ''); if (m) p = m[1]; }
      var del = qs('.miniCartButtonSil a[onclick], a[onclick*="executeClient"]', it);
      if (del) { var m2 = /executeClient\((\d+)/.exec(del.getAttribute('onclick') || ''); if (m2) v = m2[1]; }
      var q = data.products[i] ? num(data.products[i].piece || 1) : 1;
      if (p || v) out.push({ p: p, v: v, q: q, b: '' });
    });
    return out;
  }
  function sideCss() {
    var css = '';
    if (R.side_price) css +=
      '.miniCartItemprice{display:flex!important;flex-direction:column;align-items:flex-end;gap:3px}' +
      '.miniCartItemprice>div{margin:0!important}' +
      '.miniCartItemprice .DiscountPrice.lineThrough{color:' + T.muted + '!important;font-size:12px!important;text-decoration:line-through;font-weight:400!important}' +
      '.miniCartItemprice .CartPrice{color:' + T.ok + '!important;font-weight:800!important;font-size:15px!important;letter-spacing:-.2px}' +
      '.miniCartItemprice .DiscountPrice:not(.lineThrough){color:' + T.ink + '!important;font-weight:800!important;font-size:15px!important}' +
      '.miniCartItemprice .yb-pct{display:inline-block;white-space:pre-line;max-width:118px;text-align:right;background:' + T.badge_color + ';color:#fff;font-size:10.5px;font-weight:800;border-radius:6px;padding:3px 6px;line-height:1.25;letter-spacing:.2px}' +
      '.miniCartItemprice>div:not(.DiscountPrice):not(.CartPrice){font-size:9.5px!important;font-weight:800;letter-spacing:.5px;color:' + T.badge_color + ';text-transform:uppercase}';
    if (R.side_summary) css +=
      '#globalLiteCart .miniCartSubTotalVatBottom,#globalLiteCart .miniCartSubTotalVatTop,#globalLiteCart .miniCartDiscountAmount,#globalLiteCart .miniCartCampaignDiscount,#globalLiteCart .miniCartGiftVoucherAmount{display:none!important}';
    return css;
  }
  function sideEnhance(drawer, data) {
    if (!R.side_price) return;
    var items = qsa('.miniCartItem', drawer);
    for (var i = 0; i < items.length && i < data.products.length; i++) {
      var pr = qs('.miniCartItemprice', items[i]); if (!pr) continue;
      var p = data.products[i];
      if (data.bogoIdx && data.bogoIdx[i]) { var dp = num(p.productDiscountedPriceVatIncluded); setBadge(pr, badgeText({ b: bogoLabel(), p: dp > 0 && dp < num(p.sellPriceToShow) ? pctBadge(p.sellPriceToShow, dp) : 0, c: campPct(data.basis) })); continue; }
      setBadge(pr, badgeText(splitLine(p.sellPriceToShow, p.cartPriceToShow, 0, campPct(data.basis))));
    }
  }
  function sideRender() {
    var drawer = qs('#globalLiteCart'); if (!drawer) return;
    var c = sideModel(); if (!c) return;
    if (sideBusy) return; sideBusy = true;
    try {
      var data = sideData(c);
      data.lines = sideLines(drawer, data);
      pageStyle('yunbi-cart-css', sideCss());
      if (!sideBar) sideBar = buildBar();
      if (!sideBar.host.isConnected || !drawer.contains(sideBar.host)) {
        if (data.items > 0 && !placeHost(R.side_mount, sideBar.host, drawer)) { dbg('side mount yok'); }
      }
      if (data.items === 0 && sideBar.host.parentNode) sideBar.host.parentNode.removeChild(sideBar.host);
      var s = renderBar(sideBar, data);
      sideEnhance(drawer, data);
      if (R.side_summary && data.items > 0) {
        if (!sideSum) sideSum = buildSummary('yunbi-cart-summary', '8px 4px 4px');
        var content = qs('.miniCartContent', drawer) || drawer;
        if (sideSum.host.parentNode !== content || sideSum.host !== content.lastElementChild) content.appendChild(sideSum.host);
        renderSummary(sideSum, data, s, false, true);
      } else if (sideSum && sideSum.host.parentNode) sideSum.host.parentNode.removeChild(sideSum.host);
      if (sideBar.host.isConnected) trackView(s, data);
      // "sepeti gör / alışverişi tamamla" tıkları
      qsa('.miniCartSatir2 a', drawer).forEach(function (a) { if (!a.__yb) { a.__yb = 1; a.addEventListener('click', function () { send('checkout', evPayload(s, data)); }); } });
    } catch (e) { dbg('side render hata', e); send('error', { value: String(e && e.message || e).slice(0, 120) }); }
    sideBusy = false;
  }
  /* Çekmece açıkken diğer Yunbi kulakçıkları (uygulama tanıtımı #yunbi-apppromo, günün fırsatları #yunbi-hero) arkada kalsın */
  var OPEN_CSS = 'body.yunbi-cart-open #yunbi-apppromo,body.yunbi-cart-open #yunbi-hero,body.yunbi-cart-open .ywheel-tab,body.yunbi-cart-open .ywheel-tab-left,body.yunbi-cart-open .ywheel-tab-right,body.yunbi-cart-open [class*="ywheel-tab"]{z-index:0!important;visibility:hidden!important;pointer-events:none!important}';
  function drawerOpen() {
    var d = qs('#globalLiteCart'); if (!d) return false;
    var r = d.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    var cs = getComputedStyle(d); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var act = qs('.miniCartRigth', d); if (act && !act.classList.contains('active') && r.right <= 0) return false;
    return r.left < window.innerWidth && r.right > 0;
  }
  function syncOpen() {
    pageStyle('yunbi-cart-open-css', OPEN_CSS);
    var open = drawerOpen();
    if (document.body.classList.contains('yunbi-cart-open') !== open) document.body.classList.toggle('yunbi-cart-open', open);
  }
  /* Yan sepet +/− koruması: Ticimax her dokunuşta öncekini beklemeden mutlak "adet=X" isteği (UpdatePiece) atıyor;
     mobilde cevaplar karışık sırayla dönünce sepet rastgele adette kalıyordu (azalmıyor / birden 5 oluyor).
     Hızlı dokunuşlar toplanır (debounce), aynı anda tek istek uçar; uçuştayken gelen dokunuşlar biriktirilip
     cevap + yeniden çizim sonrası (satır kimliği değişir) güncel satıra tek istekle uygulanır. */
  var QG = { busy: false, timers: {}, queue: {}, safety: null };
  function qgProduct(key, byVariant) {
    var c = sideModel(), ps = (c && c.products) || [];
    for (var i = 0; i < ps.length; i++) { var p = ps[i] || {}; if (byVariant ? p.variantId == key : p.basketProductId == key) return p; }
    return null;
  }
  function qgInput(bid) { var d = qs('#globalLiteCart'); return d ? d.querySelector('[id="minisepetadet' + bid + '"]') : null; }
  function qgCommit(bid, el) {
    var inp = qgInput(bid); if (!inp) return;
    var v = parseFloat(inp.value), dq = parseFloat(inp.getAttribute('data-qty'));
    if (!(v > 0) || !(dq > 0) || v === dq) return;
    dbg('qty commit', bid, dq, '→', v);
    window.cart.render.rightUpdatePiece(bid, v > dq ? 'add' : 'remove', el && el.isConnected ? el : inp);
  }
  function qgDone() {
    QG.busy = false; clearTimeout(QG.safety);
    for (var vid in QG.queue) {
      var delta = QG.queue[vid]; delete QG.queue[vid];
      var p = qgProduct(vid, true), inp = p && qgInput(p.basketProductId); if (!inp) continue;
      var dq = parseFloat(inp.getAttribute('data-qty')), nv = Math.max(parseFloat(inp.getAttribute('min')) || 1, dq + delta);
      if (nv !== dq) { inp.value = nv; qgCommit(p.basketProductId, inp); return; } // sıradaki varyant bir sonraki cevapta
    }
  }
  function qgTap(el, bid, dir) {
    if (QG.busy) { var p = qgProduct(bid, false); if (p) QG.queue[p.variantId] = (QG.queue[p.variantId] || 0) + dir; return; }
    (dir > 0 ? window.artir : window.azalt)(el); // yeni adet kutuda anında görünür
    clearTimeout(QG.timers[bid]);
    QG.timers[bid] = setTimeout(function () { delete QG.timers[bid]; qgCommit(bid, el); }, 450);
  }
  function installQtyGuard(n) {
    var r = window.cart && window.cart.render, api = window.ticimaxApi && window.ticimaxApi.cart;
    if (!r || !api || typeof api.updatePiece !== 'function' || typeof r.rightUpdatePiece !== 'function' || typeof window.artir !== 'function' || typeof window.azalt !== 'function') {
      if ((n || 0) < 40) setTimeout(function () { installQtyGuard((n || 0) + 1); }, 300);
      return;
    }
    if (r.__ybQty) return; r.__ybQty = 1;
    var ou = api.updatePiece;
    api.updatePiece = function (o, cb) {
      var args = [].slice.call(arguments);
      QG.busy = true; clearTimeout(QG.safety); QG.safety = setTimeout(qgDone, 10000); // ağ hatasında kilit kalmasın
      args[1] = function () { try { if (typeof cb === 'function') return cb.apply(this, arguments); } finally { setTimeout(qgDone, 150); } };
      return ou.apply(this, args);
    };
    r.rightPieceToIncrease = function (el, bid) { qgTap(el, bid, 1); };
    r.rightPieceReduce = function (el, bid) { qgTap(el, bid, -1); };
    dbg('qty guard kuruldu');
  }
  function initSide() {
    setInterval(syncOpen, 400);
    if (R.qty_guard !== false) installQtyGuard(0);
    // 1) temanın render-sonrası kancası (globalV2: typeof rightSideCartRefresh != 'undefined' && rightSideCartRefresh(n))
    var prev = window.rightSideCartRefresh;
    window.rightSideCartRefresh = function () { try { if (typeof prev === 'function') prev.apply(this, arguments); } catch (e) {} setTimeout(sideRender, 30); };
    // 2) çekmece DOM'u değişince (adet/sil → html yeniden basılır)
    var pending = null;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('[data-yunbi]')) continue;
        if (pending) return; pending = setTimeout(function () { pending = null; sideRender(); }, 60); return;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    var mo2 = new MutationObserver(function () { syncOpen(); });
    mo2.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    if (qs('#globalLiteCart')) sideRender();
    syncOpen();
  }

  /* ════════════════════ CHECKOUT (sepet adımı) ════════════════════ */
  var coBar = null, coSum = null, coBasket = null, coTimer = null;
  function coData(h) {
    var prods = h.products || [], list = 0, cartT = 0, lineT = 0, preT = 0, items = 0, units = [], hasBogo = false;
    for (var i = 0; i < prods.length; i++) {
      var p = prods[i] || {}, q = num(p.quantity || 1);
      var sell = num(p.salePriceWithVat) * q, ct = num(p.totalPriceWithVat) || num(p.basketPriceWithVat) * q;
      var pd = num(p.discountPriceWithVat) > 0 ? num(p.discountPriceWithVat) * q : ct;
      var up = num(p.discountPriceWithVat) > 0 ? num(p.discountPriceWithVat) : num(p.salePriceWithVat); // kampanyasız birim fiyat
      list += sell; lineT += ct; cartT += Math.max(pd, ct); preT += up * q; items += q;
      if (isBogo(p)) { hasBogo = true; for (var n = 0; n < q; n++) units.push(up); }
    }
    var pr = h.price || {};
    var camp = Math.max(num(pr.campaignDiscountPrice), num(pr.basketDiscountPrice), cartT - lineT), voucher = num(pr.giftVoucherPrice);
    var total = num(pr.totalBasketPrice) || num(h.orderTotalPrice);
    var before = num(pr.totalNotDiscountedBasketPrice) || cartT || (total + camp);
    var label = ''; try { var cd = h.campaignDefinitions; if (cd && cd.length) label = String(cd[0].definition || cd[0].name || ''); } catch (e) {}
    // kampanyalar ayrı ayrı: 1+1 gibi ürün kampanyaları kademe tabanını düşürür, sepet kademesi (%5/%10) düşürmez
    var camps = null, tierIds = {};
    if (hasBogo || (h.campaignDefinitions || []).length > 1) {
      var prodBase = num(pr.totalNotDiscountedBasketPrice) || preT;
      var defs = (h.campaignDefinitions || []).filter(function (d) { return d && num(d.value) > 0.005; });
      var sumAll = defs.reduce(function (a, d) { return a + num(d.value); }, 0), other = 0;
      camps = defs.map(function (d) { var tier = isTierDef(d, prodBase - (sumAll - num(d.value))); if (tier) tierIds[d.id] = 1; else other += num(d.value); return { label: String(d.definition || d.name || 'Kampanya indirimi'), value: num(d.value), tier: tier }; });
      if (!defs.length && hasBogo) { other = Math.min(bogoDiscount(units), camp); camps = other > 0.5 ? [{ label: bogoLabel(), value: other }] : null; if (camp - other > 0.5) camps && camps.push({ label: 'Sepet indirimi', value: camp - other, tier: true }); }
      cartT = prodBase; camp = camps ? camps.reduce(function (a, c) { return a + c.value; }, 0) : camp;
      before = Math.max(0, prodBase - other);
    }
    var basis = R.basis === 'after_discount' ? total : before;
    var lines = prods.map(function (p) { return { p: String(p.cardId || ''), v: String(p.productId || p.id || ''), q: num(p.quantity || 1), b: String(p.barcode || '') }; });
    return { basis: basis, items: items, listTotal: list, cartTotal: cartT, campaignDiscount: camp, campaignLabel: label, camps: camps, tierIds: tierIds, voucher: voucher, total: total, savings: (list - cartT) + camp, freeCargo: !!h.isFreeCargo, products: prods, lines: lines };
  }
  function coCss() {
    var css = '';
    if (R.checkout_hide_selector) css += R.checkout_hide_selector + '{display:none!important}';
    if (R.checkout_price) css +=
      '.basket-item-price-customize.price-wrapper{display:flex!important;flex-direction:column;align-items:flex-end;gap:3px}' +
      '.basket-item-sale-price.customize-sale-price span{color:' + T.muted + '!important;font-size:12px!important;text-decoration:line-through;font-weight:400!important}' +
      '.basket-item-basket-price.customize-basket-price span{color:' + T.ok + '!important;font-weight:800!important;font-size:17px!important;letter-spacing:-.2px}' +
      '.price-wrapper .yb-pct{display:inline-block;white-space:pre-line;max-width:150px;text-align:right;background:' + T.badge_color + ';color:#fff;font-size:11px;font-weight:800;border-radius:6px;padding:3px 7px;line-height:1.25}' +
      '';
    return css;
  }
  function coEnhance(h, data) {
    if (!R.checkout_price) return;
    var byId = {}; (h.products || []).forEach(function (p) { byId[p.basketProductId] = p; });
    qsa('.cart-product-list .product-item[data-id]').forEach(function (it) {
      var p = byId[it.getAttribute('data-id')]; if (!p) return;
      var pr = qs('.price-wrapper', it); if (!pr) return;
      var v = campPct(coBar && coBar.state ? coBar.state.basis : 0);
      var pc = (p.campaignDefinitions || []).filter(function (d) { return d && !(data && data.tierIds || {})[d.id] && !isTierDef(d, 0); })[0];
      if (pc || isBogo(p)) { var dp = num(p.discountPriceWithVat); setBadge(pr, badgeText({ b: pc ? String(pc.definition || bogoLabel()) : bogoLabel(), p: dp > 0 && dp < num(p.salePriceWithVat) ? pctBadge(p.salePriceWithVat, dp) : 0, c: v })); return; }
      setBadge(pr, badgeText(splitLine(p.salePriceWithVat, p.basketPriceWithVat, p.discountPriceWithVat, v)));
    });
  }
  function coRender() {
    var h = coBasket || window.checkout_basket; if (!h) return;
    coBasket = h;
    try {
      var data = coData(h);
      pageStyle('yunbi-cart-css', coCss());
      if (!coBar) coBar = buildBar();
      if (data.items > 0 && !coBar.host.isConnected) { if (!placeHost(R.checkout_mount, coBar.host)) { dbg('checkout mount yok'); return; } }
      if (data.items === 0) { if (coBar.host.parentNode) coBar.host.parentNode.removeChild(coBar.host); return; }
      var s = renderBar(coBar, data);
      coEnhance(h, data);
      if (R.checkout_summary) {
        if (!coSum) coSum = buildSummary('yunbi-cart-summary', '6px 16px 8px');
        if (!coSum.host.isConnected) placeHost(R.checkout_summary_mount, coSum.host, null, true);
        renderSummary(coSum, data, s, false, false);
      }
      trackView(s, data);
    } catch (e) { dbg('checkout render hata', e); send('error', { value: String(e && e.message || e).slice(0, 120) }); }
  }
  function initCheckout() {
    window.addEventListener('basketUpdated', function (e) { coBasket = (e && e.detail) || window.checkout_basket; clearTimeout(coTimer); coTimer = setTimeout(coRender, 80); });
    var tries = 60; // SPA sepeti geç doldurur → 30 sn
    var iv = setInterval(function () { if (window.checkout_basket) { coBasket = window.checkout_basket; coRender(); } if (--tries <= 0 || (coBar && coBar.host.isConnected)) clearInterval(iv); }, 500);
    // SPA yeniden çizince düğümlerimizi silebilir → bekçi
    var pending = null;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('[data-yunbi]')) continue;
        if (pending) return; pending = setTimeout(function () { pending = null; coRender(); }, 120); return;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ════════════════════ İKAS (Next.js vitrin) ════════════════════
     Sepet verisi: ikas vitrin GraphQL'i getCartById (localStorage.cartId; anahtar __NEXT_DATA__ configJson.apiKey).
     Yüzeyler: yan sepet (.cart-drawer-header'ın altı) = 'side', /cart sayfası (başlık satırının altı) = 'checkout'.
     Kademe indirimini ikas kampanyası uygular (orderAdjustments); widget yalnız gösterir/ölçer. */
  var IK = { cart: null, cartId: '', busy: false, timer: null, side: null, sideSg: null, sideSum: null, page: null, pageSum: null };
  function ikasCfg() { try { return window.__NEXT_DATA__.props.pageProps.configJson || null; } catch (e) { return null; } }
  function isIkas() { return !!(window.IkasEvents || ikasCfg() || qs('script[src*="cdn.myikas.com"]')); }
  function ikasCartId() { try { return localStorage.getItem('cartId') || ''; } catch (e) { return ''; } }
  var IK_FIELDS = 'id customerId itemCount totalPrice totalFinalPrice couponCode giftCardLines { amount } orderAdjustments { amount name type campaignType } ' +
    'orderLineItems { id quantity price discountPrice finalPrice deleted variant { id productId barcodeList prices { sellPrice discountPrice } } }';
  function ikasGql(op, query, vars) {
    var c = ikasCfg(); if (!c || !c.apiKey) return Promise.reject(new Error('ikas config yok'));
    var url = (c.apiUrl || 'https://api.myikas.com/api/sf/graphql').replace(/\?.*$/, '') + '?op=' + op;
    return fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'x-sfid': c.storefrontId || '', 'x-sfrid': c.storefrontRoutingId || '', 'x-timezone': 'Europe/Istanbul' },
      body: JSON.stringify({ query: query, variables: vars }) }).then(function (r) { return r.json(); });
  }
  function ikasFetch() {
    var id = ikasCartId();
    if (!id) { IK.cart = null; IK.cartId = ''; ikasRender(); return; }
    if (IK.busy) { IK.again = true; return; }
    IK.busy = true;
    ikasGql('getCartById', 'query getCartById($id: String) { getCartById(id: $id) { ' + IK_FIELDS + ' } }', { id: id })
      .then(function (j) { IK.cart = (j && j.data && j.data.getCartById) || null; IK.cartId = id; })
      .catch(function (e) { dbg('ikas sepet alınamadı', e); })
      .then(function () { IK.busy = false; if (IK.again) { IK.again = false; ikasFetch(); } else ikasRender(); });
  }
  function ikasRefresh(ms) { clearTimeout(IK.timer); IK.timer = setTimeout(ikasFetch, ms == null ? 250 : ms); }
  function ikasData(c) {
    var lines = (c && c.orderLineItems || []).filter(function (l) { return l && !l.deleted; });
    var list = 0, cartT = 0, items = 0, out = [];
    lines.forEach(function (l) {
      var q = num(l.quantity || 1), v = l.variant || {}, pr = (v.prices || [])[0] || {};
      var unit = num(l.discountPrice) > 0 ? num(l.discountPrice) : num(l.price);
      var sell = Math.max(num(pr.sellPrice), num(l.price), unit);
      list += sell * q; cartT += unit * q; items += q;
      out.push({ p: String(v.productId || ''), v: String(v.id || ''), q: q, b: String((v.barcodeList || [])[0] || '') });
    });
    if (c && num(c.totalPrice) > 0) cartT = num(c.totalPrice);
    var camps = (c && c.orderAdjustments || []).filter(function (a) { return a && a.type === 'DECREMENT' && num(a.amount) > 0.005; })
      .map(function (a) { return { label: String(a.name || 'Kampanya indirimi'), value: num(a.amount) }; });
    var disc = camps.reduce(function (a, x) { return a + x.value; }, 0);
    var voucher = (c && c.giftCardLines || []).reduce(function (a, g) { return a + num(g && g.amount); }, 0);
    var total = c ? num(c.totalFinalPrice) : 0;
    var basis = R.basis === 'after_discount' ? total : cartT;
    return { basis: basis, items: items, lines: out, member: String(c && c.customerId || ''), listTotal: list, cartTotal: cartT, campaignDiscount: disc, camps: camps, voucher: voucher, total: total, savings: Math.max(0, list - cartT) + disc, freeCargo: false, products: lines };
  }
  function ikasVisible(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth; }
  function ikasDrawer() { var h = qs('.cart-drawer-header'); return h && ikasVisible(h) ? h : null; }
  function ikasPageHead() {
    if (!/^\/(cart|sepet)(\/|$)/i.test(location.pathname)) return null;
    var hs = qsa('main h1'); for (var i = 0; i < hs.length; i++) if (/sepet/i.test(hs[i].textContent || '')) return hs[i].parentNode;
    return null;
  }
  function ikasSpacer(el, px) { el.style.setProperty('margin-bottom', px + 'px', 'important'); }
  function ikasRender() {
    if (IK.rendering) return; IK.rendering = true;
    try {
      var data = ikasData(IK.cart);
      // ── yan sepet ──
      var head = ikasDrawer();
      if (head && data.items > 0) {
        SURFACE = 'side';
        var scroll = head.parentNode;
        if (!IK.side) IK.side = buildBar();
        if (IK.side.host.parentNode !== scroll || IK.side.host.previousElementSibling !== head) head.parentNode.insertBefore(IK.side.host, head.nextSibling);
        IK.side.host.style.setProperty('margin', '4px 0 10px', 'important');
        var s = renderBar(IK.side, data);
        ikasSideExtras(scroll, data, s);
        trackView(s, data);
      } else if (!head || data.items === 0) {
        // Sepet boşaldı / çekmece kapandı → çubuk + öneri şeridi + özet eski rakamlarla kalmasın
        [IK.side, IK.sideSg, IK.sideSum].forEach(function (w) { if (w && w.host && w.host.parentNode) w.host.parentNode.removeChild(w.host); });
      }
      // ── /cart sayfası ──
      var ph = ikasPageHead();
      if (ph && data.items > 0) {
        SURFACE = 'checkout';
        if (!IK.page) IK.page = buildBar();
        if (IK.page.host.previousElementSibling !== ph) ph.parentNode.insertBefore(IK.page.host, ph.nextSibling);
        IK.page.host.style.setProperty('margin', '14px 0 4px', 'important');
        IK.page.host.style.setProperty('padding', '0 16px', 'important');
        var s2 = renderBar(IK.page, data);
        if (R.checkout_summary) {
          var bs = qs('.basket-summary');
          if (bs) {
            if (!IK.pageSum) IK.pageSum = buildSummary('yunbi-cart-summary', '4px 0 8px');
            var st = qs('.sub-total', bs);
            if (!IK.pageSum.host.isConnected) { if (st) st.parentNode.insertBefore(IK.pageSum.host, st.nextSibling); else bs.appendChild(IK.pageSum.host); }
            ikasPageSummary(IK.pageSum, data, s2);
          }
        }
        trackView(s2, data);
      } else if (!ph || data.items === 0) {
        [IK.page, IK.pageSum].forEach(function (w) { if (w && w.host && w.host.parentNode) w.host.parentNode.removeChild(w.host); });
      }
      syncIkasOpen();
    } catch (e) { dbg('ikas render hata', e); send('error', { value: 'ikas: ' + String(e && e.message || e).slice(0, 110) }); }
    IK.rendering = false;
  }
  /* /cart sayfası: tema ara toplam + kampanya + toplam satırlarını zaten basıyor → yalnız kargo durumu + toplam kazanç */
  function ikasPageSummary(sum, data, s) {
    var rows = [], sh = null;
    for (var i = 0; i < TIERS.length; i++) if (TIERS[i].type === 'shipping') { sh = TIERS[i]; break; }
    if (sh && data.items > 0) rows.push(s.shippingFree ? '<div class="rw ship"><span class="k">Kargo</span><span class="v free">Ücretsiz</span></div>' : '<div class="rw ship"><span class="k">Kargo<small>' + esc(moneyShort(sh.threshold)) + ' üzeri ücretsiz</small></span><span class="v left">' + esc(money(Math.max(0, sh.threshold - data.basis))) + ' kaldı</span></div>');
    if (R.show_savings && data.savings > 0.5) rows.push('<div class="sv">' + ICON_CHECK + 'Bu sepette toplam kazancın ' + esc(money(data.savings)) + '</div>');
    var html = rows.join('');
    if (sum.box.innerHTML !== html) sum.box.innerHTML = html;
  }
  /* Yan sepet: öneri şeridi + kompakt özet ürünlerin ALTINDA (sabit alt bloğun arkasında kalmasın diye boşluklu) */
  function ikasSideExtras(scroll, data, s) {
    var html = suggestHtml(data, s);
    if (!IK.sideSg) {
      var host = document.createElement('div'); host.id = 'yunbi-cart-suggest'; host.setAttribute('data-yunbi', '1');
      host.style.cssText = 'display:block!important;width:100%!important;position:static;margin:12px 0 4px!important;padding:0!important;';
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var st = document.createElement('style'); st.textContent = barCss() + '.yc.sg-only{padding:10px 12px 6px}.yc.sg-only .sg{border-top:0;padding-top:0;margin-top:0}'; root.appendChild(st);
      var box = document.createElement('div'); box.className = 'yc sg-only' + (T.style === 'flat' ? ' flat' : ''); root.appendChild(box);
      IK.sideSg = { host: host, root: root, box: box, lastHtml: '' };
    }
    if (R.side_summary && !IK.sideSum) IK.sideSum = buildSummary('yunbi-cart-summary', '8px 2px 4px');
    var tail = [];
    if (html) tail.push(IK.sideSg.host); else if (IK.sideSg.host.parentNode) IK.sideSg.host.parentNode.removeChild(IK.sideSg.host);
    if (R.side_summary) tail.push(IK.sideSum.host);
    tail.forEach(function (h) { if (h.parentNode !== scroll || scroll.lastElementChild !== h) scroll.appendChild(h); });
    // sabit alt blok (ödeme adımı + toplam) ~150 px: son öğe onun arkasında kalmasın
    var bottom = qs('.checkout-btn-main'), pad = bottom ? Math.ceil(bottom.getBoundingClientRect().height) + 70 : 160;
    if (tail.length) ikasSpacer(tail[tail.length - 1], pad);
    if (html && html !== IK.sideSg.lastHtml) { IK.sideSg.lastHtml = html; IK.sideSg.box.innerHTML = html; bindSuggest(IK.sideSg, data, s); }
    if (R.side_summary) renderSummary(IK.sideSum, data, s, false, true);
  }
  function syncIkasOpen() {
    pageStyle('yunbi-cart-open-css', OPEN_CSS);
    var open = !!ikasDrawer();
    if (document.body.classList.contains('yunbi-cart-open') !== open) document.body.classList.toggle('yunbi-cart-open', open);
  }
  function ikasAdd(it, cb) {
    var vid = String(it.variant_id || '');
    if (!vid) return cb(false);
    var n0 = IK.cart ? num(IK.cart.itemCount) : 0;
    var done = function (ok) {
      if (ok) { SG.added[it.id] = Date.now(); SG.holdUntil = Date.now() + 3500; setTimeout(function () { SG.holdUntil = 0; ikasRender(); }, 3700); }
      ikasRefresh(300); setTimeout(function () { ikasRefresh(0); }, 1500); cb(ok);
    };
    if (typeof window.addToCart === 'function') { // temanın sepet deposu → çekmece/sayaç anında güncellenir
      try {
        var p = window.addToCart({ variantId: vid, quantity: 1 });
        if (p && typeof p.then === 'function') { p.then(function (r) { done(r !== false); }, function () { done(false); }); return; }
        return setTimeout(function () { done(true); }, 900);
      } catch (e) { dbg('ikas addToCart hata', e); }
    }
    ikasGql('addItemToCart', 'mutation addItemToCart($input: AddItemToCartInput!) { addItemToCart(input: $input) { id itemCount } }',
      { input: { cartId: ikasCartId() || null, item: { id: null, quantity: 1, variant: { id: vid } }, salesChannelId: (ikasCfg() || {}).salesChannelId, storefrontThemeId: (ikasCfg() || {}).storefrontThemeId } })
      .then(function (j) { var c = j && j.data && j.data.addItemToCart; if (c && c.id) { try { localStorage.setItem('cartId', c.id); } catch (e) {} } cb(!!(c && num(c.itemCount) > n0)); setTimeout(function () { location.reload(); }, 700); })
      .catch(function () { cb(false); });
  }
  function initIkas() {
    pageStyle('yunbi-cart-ikas-css', '#yunbi-cart-bar,#yunbi-cart-suggest,#yunbi-cart-summary{box-sizing:border-box!important}');
    try { if (window.IkasEvents && window.IkasEvents.subscribe) window.IkasEvents.subscribe({ id: 'yunbi-cart', callback: function (e) { var t = e && e.type || ''; if (/CART|CHECKOUT/i.test(t)) ikasRefresh(200); } }); } catch (e) {}
    // çekmece/sepet sayfasında +, −, sil tıkları → sepet API'si yanıtlayınca tazele
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest || t.closest('[data-yunbi]')) return;
      if (t.closest('.cart-drawer-height, main')) { ikasRefresh(700); setTimeout(function () { ikasRefresh(0); }, 2200); }
    }, true);
    // ödeme adımına geçiş tıkları
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href*="/checkout"]'); if (!a || !IK.cart) return;
      var d = ikasData(IK.cart); send('checkout', evPayload(computeState(d.basis), d));
    }, true);
    var pending = null, wasOpen = false, lastPath = location.pathname, lastId = ikasCartId();
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('[data-yunbi]')) continue;
        if (pending) return;
        pending = setTimeout(function () {
          pending = null;
          var open = !!ikasDrawer(), id = ikasCartId();
          if ((open && !wasOpen) || location.pathname !== lastPath || id !== lastId) { lastPath = location.pathname; lastId = id; ikasFetch(); } else ikasRender();
          wasOpen = open;
        }, 120);
        return;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    ikasFetch();
  }

  /* ── Başlat ── */
  function pathHidden() {
    var hp = String(R.hide_paths || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < hp.length; i++) if (location.pathname.indexOf(hp[i]) === 0) return true;
    return false;
  }
  function isCheckoutPath() {
    var ps = String(R.checkout_paths || '/checkout').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < ps.length; i++) if (location.pathname.toLowerCase().indexOf(ps[i].toLowerCase()) === 0) return true;
    return false;
  }
  function start(cfg) {
    if (!cfg || !cfg.enabled) { dbg('kapalı'); return; }
    T = cfg.theme || {}; R = cfg.rules || {};
    if (IS_HUB) { // demo: data-theme / data-rules / data-surface override
      try { var th = script.getAttribute('data-theme'); if (th) T = Object.assign({}, T, JSON.parse(th)); } catch (e) {}
      try { var ru = script.getAttribute('data-rules'); if (ru) R = Object.assign({}, R, JSON.parse(ru)); } catch (e) {}
    }
    TIERS = (R.tiers || []).slice().sort(function (a, b) { return a.threshold - b.threshold; });
    if (pathHidden()) return;
    if (!IS_HUB && isIkas()) { IKAS = true; var gi = function () { initIkas(); }; if (document.body) gi(); else document.addEventListener('DOMContentLoaded', gi); return; }
    var forced = IS_HUB ? script.getAttribute('data-surface') : null;
    SURFACE = forced || (isCheckoutPath() ? 'checkout' : 'side');
    dbg('surface', SURFACE, 'tiers', TIERS.length);
    var go = function () { if (SURFACE === 'checkout') { if (R.checkout_enabled) initCheckout(); } else if (R.side_enabled) initSide(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }
  window.YunbiCart = { refresh: function () { if (IKAS) return ikasFetch(); if (SURFACE === 'checkout') coRender(); else sideRender(); }, state: function () { return (SURFACE === 'checkout' ? coBar : sideBar) && (SURFACE === 'checkout' ? coBar : sideBar).state; } };
  function boot(tenant) {
    TENANT = tenant; API = BASE + '/w/' + encodeURIComponent(TENANT) + '/cart';
    fetch(API + '/config', { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(start).catch(function () { dbg('config alınamadı'); });
  }
  if (TENANT) boot(TENANT);
  else fetch(BASE + '/w/cart-resolve?host=' + encodeURIComponent(location.hostname), { mode: 'cors', credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.slug) boot(j.slug); else dbg('tenant çözülemedi'); }).catch(function () { dbg('tenant çözülemedi'); });
})();
