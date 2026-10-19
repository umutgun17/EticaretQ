/*! Yunbi "Hoş geldin" ilk alışveriş hediyesi (CRO) — ilk kez gelen ziyaretçiye köşeden süzülen zarif kupon kartı.
 *  <script src="https://eticaretq.com/widget/welcome.js?v=1" data-tenant="SLUG" async></script>
 *
 *  Pop-up/karartma yok: masaüstünde köşe kartı, mobilde alttan küçük panel. Tetik: N. sayfada ya da ilk sayfada T sn sonra
 *  ya da masaüstünde çıkarken; ürün ve ödeme sayfasında açılmaz. Kod tek tıkla açılır + panoya kopyalanır; sonrasında
 *  küçük hatırlatıcı pil eşlik eder. Kapatan dismiss_days gün görmez; sipariş geçmişi olan üyeye gösterilmez.
 */
(function () {
  'use strict';
  if (window.__yunbiWelcomeLoaded) return;
  window.__yunbiWelcomeLoaded = true;

  var SCRIPT = document.currentScript || document.querySelector('script[src*="/widget/welcome.js"]');
  if (!SCRIPT) return;
  var SLUG = SCRIPT.getAttribute('data-tenant');
  if (!SLUG) return;
  var API = SCRIPT.src.replace(/\/widget\/welcome\.js.*$/, '') + '/w/' + encodeURIComponent(SLUG) + '/welcome';
  var DEBUG = /yunbi_debug=1/.test(location.search);
  var FORCE = /yunbi_welcome=1/.test(location.search);
  var KEY = 'yunbi_wc';

  var R = null, host = null, root = null, cardEl = null, pillEl = null;
  var shown = false, lastPath = '', page = { type: '' };
  var st = load() || { pages: 0, shownAt: 0, dismissedAt: 0, revealedAt: 0, pillOff: 0, first: Date.now() };

  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-welcome]'].concat([].slice.call(arguments))); }
  function qs(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load() { try { var v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function sid() { try { var s = localStorage.getItem('yunbi_sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('yunbi_sid', s); } return s; } catch (e) { return ''; } }
  function device() { return (window.innerWidth || 1024) < 900 ? 'm' : 'd'; }
  function isMobile() { return device() === 'm'; }
  function cartId() { try { return localStorage.getItem('cartId') || ''; } catch (e) { return ''; } }
  function member() { try { var pp = window.__NEXT_DATA__.props.pageProps; var c = pp && pp.customer; return String((c && c.id) || ''); } catch (e) { return ''; } }
  function days(ms) { return ms ? (Date.now() - ms) / 86400000 : 999; }

  function send(type, extra) {
    var body = Object.assign({ type: type, sid: sid(), device: device(), path: location.pathname, page_type: (page.type || '').toLowerCase(), cart_id: cartId(), member: member() }, extra || {});
    try { fetch(API + '/event', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {}); } catch (e) {}
  }
  function readPage() {
    var pp = null;
    try { var r = window.next && window.next.router; var c = r && r.components && r.components[r.route]; pp = c && c.props && c.props.pageProps; } catch (e) {}
    if (!pp) { try { pp = window.__NEXT_DATA__.props.pageProps; } catch (e) {} }
    return { type: (pp && pp.pageType) || '' };
  }
  function hidden() {
    var paths = String(R.hide_paths || '').split(',');
    for (var i = 0; i < paths.length; i++) { var p = paths[i].trim(); if (p && location.pathname.indexOf(p) === 0) return true; }
    return false;
  }
  function fill(t) { return String(t || '').replace('{code}', R.code).replace('{percent}', String(R.percent)); }

  var CSS = function () {
    var acc = R.accent || '#111111', left = R.position === 'left', side = left ? 'left' : 'right';
    return ':host{all:initial}*{box-sizing:border-box}' +
      '.w{font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}' +
      '.cd{position:fixed;z-index:2147481900;bottom:20px;' + side + ':20px;width:360px;max-width:calc(100vw - 24px);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.08);overflow:hidden;transform:translateY(24px);opacity:0;transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .35s}' +
      '.cd.on{transform:none;opacity:1}' +
      '.x{position:absolute;top:10px;' + side + ':10px;width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.85);color:#111;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;backdrop-filter:blur(4px)}' +
      '.hero{position:relative;height:150px;background:' + acc + ';color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
      '.hero img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.hero .big{font-size:76px;font-weight:700;letter-spacing:-.04em;line-height:1;position:relative}' +
      '.hero .big small{font-size:28px;font-weight:600;letter-spacing:0;vertical-align:top;margin-top:10px;display:inline-block}' +
      '.hero:before{content:"";position:absolute;inset:-40%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.18),transparent 45%),radial-gradient(circle at 75% 70%,rgba(255,255,255,.12),transparent 40%);animation:wc-drift 9s ease-in-out infinite alternate}' +
      '.hero .sp{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;opacity:0;animation:wc-tw 4s ease-in-out infinite}' +
      '.bd{padding:18px 20px 20px}' +
      '.eb{font-size:10.5px;font-weight:700;letter-spacing:.22em;color:#777;margin:0 0 6px}' +
      '.tt{font-size:19px;font-weight:700;line-height:1.25;margin:0;letter-spacing:-.01em}' +
      '.tx{font-size:13px;color:#555;line-height:1.5;margin:8px 0 14px}' +
      '.bt{width:100%;height:46px;border:0;border-radius:12px;background:' + acc + ';color:#fff;font-size:13.5px;font-weight:700;letter-spacing:.06em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s,opacity .15s}' +
      '.bt svg{width:18px;height:18px;flex:none}.bt:hover{transform:translateY(-1px)}.bt:active{transform:scale(.98)}' +
      '.bt.ghost{background:#fff;color:' + acc + ';border:1.5px solid ' + acc + ';margin-top:8px;height:42px}' +
      '.code{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1.5px dashed ' + acc + ';border-radius:12px;padding:10px 12px 10px 16px;margin:4px 0 12px;background:#fafafa;animation:wc-pop .45s cubic-bezier(.2,.8,.2,1)}' +
      '.code b{font-size:22px;letter-spacing:.18em;font-weight:700}' +
      '.code button{height:34px;padding:0 12px;border:0;border-radius:9px;background:' + acc + ';color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}' +
      '.code button.ok{background:#16a34a}' +
      '.ft{font-size:11px;color:#999;text-align:center;margin-top:10px}' +
      '.pill{position:fixed;z-index:2147481690;bottom:16px;' + side + ':16px;display:flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 12px;border-radius:999px;background:' + acc + ';color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em;box-shadow:0 10px 26px rgba(0,0,0,.22);cursor:pointer;transform:translateY(60px);opacity:0;transition:transform .4s cubic-bezier(.2,.8,.2,1),opacity .3s;user-select:none}' +
      '.pill.on{transform:none;opacity:1}.pill svg{width:16px;height:16px;flex:none}' +
      '.pill .px{margin-left:4px;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center}' +
      '.toast{position:fixed;z-index:2147481910;bottom:66px;' + side + ':16px;background:#111;color:#fff;font-size:12px;font-weight:600;padding:9px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:wc-pop .3s ease}' +
      '@keyframes wc-pop{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}' +
      '@keyframes wc-drift{from{transform:translate(0,0)}to{transform:translate(6%,4%)}}' +
      '@keyframes wc-tw{0%,70%,100%{opacity:0;transform:scale(.4)}80%{opacity:.9;transform:scale(1)}}' +
      '@media (max-width:640px){.cd{left:8px;right:8px;bottom:8px;width:auto;max-width:none;border-radius:18px}.hero{height:124px}.hero .big{font-size:64px}.tt{font-size:17.5px}.pill{bottom:12px;' + side + ':12px}.toast{bottom:60px}}' +
      '@media (prefers-reduced-motion:reduce){.cd,.pill,.code,.toast,.hero:before,.hero .sp{transition:none;animation:none!important}}';
  };
  var ICON_GIFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8c-2.5 0-4.5-1.5-4.5-3s1.3-2 2.5-2c2 0 2 3 2 5zm0 0c2.5 0 4.5-1.5 4.5-3s-1.3-2-2.5-2c-2 0-2 3-2 5z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function mount() {
    host = document.createElement('div');
    host.id = 'yunbi-welcome';
    host.setAttribute('data-yunbi', '1');
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' + CSS() + '</style><div class="w"></div>';
    document.body.appendChild(host);
  }
  function copyCode(cb) {
    var ok = function () { cb(true); }, fail = function () { cb(false); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(R.code).then(ok, fail); } catch (e) {}
    try { var ta = document.createElement('textarea'); ta.value = R.code; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); var r = document.execCommand('copy'); document.body.removeChild(ta); r ? ok() : fail(); } catch (e) { fail(); }
  }
  function sparks() { var out = ''; for (var i = 0; i < 6; i++) out += '<span class="sp" style="left:' + (10 + i * 15) + '%;top:' + (15 + ((i * 37) % 60)) + '%;animation-delay:' + (i * 0.7) + 's"></span>'; return out; }
  function showCard(trigger) {
    if (shown || cardEl) return;
    shown = true; st.shownAt = Date.now(); save();
    window.__yunbiWelcomeOpen = true; // diğer Yunbi kartları (Sana Özel) bu sırada kendiliğinden açılmaz
    hidePill();
    cardEl = document.createElement('div');
    cardEl.className = 'cd';
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-label', esc(R.title));
    cardEl.innerHTML = '<button type="button" class="x" aria-label="Kapat">' + ICON_X + '</button>' +
      '<div class="hero">' + (R.image_url ? '<img src="' + esc(R.image_url) + '" alt="">' : sparks() + '<div class="big"><small>%</small>' + esc(R.percent) + '</div>') + '</div>' +
      '<div class="bd"><p class="eb">' + esc(R.eyebrow) + '</p><h3 class="tt">' + esc(fill(R.title)) + '</h3><p class="tx">' + esc(fill(R.text)) + '</p>' +
      '<button type="button" class="bt rv">' + ICON_GIFT + esc(R.cta) + '</button></div>';
    qs('.w', root).appendChild(cardEl);
    requestAnimationFrame(function () { requestAnimationFrame(function () { cardEl.classList.add('on'); }); });
    send('view', { source: trigger });
    qs('.x', cardEl).addEventListener('click', function () { st.dismissedAt = Date.now(); save(); send('dismiss'); closeCard(); });
    qs('.rv', cardEl).addEventListener('click', reveal);
  }
  function reveal() {
    st.revealedAt = Date.now(); save();
    send('reveal');
    var bd = qs('.bd', cardEl);
    bd.innerHTML = '<p class="eb">' + esc(R.eyebrow) + '</p><h3 class="tt">' + esc(fill(R.revealed_title)) + '</h3><p class="tx">' + esc(fill(R.revealed_text)) + '</p>' +
      '<div class="code"><b>' + esc(R.code) + '</b><button type="button" class="cp">Kopyala</button></div>' +
      '<a class="bt go" href="' + esc(R.shop_url || '/') + '">' + esc(R.shop_cta) + '</a><p class="ft">Kod panoya kopyalandı · ödeme adımında yapıştır</p>';
    var cp = qs('.cp', bd), ft = qs('.ft', bd);
    var mark = function (ok) { cp.textContent = ok ? 'Kopyalandı ✓' : 'Kopyala'; cp.classList.toggle('ok', ok); ft.textContent = ok ? 'Kod panoya kopyalandı · ödeme adımında yapıştır' : 'Kodu ödeme adımındaki kupon alanına yaz'; };
    copyCode(function (ok) { mark(ok); if (ok) send('copy', { source: 'auto' }); });
    cp.addEventListener('click', function () { copyCode(function (ok) { mark(ok); send('copy', { source: 'button' }); }); });
    qs('.go', bd).addEventListener('click', function () { send('cta'); });
  }
  function closeCard() {
    if (!cardEl) return;
    cardEl.classList.remove('on');
    window.__yunbiWelcomeOpen = false;
    var el = cardEl; cardEl = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); syncPill(); }, 400);
  }
  function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = t; qs('.w', root).appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2200); }
  function syncPill() {
    var want = R.remind && st.revealedAt && days(st.revealedAt) <= R.remind_days && !st.pillOff && !cardEl && !hidden();
    if (want && !pillEl) {
      pillEl = document.createElement('div');
      pillEl.className = 'pill';
      pillEl.setAttribute('role', 'button');
      pillEl.innerHTML = ICON_GIFT + '<span>' + esc(fill(R.remind_text)) + '</span><span class="px" aria-label="Gizle">' + ICON_X + '</span>';
      qs('.w', root).appendChild(pillEl);
      requestAnimationFrame(function () { requestAnimationFrame(function () { pillEl && pillEl.classList.add('on'); }); });
      pillEl.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.px')) { st.pillOff = Date.now(); save(); hidePill(); return; }
        copyCode(function (ok) { toast(ok ? R.code + ' kopyalandı · ödeme adımında yapıştır' : 'Kod: ' + R.code); send('remind'); });
      });
    } else if (!want && pillEl) hidePill();
  }
  function hidePill() { if (!pillEl) return; var el = pillEl; pillEl = null; el.classList.remove('on'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400); }

  /* ── tetikler ── */
  function eligibleNow() {
    if (FORCE) return true;
    if (shown || cardEl || hidden()) return false;
    if (window.__yunbiForYouOpen) return false;                        // Sana Özel paneli açıkken üst üste binme
    if (st.revealedAt) return false;                                   // kodu zaten aldı
    if (st.dismissedAt && days(st.dismissedAt) < R.dismiss_days) return false;
    if (st.shownAt && days(st.shownAt) < 1) return false;              // bugün zaten gördü
    if (page.type === 'PRODUCT' && !R.product_page) return false;
    return true;
  }
  var delayTimer = null;
  function arm() {
    clearTimeout(delayTimer);
    if (!eligibleNow()) return;
    if (R.min_pages > 0 && st.pages >= R.min_pages) { setTimeout(function () { if (eligibleNow()) showCard('pages'); }, 900); return; }
    if (R.delay > 0) delayTimer = setTimeout(function () { if (eligibleNow()) showCard('delay'); }, R.delay * 1000);
  }
  function armExit() {
    if (!R.exit_intent || isMobile() || ('ontouchstart' in window)) return;
    document.addEventListener('mouseout', function (e) { if (e.clientY <= 0 && !e.relatedTarget && eligibleNow()) showCard('exit'); });
  }
  function onPage() {
    page = readPage();
    st.pages++; save();
    if (hidden() && cardEl) closeCard();
    syncPill();
    arm();
  }
  function watch() {
    lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname !== lastPath) { lastPath = location.pathname; setTimeout(onPage, 700); }
      if (host && host.isConnected === false) document.body.appendChild(host);
    }, 400);
  }
  function start() {
    mount();
    onPage();
    watch();
    armExit();
    if (FORCE) showCard('force');
  }
  function init() {
    fetch(API + '/config?member=' + encodeURIComponent(member()), { mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.enabled || !j.rules || (!j.eligible && !FORCE)) return;
        R = j.rules;
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
      })
      .catch(function () {});
  }
  init();
})();
