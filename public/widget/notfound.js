/*! Yunbi 404 Sayfası (CRO) — "sayfa bulunamadı" ekranını eğlenceli bir şablon + gerçek ürün önerileriyle değiştirir.
 *  <script src="https://hub.yunbi.ai/widget/notfound.js?v=1" data-tenant="SLUG" async></script>  (tüm sayfalar)
 *  Yalnız 404 sayfasında çalışır: adres (/PageNotFound.aspx, /404, aspxerrorpath), başlık (404 / bulunamadı),
 *  seçici veya tarayıcının 404 durum kodu. Diğer sayfalarda ağ isteği YAPMAZ.
 *  Test: herhangi bir adresin sonuna #yunbi404 (veya ?yunbi404=1) ekleyin.  Tema içinden: window.YunbiNotFound.show()
 */
(function () {
  'use strict';
  if (window.__yunbiNotFoundLoaded) return;
  window.__yunbiNotFoundLoaded = true;

  var SCRIPT = document.currentScript || document.querySelector('script[src*="/widget/notfound.js"]');
  if (!SCRIPT) return;
  var SLUG = SCRIPT.getAttribute('data-tenant');
  if (!SLUG) return;
  var BASE = SCRIPT.getAttribute('data-api') || SCRIPT.src.replace(/\/widget\/notfound\.js.*$/, '');
  var API = BASE + '/w/' + encodeURIComponent(SLUG) + '/notfound';
  var DEMO = SCRIPT.getAttribute('data-demo') === '1';
  // Test: ?yunbi404=1 ya da #yunbi404 (hash sunucuya gitmez; Ticimax yönlendirmesi parametreyi silse de kalır)
  var FORCE = SCRIPT.getAttribute('data-force') === '1' || /[?&]yunbi404=1/.test(location.search) || /yunbi404/.test(location.hash);
  var DEBUG = /yunbi_debug=1/.test(location.search);

  var DETECT_PATHS = ['/pagenotfound', '/404', 'aspxerrorpath=', '/hata/404', '/notfound', '/sayfa-bulunamadi']
    .concat((SCRIPT.getAttribute('data-paths') || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean));
  var DETECT_SEL = ['.pageNotFound', '#pageNotFound', '.notFoundPage', '.page-not-found', '.error-404', '.error404', '#notFound', '.Hata404']
    .concat((SCRIPT.getAttribute('data-selectors') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
  // "404" yalnız ayrı kelime olarak (ürün kodu TB404 eşleşmez); "bulunamadı" yalnız SAYFA ile (arama sonucu yok sayfası tetiklemesin)
  var TITLE_RE = /(^|[\s\-|:])404([\s\-|:]|$)|sayfa bulunamad|page not found|sayfa yok/i;

  var C = null, TPL = null, shown = false, host = null, root = null, rafs = [];

  function log() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-404]'].concat([].slice.call(arguments))); }
  function sid() {
    try { var s = localStorage.getItem('yunbi_sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('yunbi_sid', s); } return s; } catch (e) { return ''; }
  }
  function device() { return (window.innerWidth || 1024) < 900 ? 'm' : 'd'; }
  function lostPath() {
    var m = location.search.match(/aspxerrorpath=([^&#]+)/i);
    var p = m ? decodeURIComponent(m[1]) : location.pathname + location.search.replace(/[?&]yunbi404=1/, '');
    return (SCRIPT.getAttribute('data-path') || p).slice(0, 300);
  }
  function send(body) {
    if (DEMO) return;
    var payload = JSON.stringify(Object.assign({ sid: sid(), path: lostPath(), device: device(), template: C && C.template }, body));
    try {
      if (navigator.sendBeacon) { navigator.sendBeacon(API + '/event', new Blob([payload], { type: 'text/plain' })); return; }
      fetch(API + '/event', { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) {}
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = +n || 0; try { return n.toLocaleString('tr-TR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' TL'; } catch (e) { return n + ' TL'; } }
  function abs(u) { if (!u) return '#'; if (/^https?:\/\//.test(u)) return u; return (DEMO && C.shop_url ? C.shop_url : '') + (u.charAt(0) === '/' ? u : '/' + u); }
  function home() { return DEMO && C.shop_url ? C.shop_url + '/' : '/'; }
  function onAccent(hex) {
    var n = parseInt(String(hex).slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0a0a12' : '#ffffff';
  }
  function tgt() { return DEMO ? ' target="_blank" rel="noopener"' : ''; }

  /* ── Tespit ── */
  function navStatus() {
    try { var n = performance.getEntriesByType('navigation')[0]; return n && n.responseStatus; } catch (e) { return 0; }
  }
  function isNotFound() {
    if (FORCE) return 'force';
    var href = (location.pathname + location.search).toLowerCase();
    for (var i = 0; i < DETECT_PATHS.length; i++) {
      var p = DETECT_PATHS[i];
      if (p === '/404' ? /\/404(\/|\.|$|\?)/.test(href) : href.indexOf(p) !== -1) return 'path';
    }
    if (navStatus() === 404) return 'status';
    if (TITLE_RE.test(document.title || '')) return 'title';
    for (var j = 0; j < DETECT_SEL.length; j++) { try { if (document.querySelector(DETECT_SEL[j])) return 'selector'; } catch (e) {} }
    return '';
  }

  /* ── Şablonlar ── */
  var SNEAKER = function (c) {
    return '<svg class="shoe" viewBox="0 0 140 84" aria-hidden="true"><g class="shoe-body">' +
      '<path d="M10 58c0-14 8-24 20-26l22-4c7-1 11-7 15-12h10c4 9 13 15 27 19l16 4c9 2 14 9 14 19z" fill="' + c + '"/>' +
      '<path d="M54 30l6 9M62 26l6 9M70 22l6 9" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="7" y="58" width="130" height="13" rx="6.5" fill="#fff" stroke="#1f2937" stroke-width="3"/>' +
      '<path d="M18 64h110" stroke="#1f2937" stroke-width="2" stroke-dasharray="4 5"/>' +
      '<g class="eyes"><circle cx="100" cy="42" r="7" fill="#fff"/><circle cx="116" cy="45" r="6" fill="#fff"/>' +
      '<circle class="pupil" cx="101" cy="43" r="3.2" fill="#111"/><circle class="pupil" cx="117" cy="46" r="2.8" fill="#111"/></g></g></svg>';
  };
  var ASTRO = '<svg class="astro" viewBox="0 0 120 140" aria-hidden="true">' +
    '<path d="M60 92l-10 34M60 92l12 32" stroke="#e5e7eb" stroke-width="13" stroke-linecap="round"/>' +
    '<rect x="32" y="56" width="56" height="50" rx="22" fill="#f3f4f6"/>' +
    '<path d="M34 72L12 58M86 72l22-18" stroke="#f3f4f6" stroke-width="12" stroke-linecap="round"/>' +
    '<rect x="48" y="74" width="24" height="14" rx="4" fill="#c4b5fd"/><circle cx="54" cy="81" r="2.5" fill="#7c3aed"/><circle cx="66" cy="81" r="2.5" fill="#f472b6"/>' +
    '<circle cx="60" cy="40" r="30" fill="#f9fafb"/><rect x="38" y="26" width="44" height="30" rx="15" fill="#1e1b4b"/>' +
    '<path d="M46 34c4-4 10-5 15-3" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';
  var GLASS = '<svg class="glass" viewBox="0 0 120 120" aria-hidden="true"><circle cx="48" cy="48" r="32" fill="rgba(255,255,255,.35)" stroke="#3f2d1d" stroke-width="9"/>' +
    '<path d="M72 72l34 34" stroke="#3f2d1d" stroke-width="13" stroke-linecap="round"/><path d="M30 38c4-8 12-12 20-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/></svg>';

  var TEMPLATES = {
    lost_pair: {
      accent: '#ea580c', bg: '#fff7ed', ink: '#1c1917', muted: '#78716c', card: '#ffffff', line: '#fde3c8',
      title: 'Bu sayfanın teki kayıp!', sub: 'Aradığın sayfa çiftini bulamadı. Ama üzülme, aşağıdakilerin hepsi çift çift duruyor 👟',
      hero: function (a) {
        return '<div class="art lp"><div class="steps"><i></i><i></i><i></i><i></i></div>' + SNEAKER(a) + '<span class="q">?</span><div class="shadow"></div></div>';
      },
      css: '.lp{position:relative;height:150px;max-width:360px;margin:0 auto}.lp .shoe{position:absolute;left:50%;bottom:18px;width:150px;margin-left:-75px;animation:lpHop 2.6s ease-in-out infinite;transform-origin:50% 100%}' +
        '.lp .pupil{animation:lpLook 2.6s ease-in-out infinite}.lp .q{position:absolute;left:50%;top:0;margin-left:52px;font:800 34px/1 var(--f);color:var(--a);animation:lpQ 2.6s ease-in-out infinite}' +
        '.lp .shadow{position:absolute;left:50%;bottom:8px;width:120px;height:10px;margin-left:-60px;border-radius:50%;background:rgba(0,0,0,.08);animation:lpSh 2.6s ease-in-out infinite}' +
        '.lp .steps{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:space-between;padding:0 6%}.lp .steps i{width:16px;height:8px;border-radius:50%;background:var(--line);transform:rotate(-12deg)}.lp .steps i:nth-child(even){transform:translateY(-8px) rotate(-12deg)}' +
        '@keyframes lpHop{0%,100%{transform:translateY(0) rotate(0)}20%{transform:translateY(-22px) rotate(-6deg)}40%{transform:translateY(0) rotate(0) scaleY(.94)}60%{transform:translateY(-10px) rotate(5deg)}80%{transform:translateY(0)}}' +
        '@keyframes lpLook{0%,30%{transform:translateX(0)}45%,65%{transform:translateX(-3px)}80%,100%{transform:translateX(2px)}}' +
        '@keyframes lpQ{0%,100%{transform:translateY(0) rotate(-8deg);opacity:.9}50%{transform:translateY(-8px) rotate(10deg);opacity:1}}' +
        '@keyframes lpSh{0%,100%,40%,80%{transform:scaleX(1)}20%{transform:scaleX(.7)}60%{transform:scaleX(.85)}}'
    },
    space: {
      accent: '#a78bfa', bg: '#0b1026', ink: '#f5f3ff', muted: '#c4b5fd', card: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.12)', dark: true,
      title: 'Houston, bir sorunumuz var!', sub: 'Bu sayfa uzay boşluğuna sürüklendi. Seni dünyaya en sevilen ürünlerle geri getirelim 🚀',
      hero: function () {
        return '<div class="art sp"><div class="stars s1"></div><div class="stars s2"></div><div class="planet"><b>404</b></div>' + ASTRO + '</div>';
      },
      css: '.yn{background:radial-gradient(1200px 500px at 50% -10%,#312e81 0%,#0b1026 55%)}.sp{position:relative;height:190px;max-width:420px;margin:0 auto}' +
        '.sp .stars{position:absolute;inset:-30px -40px;background-repeat:repeat;opacity:.85}' +
        '.sp .s1{background-image:radial-gradient(1.5px 1.5px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 90px 70px,#fff,transparent),radial-gradient(1.5px 1.5px at 160px 20px,#c4b5fd,transparent),radial-gradient(1px 1px at 230px 110px,#fff,transparent);background-size:260px 140px;animation:spTw 3s ease-in-out infinite}' +
        '.sp .s2{background-image:radial-gradient(1px 1px at 50px 90px,#fff,transparent),radial-gradient(2px 2px at 140px 50px,#fbcfe8,transparent),radial-gradient(1px 1px at 210px 10px,#fff,transparent);background-size:300px 160px;animation:spTw 4.5s ease-in-out infinite reverse}' +
        '.sp .planet{position:absolute;right:8%;top:28px;width:96px;height:96px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#c4b5fd,#7c3aed 60%,#4c1d95);box-shadow:0 0 40px rgba(167,139,250,.45);display:flex;align-items:center;justify-content:center}' +
        '.sp .planet:after{content:"";position:absolute;left:-22px;right:-22px;top:42px;height:14px;border:3px solid rgba(251,207,232,.75);border-radius:50%;transform:rotate(-14deg)}' +
        '.sp .planet b{font:900 26px/1 var(--f);color:#fff;letter-spacing:.04em;text-shadow:0 2px 0 rgba(0,0,0,.25)}' +
        '.sp .astro{position:absolute;left:10%;top:22px;width:110px;animation:spFloat 6s ease-in-out infinite}' +
        '@keyframes spFloat{0%,100%{transform:translate(0,0) rotate(-12deg)}50%{transform:translate(18px,-14px) rotate(14deg)}}@keyframes spTw{0%,100%{opacity:.85}50%{opacity:.35}}'
    },
    balloons: {
      accent: '#ec4899', bg: '#eff6ff', ink: '#172554', muted: '#475569', card: '#ffffff', line: '#dbeafe',
      title: 'Sayfa uçtu, balonlar kaldı!', sub: 'Balonları patlat, içinden ne çıkacak gör 🎈',
      hero: function () {
        var cols = ['#ec4899', '#3b82f6', '#f59e0b'], d = ['4', '0', '4'], h = '<div class="art bl">';
        for (var i = 0; i < 3; i++) {
          h += '<button class="bal" data-i="' + i + '" style="--c:' + cols[i] + ';animation-delay:' + (-i * 0.9) + 's" aria-label="Balonu patlat"><span class="bb">' + d[i] + '</span><span class="str"></span><span class="prize"></span></button>';
        }
        return h + '</div><p class="hint">Balonlara dokun</p>';
      },
      css: '.bl{display:flex;justify-content:center;gap:14px;height:200px;align-items:flex-start;padding-top:6px}' +
        '.bal{all:unset;cursor:pointer;position:relative;width:92px;height:190px;animation:blUp 3.2s ease-in-out infinite;-webkit-tap-highlight-color:transparent}' +
        '.bal .bb{position:absolute;left:3px;top:0;width:86px;height:104px;border-radius:50% 50% 48% 48%/55% 55% 45% 45%;background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.65) 0 10%,transparent 11%),var(--c);display:flex;align-items:center;justify-content:center;font:900 40px/1 var(--f);color:#fff;box-shadow:inset -8px -10px 0 rgba(0,0,0,.12);transition:transform .15s}' +
        '.bal .bb:after{content:"";position:absolute;bottom:-7px;left:50%;margin-left:-6px;border:6px solid transparent;border-bottom:8px solid var(--c);transform:rotate(180deg)}' +
        '.bal .str{position:absolute;top:110px;left:50%;width:2px;height:70px;background:linear-gradient(#94a3b8,transparent);transform-origin:top;animation:blStr 1.6s ease-in-out infinite}' +
        '.bal:hover .bb{transform:scale(1.05)}.bal.pop .bb,.bal.pop .str{animation:blPop .32s ease-out forwards}' +
        '.bal .prize{position:absolute;left:-3px;right:-3px;top:0;opacity:0;transform:scale(.6);transition:all .35s cubic-bezier(.2,1.6,.4,1) .12s;pointer-events:none}' +
        '.bal.pop{animation:none}.bal.pop .prize{opacity:1;transform:scale(1);pointer-events:auto}' +
        '.prize a{display:block;background:#fff;border-radius:14px;padding:6px;box-shadow:0 10px 24px rgba(30,64,175,.18);text-decoration:none;color:var(--ink)}.prize img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;display:block;background:#f1f5f9}' +
        '.prize .pp{font:800 12px/1.2 var(--f);margin-top:5px;text-align:center;color:var(--a)}' +
        '.hint{text-align:center;font:600 12px/1 var(--f);color:var(--muted);margin:2px 0 0;letter-spacing:.06em;text-transform:uppercase}' +
        '.cf{position:absolute;width:8px;height:12px;border-radius:2px;top:50px;left:50%;pointer-events:none;animation:blCf .9s ease-out forwards}' +
        '@keyframes blUp{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-12px) rotate(3deg)}}@keyframes blStr{0%,100%{transform:rotate(4deg)}50%{transform:rotate(-4deg)}}' +
        '@keyframes blPop{0%{transform:scale(1)}40%{transform:scale(1.25);opacity:.9}100%{transform:scale(0);opacity:0}}@keyframes blCf{to{transform:translate(var(--x),var(--y)) rotate(var(--r));opacity:0}}'
    },
    detective: {
      accent: '#b45309', bg: '#fbf5e6', ink: '#3f2d1d', muted: '#7c6a55', card: '#fffdf7', line: '#ead9b8',
      title: 'Vaka #404: Kayıp Sayfa', sub: 'Dedektiflerimiz iz sürdü. Sayfa ortada yok ama ipuçları bizi şuraya götürdü…',
      hero: function () {
        return '<div class="art dt"><div class="file"><span class="stamp">KAYIP</span><span class="l w1"></span><span class="l w2"></span><span class="l w3"></span><span class="pin"></span></div>' + GLASS + '</div>';
      },
      css: '.yn{background-image:radial-gradient(rgba(63,45,29,.06) 1px,transparent 1px);background-size:16px 16px}.dt{position:relative;height:170px;max-width:340px;margin:0 auto}' +
        '.dt .file{position:absolute;left:50%;top:14px;width:200px;height:136px;margin-left:-100px;background:#f3e3bf;border:2px solid #d9c08d;border-radius:6px;transform:rotate(-4deg);box-shadow:0 8px 18px rgba(63,45,29,.15)}' +
        '.dt .l{display:block;height:7px;border-radius:4px;background:#d9c08d;margin:12px 18px 0}.dt .w1{margin-top:58px;width:60%}.dt .w2{width:80%}.dt .w3{width:45%}' +
        '.dt .stamp{position:absolute;right:14px;top:14px;font:900 20px/1 var(--f);letter-spacing:.12em;color:#b91c1c;border:3px solid #b91c1c;border-radius:6px;padding:5px 8px;transform:rotate(10deg);opacity:.85}' +
        '.dt .pin{position:absolute;left:18px;top:-8px;width:16px;height:16px;border-radius:50%;background:#dc2626;box-shadow:0 2px 0 #7f1d1d}' +
        '.dt .glass{position:absolute;left:50%;top:30px;width:100px;margin-left:-30px;animation:dtScan 4s ease-in-out infinite;transition:transform .1s}' +
        '.typing:after{content:"▍";animation:dtCar 1s steps(1) infinite;color:var(--a)}' +
        '@keyframes dtScan{0%,100%{transform:translate(-60px,0) rotate(-8deg)}50%{transform:translate(40px,18px) rotate(8deg)}}@keyframes dtCar{50%{opacity:0}}'
    },
    arcade: {
      accent: '#22d3ee', bg: '#0a0a12', ink: '#e0f2fe', muted: '#94a3b8', card: '#111827', line: '#1f2a44', dark: true, pixel: true,
      title: 'GAME OVER', sub: 'Bu seviye bulunamadı. Bir tur oyna ya da yeni bir göreve başla ▶',
      hero: function () {
        return '<div class="art ar"><div class="glitch" data-t="404">404</div><div class="game"><canvas width="640" height="190"></canvas><div class="gmsg">BAŞLAMAK İÇİN DOKUN</div><div class="score">SKOR 0</div></div></div>';
      },
      css: '.yn:before{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px);z-index:1}' +
        '.ar{max-width:640px;margin:0 auto}.glitch{position:relative;font:400 54px/1 var(--px);color:#fff;text-align:center;letter-spacing:.06em;text-shadow:3px 0 #ec4899,-3px 0 #22d3ee;animation:arGl 2.4s steps(1) infinite}' +
        '.h1.px{font-family:var(--px);font-size:20px;letter-spacing:.04em;color:#facc15;animation:arBl 1.1s steps(1) infinite}' +
        '.game{position:relative;margin:16px auto 0;border:3px solid #22d3ee;border-radius:6px;box-shadow:0 0 0 3px #0a0a12,0 0 24px rgba(34,211,238,.35);background:#05050b;touch-action:manipulation;cursor:pointer;user-select:none;-webkit-user-select:none}' +
        '.game canvas{display:block;width:100%;height:auto;image-rendering:pixelated}.gmsg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font:400 11px/1.8 var(--px);color:#facc15;padding:0 12px;pointer-events:none}' +
        '.score{position:absolute;right:10px;top:8px;font:400 10px/1 var(--px);color:#e0f2fe}' +
        '@keyframes arGl{0%,90%{transform:none}92%{transform:translate(3px,-1px) skewX(8deg)}94%{transform:translate(-3px,1px)}96%{transform:none}}@keyframes arBl{50%{opacity:.35}}'
    },
    minimal: {
      accent: '#111827', bg: '#ffffff', ink: '#111827', muted: '#6b7280', card: '#ffffff', line: '#eceef1',
      title: 'Aradığınız sayfa bulunamadı', sub: 'Bağlantı değişmiş ya da kaldırılmış olabilir. Sizin için seçtiklerimize göz atın.',
      hero: function () {
        return '<div class="art mn"><span>4</span><span class="o"><i></i></span><span>4</span></div>';
      },
      css: '.mn{display:flex;justify-content:center;align-items:center;gap:6px;font:200 104px/1 var(--f);letter-spacing:-.02em;color:var(--ink);height:130px}' +
        '.mn .o{position:relative;width:78px;height:96px;border:5px solid var(--ink);border-radius:50%;overflow:hidden}.mn .o i{position:absolute;left:-10%;right:-10%;height:4px;top:50%;background:var(--ink);animation:mnLine 3.5s ease-in-out infinite}' +
        '.mn span:not(.o){animation:mnIn .8s cubic-bezier(.2,.8,.2,1) both}.mn span:last-child{animation-delay:.12s}' +
        '@keyframes mnLine{0%,100%{transform:translateY(-34px) rotate(-8deg)}50%{transform:translateY(34px) rotate(8deg)}}@keyframes mnIn{from{opacity:0;transform:translateY(14px)}}'
    }
  };

  /* ── Ortak CSS ── */
  function baseCss(t, accent) {
    var dark = !!t.dark;
    return ':host{all:initial}*{box-sizing:border-box}' +
      '.yn{--a:' + accent + ';--bg:' + t.bg + ';--ink:' + t.ink + ';--muted:' + t.muted + ';--card:' + t.card + ';--line:' + t.line + ';' +
      '--f:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--px:"Press Start 2P",ui-monospace,Menlo,monospace;' +
      'font-family:var(--f);color:var(--ink);background:var(--bg);min-height:100%;-webkit-font-smoothing:antialiased;position:relative}' +
      '.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:' + (dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.85)') + ';backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}' +
      '.top a{color:var(--ink);text-decoration:none}.logo img{height:26px;max-width:170px;object-fit:contain;display:block;' + (dark ? 'filter:brightness(0) invert(1)' : '') + '}.logo b{font:800 15px/1 var(--f);letter-spacing:.12em;text-transform:uppercase}' +
      '.homebtn{font:700 13px/1 var(--f);padding:9px 14px;border-radius:999px;border:1.5px solid var(--line)}' +
      '.wrap{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:22px 16px 48px}' +
      '.hero{text-align:center}.h1{font:800 clamp(24px,6vw,38px)/1.15 var(--f);margin:14px 0 8px;letter-spacing:-.01em}.sub{font:400 15px/1.55 var(--f);color:var(--muted);max-width:520px;margin:0 auto}' +
      '.search{display:flex;gap:8px;max-width:520px;margin:20px auto 0;background:var(--card);border:1.5px solid var(--line);border-radius:999px;padding:5px 5px 5px 16px;align-items:center}' +
      '.search input{all:unset;flex:1;min-width:0;text-align:left;font:500 15px/1.4 var(--f);color:var(--ink);padding:8px 0}.search input::placeholder{color:var(--muted)}' +
      '.search button,.btn{all:unset;cursor:pointer;background:var(--a);color:' + onAccent(accent) + ';font:700 14px/1 var(--f);padding:11px 18px;border-radius:999px;text-align:center}' +
      '.cats{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:18px auto 0;max-width:720px}' +
      '.cats a{font:600 13px/1 var(--f);color:var(--ink);text-decoration:none;padding:9px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);transition:transform .15s,border-color .15s}.cats a:hover{transform:translateY(-1px);border-color:var(--a)}' +
      '.sec{margin-top:34px}.st{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 10px;margin:0 0 12px}.st h2{font:800 18px/1.2 var(--f);margin:0}.st span{font:500 12px/1.3 var(--f);color:var(--muted)}' +
      '.rail{display:grid;grid-auto-flow:column;grid-auto-columns:42%;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;scrollbar-width:none}.rail::-webkit-scrollbar{display:none}' +
      '@media(min-width:700px){.rail{grid-auto-flow:row;grid-template-columns:repeat(4,1fr);overflow:visible}}' +
      '.card{scroll-snap-align:start;display:block;text-decoration:none;color:var(--ink);background:var(--card);border-radius:14px;overflow:hidden;border:1px solid var(--line);transition:transform .2s,box-shadow .2s;min-width:0}' +
      '.card:hover{transform:translateY(-3px);box-shadow:0 12px 28px ' + (dark ? 'rgba(0,0,0,.45)' : 'rgba(17,24,39,.10)') + '}' +
      '.ci{position:relative;aspect-ratio:3/4;background:' + (dark ? '#1f2937' : '#f4f4f5') + '}.ci img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.disc{position:absolute;left:8px;top:8px;background:var(--a);color:' + onAccent(accent) + ';font:800 11px/1 var(--f);padding:5px 7px;border-radius:6px}' +
      '.cb{padding:9px 10px 11px}.cn{font:500 12.5px/1.35 var(--f);height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '.cp{margin-top:6px;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.cp b{font:800 14px/1 var(--f)}.cp s{font:400 12px/1 var(--f);color:var(--muted)}' +
      '.coupon{margin:30px auto 0;max-width:520px;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;border:2px dashed var(--a);background:var(--card)}' +
      '.coupon p{margin:0;flex:1;font:500 14px/1.4 var(--f)}.coupon code{font:800 16px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--a)}' +
      '.foot{text-align:center;margin-top:34px}.foot a{color:var(--ink);font:700 14px/1 var(--f);text-decoration:none;border-bottom:2px solid var(--a);padding-bottom:3px}' +
      (t.pixel ? '.h1,.st h2{font-family:var(--px);font-size:15px;line-height:1.5}.card{border-radius:4px;border:2px solid var(--line)}.btn,.search button{border-radius:4px;font-family:var(--px);font-size:11px}' : '') +
      '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}';
  }

  function card(p, target) {
    var price = p.dprice ? '<b>' + money(p.dprice) + '</b><s>' + money(p.price) + '</s>' : '<b>' + money(p.price) + '</b>';
    return '<a class="card" href="' + esc(abs(p.url)) + '"' + tgt() + ' data-pid="' + p.id + '" data-t="' + target + '">' +
      '<div class="ci">' + (p.img ? '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy">' : '') +
      (p.discount_pct >= 5 ? '<span class="disc">%' + p.discount_pct + '</span>' : '') + '</div>' +
      '<div class="cb"><div class="cn">' + esc(p.name) + '</div><div class="cp">' + price + '</div></div></a>';
  }

  function render() {
    var t = TEMPLATES[C.template] || TEMPLATES.lost_pair, c = C.content || {};
    TPL = t;
    var accent = c.accent || t.accent;
    var title = c.title || t.title, sub = c.subtitle || t.sub;
    var mode = (C.rules && C.rules.display) || 'overlay', mount = null;
    if (mode !== 'overlay') {
      var sels = String((C.rules && C.rules.mount_selector) || '').split(',');
      for (var i = 0; i < sels.length && !mount; i++) { try { var el = sels[i].trim() && document.querySelector(sels[i].trim()); if (el && el !== document.body && el.offsetHeight > 0) mount = el; } catch (e) {} }
      if (!mount && mode === 'inline') log('mount bulunamadı, tam ekran');
    }
    host = document.createElement('div');
    host.id = 'yunbi-404';
    if (mount) {
      [].forEach.call(mount.children, function (ch) { ch.style.setProperty('display', 'none', 'important'); });
      mount.insertBefore(host, mount.firstChild);
    } else {
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow-y:auto;-webkit-overflow-scrolling:touch;background:' + t.bg;
      document.documentElement.style.overflow = 'hidden';
      document.body.appendChild(host);
    }
    if (C.rules && C.rules.hide_selectors) { try { [].forEach.call(document.querySelectorAll(C.rules.hide_selectors), function (el) { el.style.setProperty('display', 'none', 'important'); }); } catch (e) {} }
    if (t.pixel && !document.getElementById('yunbi-404-font')) {
      // Piksel yazı tipi hub'dan (OFL); @font-face gölge DOM içinde tanımlanamaz → belgeye
      var fs = document.createElement('style'); fs.id = 'yunbi-404-font';
      fs.textContent = "@font-face{font-family:'Press Start 2P';font-display:swap;src:url(" + BASE + "/widget/fonts/ps2p-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+2000-206F}" +
        "@font-face{font-family:'Press Start 2P';font-display:swap;src:url(" + BASE + "/widget/fonts/ps2p-latin-ext.woff2) format('woff2');unicode-range:U+0100-0130,U+0132-02BA}";
      document.head.appendChild(fs);
    }
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var logo = C.logo_url ? '<img src="' + esc(C.logo_url) + '" alt="' + esc(C.shop_name) + '">' : '<b>' + esc(C.shop_name || 'Ana sayfa') + '</b>';
    var h = '<style>' + baseCss(t, accent) + t.css + '</style><div class="yn">';
    if (!mount) h += '<div class="top"><a class="logo" href="' + esc(home()) + '"' + tgt() + ' data-t="logo">' + logo + '</a><a class="homebtn" href="' + esc(home()) + '"' + tgt() + ' data-t="home">' + esc(c.home_text || 'Ana sayfa') + '</a></div>';
    h += '<div class="wrap"><div class="hero">' + t.hero(accent) +
      '<h1 class="h1' + (t.pixel ? ' px' : '') + '">' + esc(title) + '</h1><p class="sub' + (C.template === 'detective' ? ' typing' : '') + '" data-full="' + esc(sub) + '">' + (C.template === 'detective' ? '' : esc(sub)) + '</p>';
    if (c.show_search !== false) h += '<form class="search" role="search"><input type="search" name="q" placeholder="Ne aramıştın?" value="' + esc(C.query && C.query.split(' ').length <= 4 ? C.query : '') + '" aria-label="Ürün ara"><button type="submit">Ara</button></form>';
    if (C.categories && C.categories.length) h += '<nav class="cats">' + C.categories.map(function (k) { return '<a href="' + esc(abs(k.url)) + '"' + tgt() + ' data-t="category">' + esc(k.name) + '</a>'; }).join('') + '</nav>';
    h += '</div>';
    if (C.matched && C.matched.length) h += '<section class="sec"><div class="st"><h2>' + esc(c.matched_title || 'Bunu mu arıyordunuz?') + '</h2><span>adrese benzeyen ürünler</span></div><div class="rail">' + C.matched.slice(0, 4).map(function (p) { return card(p, 'matched'); }).join('') + '</div></section>';
    var rail = C.products || [];
    if (C.template === 'balloons') rail = rail.slice(3);
    if (rail.length) h += '<section class="sec"><div class="st"><h2>' + esc(c.products_title || 'Herkesin kapıştığı ürünler') + '</h2></div><div class="rail">' + rail.slice(0, 8).map(function (p) { return card(p, 'product'); }).join('') + '</div></section>';
    if (c.coupon_code) h += '<div class="coupon"' + (C.template === 'balloons' ? ' hidden' : '') + '><p>' + esc(c.coupon_text || 'Kaybolduğun için küçük bir hediye:') + '<br><code>' + esc(c.coupon_code) + '</code></p><button class="btn" data-copy>Kopyala</button></div>';
    h += '<div class="foot"><a href="' + esc(home()) + '"' + tgt() + ' data-t="home">' + esc(c.home_text || 'Ana sayfaya dön') + ' →</a></div></div></div>';
    root.innerHTML = h;
    bind();
    if (t === TEMPLATES.balloons) initBalloons();
    if (t === TEMPLATES.detective) initDetective();
    if (t === TEMPLATES.arcade) initArcade();
    send({ type: 'view', matched: (C.matched || []).length, ref: (document.referrer || '').slice(0, 300) });
  }

  function bind() {
    root.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-t]');
      if (a) send({ type: 'click', target: a.getAttribute('data-t'), product_id: a.getAttribute('data-pid') || '' });
      var cp = e.target.closest && e.target.closest('[data-copy]');
      if (cp) {
        var code = (C.content || {}).coupon_code || '';
        try { navigator.clipboard.writeText(code); } catch (x) {}
        cp.textContent = 'Kopyalandı ✓'; send({ type: 'coupon' });
      }
    });
    var f = root.querySelector('form.search');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = (f.q.value || '').trim(); if (!q) return;
      send({ type: 'search', query: q });
      var url = ((C.rules && C.rules.search_url) || '/arama?q={q}').replace('{q}', encodeURIComponent(q));
      url = abs(url);
      if (DEMO) window.open(url, '_blank'); else location.href = url;
    });
  }

  /* ── Balon oyunu: her balondan gerçek bir ürün çıkar ── */
  function initBalloons() {
    var prizes = (C.products || []).slice(0, 3), popped = 0;
    [].forEach.call(root.querySelectorAll('.bal'), function (b) {
      b.addEventListener('click', function (e) {
        if (b.classList.contains('pop')) return;
        e.preventDefault();
        var p = prizes[+b.getAttribute('data-i')];
        b.querySelector('.prize').innerHTML = p ? '<a href="' + esc(abs(p.url)) + '"' + tgt() + ' data-pid="' + p.id + '" data-t="product"><img src="' + esc(p.img || '') + '" alt="' + esc(p.name) + '"><div class="pp">' + money(p.dprice || p.price) + '</div></a>' : '<div style="font-size:46px;text-align:center">🎉</div>';
        b.classList.add('pop');
        var cols = ['#ec4899', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'];
        for (var i = 0; i < 16; i++) {
          var s = document.createElement('i'); s.className = 'cf';
          var ang = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 70;
          s.style.cssText = 'background:' + cols[i % 5] + ';--x:' + Math.round(Math.cos(ang) * dist) + 'px;--y:' + Math.round(Math.sin(ang) * dist) + 'px;--r:' + Math.round(Math.random() * 540) + 'deg';
          b.appendChild(s); setTimeout(function (n) { return function () { n.remove(); }; }(s), 950);
        }
        if (++popped === 3) {
          var hint = root.querySelector('.hint'); if (hint) hint.textContent = 'Hepsini patlattın! 🎉';
          var cp = root.querySelector('.coupon'); if (cp) cp.hidden = false;
          send({ type: 'game' });
        }
      });
    });
  }

  /* ── Dedektif: daktilo metni + büyüteç parmağı/fareyi izler ── */
  function initDetective() {
    var p = root.querySelector('.typing'), full = p.getAttribute('data-full') || '', i = 0;
    (function tick() { p.textContent = full.slice(0, ++i); if (i < full.length) setTimeout(tick, 28); else setTimeout(function () { p.classList.remove('typing'); }, 1500); })();
    var art = root.querySelector('.dt'), g = root.querySelector('.glass');
    if (art && g && window.matchMedia && matchMedia('(pointer:fine)').matches) {
      art.addEventListener('mousemove', function (e) { var r = art.getBoundingClientRect(); g.style.animation = 'none'; g.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2 - 20) + 'px,' + (e.clientY - r.top - 70) + 'px)'; });
      art.addEventListener('mouseleave', function () { g.style.animation = ''; g.style.transform = ''; });
    }
  }

  /* ── Arcade: ayakkabı "404" bloklarının üstünden zıplar (dokun / boşluk) ── */
  function initArcade() {
    var box = root.querySelector('.game'), cv = box.querySelector('canvas'), ctx = cv.getContext('2d'), msg = box.querySelector('.gmsg'), sc = box.querySelector('.score');
    var W = cv.width, H = cv.height, G = H - 34, st = 'idle', y, vy, obs, speed, score, best = 0, last, spawn, sentGame = false;
    function reset() { y = G; vy = 0; obs = []; speed = 4.2; score = 0; spawn = 60; }
    function jump() {
      if (st === 'idle' || st === 'over') { reset(); st = 'run'; msg.textContent = ''; last = 0; loop(0); return; }
      if (y >= G - 0.5) vy = -11.2;
    }
    function draw() {
      ctx.fillStyle = '#05050b'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1f2a44'; for (var x = (-(score * 4) % 32); x < W; x += 32) ctx.fillRect(x, G + 22, 18, 3);
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(0, G + 18, W, 3);
      // oyuncu: piksel ayakkabı
      var px = 70, py = y;
      ctx.fillStyle = '#ec4899'; ctx.fillRect(px, py - 6, 46, 18); ctx.fillRect(px + 18, py - 18, 20, 14);
      ctx.fillStyle = '#fff'; ctx.fillRect(px - 2, py + 12, 52, 6); ctx.fillRect(px + 30, py - 2, 6, 6);
      ctx.fillStyle = '#05050b'; ctx.fillRect(px + 32, py, 3, 3);
      ctx.font = '12px "Press Start 2P", monospace';
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i]; ctx.fillStyle = '#facc15'; ctx.fillRect(o.x, G + 18 - o.h, o.w, o.h);
        ctx.fillStyle = '#05050b'; ctx.fillText('404', o.x + 4, G + 18 - o.h + 16);
      }
    }
    function loop(ts) {
      if (st !== 'run') return;
      vy += 0.62; y = Math.min(G, y + vy);
      if (--spawn <= 0) { var hh = 24 + Math.round(Math.random() * 18); obs.push({ x: W + 10, w: 44, h: hh }); spawn = 52 + Math.round(Math.random() * 46) - Math.min(28, score / 4); }
      for (var i = obs.length - 1; i >= 0; i--) {
        var o = obs[i]; o.x -= speed;
        if (o.x + o.w < 0) { obs.splice(i, 1); score++; speed = Math.min(9, speed + 0.12); continue; }
        if (o.x < 70 + 44 && o.x + o.w > 72 && y + 16 > G + 18 - o.h) { return over(); }
      }
      sc.textContent = 'SKOR ' + score;
      draw();
      rafs.push(requestAnimationFrame(loop));
    }
    function over() {
      st = 'over'; best = Math.max(best, score); draw();
      msg.innerHTML = 'OYUN BİTTİ — SKOR ' + score + '<br>EN İYİ ' + best + '<br><br>TEKRAR İÇİN DOKUN';
      if (!sentGame) { sentGame = true; send({ type: 'game' }); }
    }
    reset(); draw();
    box.addEventListener('pointerdown', function (e) { e.preventDefault(); jump(); });
    document.addEventListener('keydown', function (e) { if ((e.code === 'Space' || e.key === 'ArrowUp') && host && host.isConnected) { if (e.target === document.body || e.target === host) e.preventDefault(); jump(); } });
  }

  /* ── Başlat ── */
  function load() {
    if (shown) return; shown = true;
    var q = '?path=' + encodeURIComponent(lostPath());
    var tpl = SCRIPT.getAttribute('data-tpl'), content = SCRIPT.getAttribute('data-content');
    if (tpl) q += '&tpl=' + encodeURIComponent(tpl);
    if (content) q += '&content=' + encodeURIComponent(content);
    fetch(API + '/config' + q, { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.template) { shown = false; return; }
      C = d; log('config', d);
      if (document.body) render(); else document.addEventListener('DOMContentLoaded', render);
    }).catch(function (e) { shown = false; log('config hata', e); });
  }
  function check() { var why = isNotFound(); log('tespit', why || 'yok'); if (why) load(); }

  window.YunbiNotFound = { show: function () { FORCE = true; load(); } };
  window.addEventListener('hashchange', function () { if (/yunbi404/.test(location.hash)) window.YunbiNotFound.show(); });
  if (document.readyState === 'loading') {
    // Adres/durum kodu ile erken tespit; başlık ve seçiciler için DOM'u bekle
    var why = isNotFound(); if (why) load(); else document.addEventListener('DOMContentLoaded', check);
  } else check();
})();
