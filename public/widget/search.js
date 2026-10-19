(function () {
  'use strict';

  /* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     Yunbi Ak\u0131ll\u0131 Arama \u2014 storefront widget (sa\u011Fdan a\u00E7\u0131lan drawer).
     Arama ikonuna t\u0131klan\u0131nca sa\u011Fdan panel a\u00E7\u0131l\u0131r (Tonny Black UX'i): bo\u015Fken
     son aramalar + pop\u00FCler aramalar; yazarken canl\u0131 sonu\u00E7 (anla\u015F\u0131lan facet'ler,
     \u00F6neri). Kurulum:
       <script src=".../widget/search.js" data-tenant="tonnyblack"
               data-trigger=".search-icon,#aramaBtn" data-input="#txtAra"></script>
     JS ile de a\u00E7\u0131l\u0131r: window.YunbiSearch.open('k\u0131rm\u0131z\u0131 44')
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;

  var API = SCRIPT.src.replace(/\/widget\/search\.js.*$/, '/w/' + TENANT + '/search');
  var TRIGGER_SEL = SCRIPT.getAttribute('data-trigger') ||
    '.search-icon,.searchIcon,.btnArama,[class*="search" i] a,[class*="arama" i] a,a[href*="arama" i]';
  var INPUT_SEL = SCRIPT.getAttribute('data-input') ||
    'input[type="search"],input[name*="ara" i],input[name*="kelime" i],input[id*="ara" i],input[id*="search" i]';
  var MIN = parseInt(SCRIPT.getAttribute('data-min'), 10) || 2;
  var TIMEOUT = parseInt(SCRIPT.getAttribute('data-timeout'), 10) || 12000;
  /* Tasarim sablonu: 'drawer' (sagdan panel) | 'fullscreen' (tam sayfa, imza.com.tr tarzi).
     Panelden tenant bazinda secilir (config'ten gelir); data-template attribute'u
     YALNIZ demo/onizleme icindir ve panel ayarini ezer. */
  var TEMPLATE = (SCRIPT.getAttribute('data-template') || '').toLowerCase();
  var TPL_LOCKED = TEMPLATE === 'drawer' || TEMPLATE === 'fullscreen';
  if (!TPL_LOCKED) TEMPLATE = 'drawer';
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiSearch]'].concat([].slice.call(arguments))); }

  // \u2500\u2500 Oturum + son aramalar (localStorage) \u2500\u2500
  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); localStorage.setItem(k, v); } return v; }
    catch (e) { return 'w' + Date.now().toString(36); }
  })();
  var RKEY = 'yunbi_recent_' + TENANT;
  function getRecent() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } }
  function addRecent(q) { q = (q || '').trim(); if (q.length < MIN) return; try { var a = getRecent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); a.unshift(q); localStorage.setItem(RKEY, JSON.stringify(a.slice(0, 8))); } catch (e) {} }

  // \u2500\u2500 Bi\u00E7im / ka\u00E7\u0131\u015F \u2500\u2500
  function money(n) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20BA'; }
  function priceHTML(p) {
    var dp = parseFloat(p.discounted_price), pr = parseFloat(p.price), now, old = null;
    if (!isNaN(dp) && dp > 0 && !isNaN(pr) && dp < pr) { now = dp; old = pr; }
    else if (!isNaN(pr) && pr > 0) { now = pr; }
    else if (!isNaN(dp) && dp > 0) { now = dp; }
    else return '';
    return '<span class="pr">' + money(now) + '</span>' + (old ? '<span class="old">' + money(old) + '</span>' : '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // \u2500\u2500 HTTP \u2500\u2500
  function getJSON(url) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postEvent(body) {
    try {
      // mağaza sepet kimliği (ikas: sipariş id ile aynı) → IP'siz platformlarda satış atfı
      try { var cid = localStorage.getItem('cartId'); if (cid && !body.cart_id) body.cart_id = cid; } catch (e) {}
      var data = JSON.stringify(body);
      /* text/plain = CORS-safelisted: preflight yok, sayfa kapanirken beacon kaybolmaz */
      if (navigator.sendBeacon) { navigator.sendBeacon(API + '/event', new Blob([data], { type: 'text/plain;charset=UTF-8' })); return; }
      fetch(API + '/event', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, mode: 'cors', credentials: 'omit', body: data, keepalive: true });
    } catch (e) {}
  }

  /* \u2550\u2550\u2550 Shadow DOM kabu\u011Fu \u2550\u2550\u2550 */
  var host = document.createElement('div');
  host.id = 'yunbi-search-root';
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  document.documentElement.appendChild(host);

  var CSS =
    ':host{all:initial;--acc:#6366f1;--acc2:#4338ca;--soft:#eef2ff;--line:#c7d2fe;--ring:rgba(99,102,241,.12);--ink:#0f172a;--font:-apple-system,Segoe UI,Roboto,Arial,sans-serif}*{box-sizing:border-box;font-family:var(--font)}' +
    /* visibility gecikmeli kapan\u0131r ki panel kayarak \u00E7\u0131kabilsin (animasyon kesilmesin) */
    '.ov{position:fixed;inset:0;background:rgba(15,23,42,.5);opacity:0;visibility:hidden;transition:opacity .22s,visibility 0s linear .28s;z-index:2147483000}' +
    '.ov.open{opacity:1;visibility:visible;transition:opacity .2s,visibility 0s}' +
    '.pan{position:absolute;top:0;right:0;height:100%;width:min(460px,100%);background:#fff;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);box-shadow:-10px 0 40px rgba(0,0,0,.22)}' +
    '.ov.open .pan{transform:none}' +
    '.hd{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid #eef2f7}' +
    '.hd .wrp{flex:1;position:relative;display:flex;align-items:center}' +
    '.hd svg{position:absolute;left:11px;width:16px;height:16px;stroke:#94a3b8;pointer-events:none}' +
    /* 16px \u015Fart: iOS Safari <16px inputa odaklan\u0131nca sayfay\u0131 zoom'lar */
    '.hd input{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px 10px 34px;font-size:16px;outline:none;-webkit-appearance:none;appearance:none}' +
    '.hd input::-webkit-search-decoration,.hd input::-webkit-search-cancel-button{-webkit-appearance:none}' +
    '.hd input:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--ring)}' +
    '.x{border:0;background:#f1f5f9;border-radius:9px;width:40px;height:40px;font-size:20px;line-height:1;cursor:pointer;color:#475569;flex:none}' +
    '.x:hover{background:#e2e8f0}' +
    '.chips{padding:8px 12px 0;display:flex;flex-wrap:wrap;gap:6px}' +
    '.chip{font-size:12px;background:var(--soft);color:var(--acc2);border-radius:999px;padding:3px 10px;font-weight:600}' +
    '.chip.k{background:#f1f5f9;color:#475569}' +
    '.bd{flex:1;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch}' +
    /* uppercase KULLANMA: tarayici lang bilgisi olmadan Turkce "i"yi noktasiz "I" yapar */
    '.sec{font-size:12.5px;font-weight:700;color:#64748b;margin:4px 2px 8px;display:flex;justify-content:space-between;align-items:center}' +
    '.sec a{font-size:11px;color:var(--acc);cursor:pointer;text-transform:none;font-weight:600}' +
    '.terms{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px}' +
    /* Populer kategoriler: gorselli kesif kartlari (bos durum) */
    '.catgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px}' +
    '.catc{display:flex;align-items:center;gap:10px;border:1px solid #eef2f7;border-radius:12px;overflow:hidden;cursor:pointer;background:#fff;transition:box-shadow .15s,transform .12s;text-decoration:none}' +
    '.catc:hover{box-shadow:0 6px 18px rgba(0,0,0,.08);transform:translateY(-1px)}' +
    '.catc .ci{width:58px;height:58px;flex:none;background:#f4f6f9;position:relative;overflow:hidden}' +
    '.catc .ci img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.catc .ci.noimg::before{content:"\uD83D\uDECD\uFE0F";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:.35}' +
    '.catc .cn{font-size:13px;font-weight:600;color:var(--ink);padding-right:8px;line-height:1.25}' +
    '.ov.fs .catgrid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}' +
    '.term{display:inline-flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:6px 12px;font-size:13px;color:var(--ink);cursor:pointer;transition:.12s}' +
    '.term:hover{border-color:var(--acc);color:var(--acc2);background:#fff}' +
    '.term .rm{color:#cbd5e1;font-size:13px}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.card{border:1px solid #eef2f7;border-radius:12px;overflow:hidden;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;background:#fff;transition:box-shadow .15s,transform .15s}' +
    '.card:hover{box-shadow:0 8px 22px rgba(0,0,0,.1);transform:translateY(-1px)}' +
    /* Ticimax \u00FCr\u00FCn g\u00F6rselleri 1200\u00D71800 (2:3 dikey) \u2014 kare kutu + cover \u00FCst/alttan k\u0131rp\u0131yordu */
    '.card .im{aspect-ratio:var(--ratio,2/3);background:#f4f6f9;position:relative;overflow:hidden}' +
    /* Karusel: gorseller ust uste, aktif olan gorunur; hover-bolgesi/kaydirma degistirir */
    '.card .im img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .18s}' +
    '.card .im img.on{opacity:1}' +
    '.card .im img:only-of-type{opacity:1}' +
    /* hover-bolgeleri (masaustu): fareyle uzerine gelince o gorseli goster (Trendyol deseni) */
    '.card .zones{position:absolute;inset:0;display:flex;z-index:2}' +
    '.card .zones i{flex:1}' +
    /* nokta gostergesi */
    '.card .dots{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:4px;z-index:3;pointer-events:none}' +
    '.card .dots b{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.6);box-shadow:0 0 2px rgba(0,0,0,.35);transition:background .15s,transform .15s}' +
    '.card .dots b.on{background:#fff;transform:scale(1.25)}' +
    '.card .im.noimg{display:flex;align-items:center;justify-content:center}' +
    '.card .im.noimg::before{content:"\uD83D\uDECD\uFE0F";font-size:32px;opacity:.35}' +
    '.card .oos{position:absolute;top:6px;left:6px;z-index:3;background:rgba(15,23,42,.78);color:#fff;font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px}' +
    /* varyant renk swatch satiri */
    '.card .sw{display:flex;flex-wrap:wrap;gap:4px;padding:6px 9px 0}' +
    '.card .sw b{width:13px;height:13px;border-radius:50%;border:1px solid rgba(15,23,42,.18);box-shadow:inset 0 0 0 2px #fff;box-sizing:border-box}' +
    '.card .sw .more{font-size:10px;color:#94a3b8;font-weight:600;line-height:13px}' +
    /* \u00FCr\u00FCn ad\u0131 3 sat\u0131r SAB\u0130T (baz\u0131 adlar 2 sat\u0131ra s\u0131\u011Fm\u0131yordu; min-height kartlar\u0131 hizalar) */
    '.card .nm{font-size:12.5px;line-height:1.35;padding:8px 9px 4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:63px}' +
    '.card .pw2{padding:0 9px 9px;display:flex;align-items:baseline;gap:6px}' +
    '.card .pr{font-size:14px;font-weight:800;color:var(--ink)}' +
    '.card .old{font-size:11px;color:#94a3b8;text-decoration:line-through}' +
    /* kampanya rozeti (Ticimax ozel alan: "1 ALANA 1 BEDAVA" vb.) */
    '.card .bdg{margin:0 9px 9px;align-self:flex-start;font-size:10px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:2px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 18px)}' +
    '.note{font-size:12.5px;color:#64748b;margin:2px 2px 10px}' +
    /* -- Sonuc araci cubugu: sonuc sayisi + Filtrele + aktif filtre cipleri -- */
    '.tbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 2px 12px}' +
    '.tbar .cnt{font-size:12.5px;color:#64748b;font-weight:600}' +
    '.fbtn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:#fff;color:#334155;border-radius:9px;padding:6px 11px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.12s}' +
    '.fbtn:hover{border-color:var(--acc);color:var(--acc2)}' +
    '.fbtn.on{border-color:var(--acc);background:var(--soft);color:var(--acc2)}' +
    '.fbtn .fb{background:var(--acc);color:#fff;border-radius:999px;font-size:10px;font-weight:700;padding:1px 6px;line-height:1.5}' +
    /* daraltma cipleri (sorguya gore alt-kategoriler) - yatay kaydirilir */
    '.narrow{display:flex;gap:7px;overflow-x:auto;padding:0 2px 10px;-webkit-overflow-scrolling:touch;scrollbar-width:none}' +
    '.narrow::-webkit-scrollbar{display:none}' +
    '.nchip{flex:none;font-size:12.5px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:999px;padding:6px 13px;cursor:pointer;white-space:nowrap;transition:.12s}' +
    '.nchip:hover{border-color:var(--acc);color:var(--acc2);background:#fff}' +
    '.nchip .c{color:#94a3b8;font-size:11px;margin-left:4px}' +
    /* aktif filtre cipleri (kaldirilabilir) */
    '.afil{display:inline-flex;align-items:center;gap:5px;font-size:12px;background:var(--soft);color:var(--acc2);border:1px solid var(--line);border-radius:999px;padding:4px 8px 4px 11px;font-weight:600}' +
    '.afil b{cursor:pointer;color:#818cf8;font-size:14px;line-height:1}' +
    '.afil b:hover{color:var(--acc2)}' +
    '.aclear{font-size:12px;color:var(--acc);cursor:pointer;font-weight:600;padding:4px 6px}' +
    /* -- Filtre paneli (acilinca grid ustune iner) -- */
    '.fpan{border:1px solid #e8edf3;background:#f8fafc;border-radius:14px;padding:14px;margin:0 2px 14px}' +
    '.fgrp{padding:10px 0;border-top:1px solid #eef2f7}' +
    '.fgrp:first-child{padding-top:2px;border-top:0}' +
    '.fgrp .ft{font-size:11.5px;font-weight:700;color:#475569;text-transform:none;margin-bottom:9px;display:flex;justify-content:space-between}' +
    '.fchips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.fchip{font-size:12.5px;background:#fff;color:#334155;border:1px solid #e2e8f0;border-radius:8px;padding:5px 11px;cursor:pointer;transition:.1s;display:inline-flex;align-items:center;gap:6px}' +
    '.fchip:hover{border-color:var(--line)}' +
    '.fchip.on{background:var(--acc);color:#fff;border-color:var(--acc);font-weight:600}' +
    '.fchip .c{font-size:10.5px;opacity:.6}' +
    '.fchip .sw{width:12px;height:12px;border-radius:50%;border:1px solid rgba(15,23,42,.2)}' +
    '.fprice{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.fprice input{width:92px;border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;font-size:13px;outline:none;-webkit-appearance:none}' +
    '.fprice input:focus{border-color:var(--acc)}' +
    '.fprice span{color:#94a3b8;font-size:12px}' +
    '.fprice .go{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer}' +
    '.fprice .hint{color:#94a3b8;font-size:11px;width:100%}' +
    /* fullscreen: filtre paneli genis, cok kolonlu facet gruplari */
    '.ov.fs .fpan{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 26px;align-items:start}' +
    '.ov.fs .fgrp{border-top:0;padding:8px 0}' +
    '.empty{text-align:center;color:#94a3b8;font-size:13.5px;padding:26px 10px}' +
    '.empty .big{font-size:30px;margin-bottom:8px}' +
    '.ld{display:flex;gap:6px;justify-content:center;padding:30px}' +
    '.ld i{width:8px;height:8px;border-radius:50%;background:var(--line);animation:bp 1s infinite ease-in-out}' +
    '.ld i:nth-child(2){animation-delay:.15s}.ld i:nth-child(3){animation-delay:.3s}' +
    '@keyframes bp{0%,80%,100%{transform:scale(.6);opacity:.5}40%{transform:scale(1);opacity:1}}' +
    /* yazarken eski sonu\u00E7lar S\u0130L\u0130NMEZ, hafif\u00E7e solukla\u015F\u0131r (flicker yok) */
    '.bd.busy{opacity:.5;pointer-events:none}.bd{transition:opacity .15s}' +
    /* Oneri bolumu: sonuclarla KARISMASIN \u2014 ayri zeminli, kenarlikli blok + aciklama satiri
       ("43 kirmizi" arayan, alttaki onerileri arama sonucu sanmasin) */
    /* ayrac: sonuclarin bittigi yerde cizgi + "ONERILER" rozeti = net kopus */
    '.recdiv{display:flex;align-items:center;gap:10px;margin:52px 0 18px}' +
    '.recdiv i{flex:1;height:2px;background:#e2e8f0;display:block;border-radius:2px}' +
    '.recdiv span{font-size:11.5px;font-weight:800;color:var(--acc2);letter-spacing:1.5px;background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:6px 16px;white-space:nowrap}' +
    '.recs{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:18px 14px 14px}' +
    '.recs .rt{font-size:18px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:10px;line-height:1.25}' +
    '.recs .rt::before{content:"";width:5px;height:21px;border-radius:3px;background:var(--acc);flex:none}' +
    '.recs .rs{font-size:12.5px;color:#64748b;margin:6px 0 16px}' +
    '.ov.fs .recdiv{margin:72px 0 22px}' +
    '.ov.fs .recs{padding:24px 20px 20px}' +
    '.ov.fs .recs .rt{font-size:21px}' +
    /* ===== Tam sayfa sablon (.ov.fs): ayri bir arama sayfasina gitmis hissi =====
       Ustte logo + genis arama + kapat; altta tam genislik/yukseklik sonuc alani.
       Acilis: yukaridan yumusak ini\u015F (drawer'in sagdan kaymasi yerine). */
    '.ov.fs{background:#fff}' +
    '.ov.fs .pan{width:100%;box-shadow:none;transform:translateY(-16px);opacity:0;transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .22s}' +
    '.ov.fs.open .pan{transform:none;opacity:1}' +
    '.hd .lg{display:none}' +
    '.ov.fs .hd{padding:14px clamp(16px,4vw,48px);gap:18px;border-bottom:1px solid #e8edf3}' +
    '.ov.fs .hd{padding-left:max(clamp(16px,4vw,48px),calc((100% - 1400px)/2));padding-right:max(clamp(16px,4vw,48px),calc((100% - 1400px)/2))}' +
    '.ov.fs .hd .lg{display:flex;align-items:center;flex:none;max-width:200px;text-decoration:none;color:var(--ink);font-weight:800;font-size:17px;letter-spacing:.4px;white-space:nowrap;overflow:hidden}' +
    '.ov.fs .hd .lg img{max-height:34px;max-width:180px;object-fit:contain;display:block}' +
    '.ov.fs .hd .wrp{max-width:720px;margin:0 auto}' +
    '.ov.fs .hd input{font-size:17px;padding:12px 14px 12px 42px;border-radius:12px}' +
    '.ov.fs .hd svg{left:14px;width:18px;height:18px}' +
    '.ov.fs .x{width:44px;height:44px;border-radius:999px;font-size:22px}' +
    '.ov.fs .chips{justify-content:center;padding:10px clamp(16px,4vw,48px) 0}' +
    '.ov.fs .bd{padding:18px clamp(16px,4vw,48px) 48px}' +
    '.ov.fs .bd{padding-left:max(clamp(16px,4vw,48px),calc((100% - 1400px)/2));padding-right:max(clamp(16px,4vw,48px),calc((100% - 1400px)/2))}' +
    '.ov.fs .grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}' +
    '.ov.fs .card .nm{font-size:13px}' +
    '.ov.fs .note{font-size:13px}' +
    /* mobil tam sayfa: logo gizli (yer dar), 2 kolon grid \u2014 ayni "yeni sayfa" hissi */
    '@media (max-width:640px){.ov.fs .hd .lg{display:none}.ov.fs .grid{grid-template-columns:repeat(2,1fr);gap:10px}.ov.fs .hd{padding:10px 12px;gap:8px}.ov.fs .chips{justify-content:flex-start}}';

  var st = document.createElement('style'); st.textContent = CSS; shadow.appendChild(st);
  var ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML =
    '<div class="pan" lang="tr" role="dialog" aria-modal="true" aria-label="\u00DCr\u00FCn arama">' +
    '<div class="hd"><a class="lg" href="/" aria-label="Anasayfa"></a><div class="wrp"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path></svg>' +
    '<input type="search" placeholder="Ne aram\u0131\u015Ft\u0131n?" autocomplete="off" enterkeyhint="search" aria-label="\u00DCr\u00FCn ara"></div><button class="x" title="Kapat" aria-label="Kapat">\u00D7</button></div>' +
    '<div class="chips"></div><div class="bd"></div></div>';
  shadow.appendChild(ov);

  /* Sablonu uygula: fullscreen'de .fs sinifi tum yerlesimi degistirir (ayni DOM/mantik) */
  function applyTemplate() { ov.classList.toggle('fs', TEMPLATE === 'fullscreen'); }
  applyTemplate();

  /* Fullscreen ust bari: sitenin kendi logosunu DOM'dan klonla (sifir kurulum).
     Bulunamazsa sayfa basligindan magaza adi. Logoya tiklama = anasayfa (imza.com.tr UX'i). */
  function mountLogo() {
    var lg = ov.querySelector('.lg');
    if (!lg || lg.__done) return; lg.__done = true;
    var name = '';
    try { name = (document.title || '').split(/[|\u2013\u2014-]/)[0].trim(); } catch (e) {}
    var img = null;
    try {
      img = document.querySelector('.logo img,#logo img,a[class*="logo" i] img,img[class*="logo" i],img[src*="logo" i],img[alt*="logo" i]');
    } catch (e) {}
    var src = img && (img.currentSrc || img.src);
    if (src) {
      var el = document.createElement('img');
      el.alt = '';
      el.onerror = function () { el.remove(); lg.textContent = name; }; // logo 404/lazy ise magaza adi
      el.src = src;
      lg.appendChild(el);
    } else {
      lg.textContent = name;
    }
  }

  var pan = ov.querySelector('.pan'), input = ov.querySelector('input'), chips = ov.querySelector('.chips'), bd = ov.querySelector('.bd');
  var curSearchId = null, _popular = null, previewT = null, commitT = null, lastRendered = '';
  var resCount = 0, pageHasMore = false, loadingMore = false; // sonsuz kayd\u0131rma durumu
  // Faset filtre durumu (kullan\u0131c\u0131 se\u00e7imleri) \u2014 sorgu metni de\u011fi\u015fince s\u0131f\u0131rlan\u0131r
  var curFilters = { category: [], brand: [], renk: [], beden: [], price_min: null, price_max: null };
  var curFacets = null, filterOpen = false, lastData = null, preserveScroll = false;
  function resetFilters() { curFilters = { category: [], brand: [], renk: [], beden: [], price_min: null, price_max: null }; filterOpen = false; }
  function hasFilters() {
    return curFilters.category.length || curFilters.brand.length || curFilters.renk.length ||
      curFilters.beden.length || curFilters.price_min != null || curFilters.price_max != null;
  }
  function filterQS() {
    var p = '';
    ['category', 'brand', 'renk', 'beden'].forEach(function (k) {
      if (curFilters[k] && curFilters[k].length) p += '&f_' + k + '=' + encodeURIComponent(curFilters[k].join(','));
    });
    if (curFilters.price_min != null) p += '&price_min=' + curFilters.price_min;
    if (curFilters.price_max != null) p += '&price_max=' + curFilters.price_max;
    return p;
  }

  /* === Placeholder daktilo efekti: bos inputta ornek sorgular yazip siler ===
     Musteriye "detay verebilirsin" hissi: "36 siyah spor ayakkabi" gibi. */
  var PH_BASE = 'Ne aram\u0131\u015Ft\u0131n?';
  var phExamples = ['36 siyah spor ayakkab\u0131', 'k\u0131rm\u0131z\u0131 sneaker 44', 'kahve terlik', 'beyaz babet 38'];
  var phT = null, phI = 0;
  function phSet(v) { input.setAttribute('placeholder', v); }
  function phStop() { if (phT) { clearTimeout(phT); phT = null; } phSet(PH_BASE); }
  function phRun() {
    if (!ov.classList.contains('open') || input.value) { phStop(); return; }
    var word = phExamples[phI % phExamples.length]; phI++;
    var ci = 0, del = false;
    (function tick() {
      if (!ov.classList.contains('open') || input.value) { phStop(); return; }
      if (!del) {
        ci++; phSet(word.slice(0, ci) + '|');
        if (ci >= word.length) { del = true; phT = setTimeout(tick, 1500); return; }
        phT = setTimeout(tick, 65);
      } else {
        ci--; phSet(ci > 0 ? word.slice(0, ci) + '|' : PH_BASE);
        if (ci <= 0) { phT = setTimeout(phRun, 500); return; }
        phT = setTimeout(tick, 28);
      }
    })();
  }

  /* === Drawer ac/kapat === */
  function open(q) {
    if (TEMPLATE === 'fullscreen') mountLogo();
    ov.classList.add('open'); document.documentElement.style.overflow = 'hidden';
    input.value = q || '';
    setTimeout(function () { input.focus(); }, 60);
    if ((q || '').trim().length >= MIN) { runPreview(q); scheduleCommit(q); } else { showEmpty(); phT = setTimeout(phRun, 700); }
  }
  function close() { ov.classList.remove('open'); document.documentElement.style.overflow = ''; clearTimeout(previewT); clearTimeout(commitT); phStop(); }
  ov.querySelector('.x').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });

  /* \u2550\u2550\u2550 Bo\u015F durum: son aramalar + pop\u00FCler aramalar \u2550\u2550\u2550 */
  function termPill(t, removable) {
    return '<span class="term" data-q="' + esc(t) + '">' + esc(t) + (removable ? ' <span class="rm" data-x="' + esc(t) + '">\u00D7</span>' : '') + '</span>';
  }
  function showEmpty() {
    chips.innerHTML = '';
    bd.classList.remove('busy'); lastRendered = '';
    resCount = 0; pageHasMore = false;
    var recent = getRecent(), html = '';
    if (recent.length) {
      html += '<div class="sec">Son aramalar <a data-clear="1">Temizle</a></div><div class="terms">' + recent.map(function (t) { return termPill(t, true); }).join('') + '</div>';
    }
    html += '<div class="sec" id="popsec" style="display:none">Pop\u00FCler aramalar</div><div class="terms" id="popterms"></div>';
    html += '<div class="sec" id="popcatsec" style="display:none">Pop\u00FCler kategoriler</div><div class="catgrid" id="popcats"></div>';
    if (!recent.length) html = '<div class="empty"><div class="big">\uD83D\uDD0E</div>Bir \u015Feyler aratmaya ba\u015Fla\u2026</div>' + html;
    bd.innerHTML = html;
    bindTerms();
    loadPopular();
  }
  function catCardHTML(c) {
    var src = thumbURL(c.image || '');
    var img = c.image ? '<img loading="lazy" decoding="async" src="' + esc(src) + '"' + (src !== c.image ? ' data-full="' + esc(c.image) + '"' : '') + ' alt="' + esc(c.name) + '">' : '';
    return '<span class="catc" data-q="' + esc(c.name) + '"><span class="ci">' + img + '</span><span class="cn">' + esc(c.name) + '</span></span>';
  }
  function loadPopular() {
    var render = function (d) {
      var terms = d.terms || [], cats = d.categories || [];
      if (terms.length) {
        var sec = bd.querySelector('#popsec'), wrap = bd.querySelector('#popterms');
        if (sec && wrap) { sec.style.display = 'flex'; wrap.innerHTML = terms.map(function (t) { return termPill(t, false); }).join(''); }
      }
      if (cats.length) {
        var csec = bd.querySelector('#popcatsec'), cwrap = bd.querySelector('#popcats');
        if (csec && cwrap) { csec.style.display = 'flex'; cwrap.innerHTML = cats.map(catCardHTML).join(''); }
      }
      bindTerms();
      // kategori karti tiklama: o kategoriyi aratir
      [].forEach.call(bd.querySelectorAll('.catc'), function (el) {
        if (el.__yb) return; el.__yb = true;
        el.addEventListener('click', function () { var q = el.getAttribute('data-q'); input.value = q; input.focus(); resetFilters(); runPreview(q); scheduleCommit(q); });
      });
      // kategori kartlarindaki kirik gorseli placeholder'a dusur
      [].forEach.call(bd.querySelectorAll('.catc img'), function (img) {
        if (img.__yb) return; img.__yb = true;
        img.addEventListener('error', function () {
          var full = img.getAttribute('data-full');
          if (full && img.src !== full) { img.removeAttribute('data-full'); img.src = full; return; }
          var ci = img.parentNode; if (ci) ci.classList.add('noimg'); img.remove();
        });
      });
    };
    if (_popular) { render(_popular); return; }
    getJSON(API + '/popular').then(function (d) { _popular = d; render(_popular); }).catch(function () {});
  }
  function bindTerms() {
    [].forEach.call(bd.querySelectorAll('.term'), function (el) {
      if (el.__yb) return; el.__yb = true;
      el.addEventListener('click', function (e) {
        if (e.target.getAttribute('data-x') != null) { e.stopPropagation(); var a = getRecent().filter(function (x) { return x !== e.target.getAttribute('data-x'); }); try { localStorage.setItem(RKEY, JSON.stringify(a)); } catch (er) {} showEmpty(); return; }
        var q = el.getAttribute('data-q'); input.value = q; input.focus(); runPreview(q); scheduleCommit(q);
      });
    });
    var clr = bd.querySelector('[data-clear]'); if (clr) clr.addEventListener('click', function () { try { localStorage.removeItem(RKEY); } catch (e) {} showEmpty(); });
  }

  /* \u2550\u2550\u2550 Arama: canl\u0131 \u00F6nizleme (log=0) + commit (log=1) \u2550\u2550\u2550 */
  function chipsHTML(u) {
    if (!u) return '';
    var out = [], f = u.facets_display || u.facets || {}, L = { renk: 'Renk', beden: 'Beden', cinsiyet: 'Cinsiyet', category: 'Kategori', brand: 'Marka' };
    Object.keys(L).forEach(function (k) {
      var v = f[k]; if (v == null || v === '') return;
      if (Object.prototype.toString.call(v) === '[object Array]') v = v[0];
      out.push('<span class="chip">' + esc(L[k]) + ': ' + esc(v) + '</span>');
    });
    (u.terms || []).forEach(function (t) { out.push('<span class="chip k">' + esc(t) + '</span>'); });
    return out.join('');
  }
  // Ticimax CDN: kart i\u00E7in 400\u00D7600 thumb yeterli (orijinal 1200\u00D71800 ~100KB \u2192 thumb ~25KB,
  // 24 kartta ~2.4MB yerine ~0.6MB). thumb 404 olursa onerror orijinale d\u00F6ner.
  function thumbURL(u) { return /\/UrunResimleri\/buyuk\//.test(u || '') ? u.replace('/UrunResimleri/buyuk/', '/UrunResimleri/thumb/') : u; }
  // Urun linkine UTM ekle: merchant kendi GA4 raporunda aramadan gelen trafigi gorebilsin
  function safeUrl(u) {
    // javascript:/data: gibi tehlikeli semalari engelle; yalnizca http(s) veya goreli yol
    u = String(u == null ? '' : u).trim();
    if (!u) return '#';
    if (/^(https?:)?\/\//i.test(u) || u.charAt(0) === '/') return u;
    return '#';
  }
  function withUtm(u) {
    u = safeUrl(u);
    if (u === '#') return '#';
    return u + (u.indexOf('?') > -1 ? '&' : '?') + 'utm_source=yunbi&utm_medium=smart-search';
  }
  /* Turkce renk adi -> hex (swatch icin). Bilesik adlarda ("Bej Bordo") ilk taninan
     kelime alinir. Anahtar deascii+kucuk (dosya ASCII kalsin). Bulunamazsa null. */
  var COLORMAP = {
    siyah: '#111', beyaz: '#fff', gri: '#9ca3af', antrasit: '#3f3f46', fume: '#52525b',
    kirmizi: '#dc2626', bordo: '#7f1d1d', visne: '#7f1d1d', kiremit: '#c2410c',
    lacivert: '#1e3a8a', mavi: '#2563eb', indigo: '#4338ca', 'petrol': '#0e7490', turkuaz: '#14b8a6',
    yesil: '#16a34a', haki: '#4d7c0f', mint: '#6ee7b7',
    sari: '#eab308', altin: '#d4af37', gold: '#d4af37', hardal: '#ca8a04',
    turuncu: '#ea580c', pembe: '#ec4899', fusya: '#db2777', lila: '#c084fc', mor: '#7c3aed',
    kahve: '#78350f', kahverengi: '#78350f', taba: '#a16207', camel: '#c19a6b', vizon: '#a78b71',
    bej: '#e7d3b3', krem: '#f5f0e1', ekru: '#efe8d8', tas: '#d6d3c4', tas_rengi: '#d6d3c4',
    gumus: '#c0c0c0', bakir: '#b87333', leopar: '#c19a6b', yilan: '#a1976b'
  };
  function colorHex(name) {
    var f = String(name || '').toLowerCase()
      .replace(/\u00E7/g, 'c').replace(/\u011F/g, 'g').replace(/\u0131/g, 'i').replace(/\u00F6/g, 'o').replace(/\u015F/g, 's').replace(/\u00FC/g, 'u');
    var words = f.split(/[^a-z0-9]+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) { if (COLORMAP[words[i]]) return COLORMAP[words[i]]; }
    return null;
  }
  function swatchHTML(colors) {
    if (!colors || colors.length < 2) return ''; // tek renkli urunde swatch gostermeye gerek yok
    var out = [], shown = 0;
    for (var i = 0; i < colors.length && shown < 5; i++) {
      var hex = colorHex(colors[i]); if (!hex) continue;
      out.push('<b title="' + esc(colors[i]) + '" style="background:' + hex + '"></b>'); shown++;
    }
    if (!out.length) return '';
    if (colors.length > shown) out.push('<span class="more">+' + (colors.length - shown) + '</span>');
    return '<div class="sw">' + out.join('') + '</div>';
  }
  function imgTag(full, i, eager, name) {
    var src = thumbURL(full);
    return '<img' + (i === 0 ? ' class="on"' : '') + ' loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async" src="' + esc(src) + '"' +
      (src !== full ? ' data-full="' + esc(full) + '"' : '') + ' alt="' + esc(name || '') + '">';
  }
  function cardHTML(p, i) {
    var imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    imgs = imgs.slice(0, 4);
    var name = p.name || '';
    var imHtml = '';
    if (imgs.length) {
      imHtml = imgs.map(function (u, k) { return imgTag(u, k, i < 6 && k === 0, name); }).join('');
      if (imgs.length > 1) {
        var zones = '<div class="zones">' + imgs.map(function () { return '<i></i>'; }).join('') + '</div>';
        var dots = '<div class="dots">' + imgs.map(function (u, k) { return '<b' + (k === 0 ? ' class="on"' : '') + '></b>'; }).join('') + '</div>';
        imHtml += zones + dots;
      }
    }
    var price = priceHTML(p);
    return '<a class="card" href="' + esc(withUtm(p.url)) + '" data-id="' + esc(p.id) + '" data-i="' + i + '">' +
      '<div class="im' + (imgs.length ? '' : ' noimg') + '">' + imHtml + (p.in_stock ? '' : '<span class="oos">T\u00FCkendi</span>') + '</div>' +
      swatchHTML(p.variant_colors) +
      '<div class="nm">' + esc(name) + '</div>' +
      (price ? '<div class="pw2">' + price + '</div>' : '') +
      (p.badge ? '<div class="bdg">' + esc(p.badge) + '</div>' : '') + '</a>';
  }
  /* \u2550\u2550 Faset filtre + daraltma \u00E7ipleri UI \u2550\u2550 */
  var FGROUPS = [
    { key: 'category', label: 'Kategori', fk: 'categories' },
    { key: 'renk', label: 'Renk', fk: 'colors' },
    { key: 'beden', label: 'Beden', fk: 'sizes' },
    { key: 'brand', label: 'Marka', fk: 'brands' }
  ];
  function activeCount() {
    var n = 0;
    ['category', 'brand', 'renk', 'beden'].forEach(function (k) { n += curFilters[k].length; });
    if (curFilters.price_min != null || curFilters.price_max != null) n++;
    return n;
  }
  function toolbarHTML(total, m) {
    var chipsH = '';
    ['category', 'brand', 'renk', 'beden'].forEach(function (k) {
      curFilters[k].forEach(function (v) {
        chipsH += '<span class="afil">' + esc(v) + '<b data-rmf="' + k + '" data-val="' + esc(v) + '">\u00D7</b></span>';
      });
    });
    if (curFilters.price_min != null || curFilters.price_max != null) {
      var lbl = (curFilters.price_min != null ? curFilters.price_min : '0') + '\u2013' + (curFilters.price_max != null ? curFilters.price_max : '\u221E') + ' \u20BA';
      chipsH += '<span class="afil">' + lbl + '<b data-rmf="price" data-val="1">\u00D7</b></span>';
    }
    var clr = activeCount() ? '<span class="aclear" data-clearf="1">Filtreleri temizle</span>' : '';
    var badge = activeCount() ? '<span class="fb">' + activeCount() + '</span>' : '';
    return '<div class="tbar"><span class="cnt">' + total + (m && m.capped ? '+' : '') + ' sonu\u00E7</span>' +
      chipsH + clr +
      '<button class="fbtn' + (filterOpen ? ' on' : '') + '" data-ftoggle="1">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"></path></svg>Filtrele' + badge + '</button></div>';
  }
  function narrowHTML() {
    // Sorguya g\u00F6re alt-kategori \u00F6nerileri \u2014 kullan\u0131c\u0131 hen\u00FCz kategoriye daralmad\u0131ysa g\u00F6ster
    if (!curFacets || curFilters.category.length) return '';
    var cats = (curFacets.categories || []).filter(function (c) { return c.value && c.count; });
    if (cats.length < 2) return '';
    return '<div class="narrow">' + cats.slice(0, 12).map(function (c) {
      return '<span class="nchip" data-narrow="' + esc(c.value) + '">' + esc(c.value) + '<span class="c">' + c.count + '</span></span>';
    }).join('') + '</div>';
  }
  function facetOptions(fk, selKey) {
    // facet listesi + se\u00E7ili ama listede olmayan de\u011Ferleri de g\u00F6ster (daral\u0131nca kaybolmas\u0131n)
    var opts = ((curFacets && curFacets[fk]) || []).slice();
    var have = {}; opts.forEach(function (o) { have[o.value] = true; });
    curFilters[selKey].forEach(function (v) { if (!have[v]) opts.unshift({ value: v, count: null }); });
    return opts;
  }
  function filterPanelHTML() {
    var groups = FGROUPS.map(function (g) {
      var opts = facetOptions(g.fk, g.key);
      if (!opts.length) return '';
      var chips = opts.slice(0, g.key === 'beden' ? 30 : 20).map(function (o) {
        var on = curFilters[g.key].indexOf(o.value) > -1;
        var sw = g.key === 'renk' ? swatchDot(o.value) : '';
        return '<span class="fchip' + (on ? ' on' : '') + '" data-fk="' + g.key + '" data-val="' + esc(o.value) + '">' +
          sw + esc(o.value) + (o.count != null ? '<span class="c">' + o.count + '</span>' : '') + '</span>';
      }).join('');
      return '<div class="fgrp"><div class="ft">' + g.label + '</div><div class="fchips">' + chips + '</div></div>';
    }).join('');
    // Fiyat aral\u0131\u011F\u0131
    var pf = curFacets && curFacets.price;
    var price = '<div class="fgrp"><div class="ft">Fiyat (\u20BA)</div><div class="fprice">' +
      '<input type="number" inputmode="numeric" data-pmin placeholder="' + (pf ? pf.min : 'en az') + '" value="' + (curFilters.price_min != null ? curFilters.price_min : '') + '">' +
      '<span>\u2013</span>' +
      '<input type="number" inputmode="numeric" data-pmax placeholder="' + (pf ? pf.max : 'en \u00E7ok') + '" value="' + (curFilters.price_max != null ? curFilters.price_max : '') + '">' +
      '<button class="go" data-papply>Uygula</button>' +
      (pf ? '<span class="hint">Bu sonu\u00E7larda ' + pf.min + '\u2013' + pf.max + ' \u20BA</span>' : '') + '</div></div>';
    return '<div class="fpan">' + groups + price + '</div>';
  }
  function swatchDot(name) {
    var hex = colorHex(name);
    return hex ? '<span class="sw" style="background:' + hex + '"></span>' : '';
  }
  function toggleFacet(key, val) {
    var arr = curFilters[key], i = arr.indexOf(val);
    if (i > -1) arr.splice(i, 1); else arr.push(val);
  }
  function bindFilters() {
    // Tek delege dinleyici yerine \u00F6\u011Fe-ba\u015F\u0131 (basit + __yb korumas\u0131 yok gerek, innerHTML yeni)
    var tgl = bd.querySelector('[data-ftoggle]');
    if (tgl) tgl.addEventListener('click', function () { filterOpen = !filterOpen; rerenderFilters(); });
    [].forEach.call(bd.querySelectorAll('[data-narrow]'), function (el) {
      el.addEventListener('click', function () { curFilters.category = [el.getAttribute('data-narrow')]; applyFilterChange(); });
    });
    [].forEach.call(bd.querySelectorAll('.fchip[data-fk]'), function (el) {
      el.addEventListener('click', function () { toggleFacet(el.getAttribute('data-fk'), el.getAttribute('data-val')); applyFilterChange(); });
    });
    [].forEach.call(bd.querySelectorAll('[data-rmf]'), function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-rmf');
        if (k === 'price') { curFilters.price_min = curFilters.price_max = null; }
        else { var v = el.getAttribute('data-val'), a = curFilters[k], i = a.indexOf(v); if (i > -1) a.splice(i, 1); }
        applyFilterChange();
      });
    });
    var clr = bd.querySelector('[data-clearf]');
    if (clr) clr.addEventListener('click', function () { curFilters.category = []; curFilters.brand = []; curFilters.renk = []; curFilters.beden = []; curFilters.price_min = curFilters.price_max = null; applyFilterChange(); });
    var pa = bd.querySelector('[data-papply]');
    if (pa) pa.addEventListener('click', function () {
      var mn = bd.querySelector('[data-pmin]').value.trim(), mx = bd.querySelector('[data-pmax]').value.trim();
      curFilters.price_min = mn !== '' && !isNaN(+mn) ? +mn : null;
      curFilters.price_max = mx !== '' && !isNaN(+mx) ? +mx : null;
      applyFilterChange();
    });
  }

  function render(d, q) {
    if (q !== input.value.trim()) return; // yan\u0131t gecikti, kullan\u0131c\u0131 de\u011Fi\u015Ftirdi
    chips.innerHTML = chipsHTML(d.understanding);
    lastData = d; // filtre panelini yeniden \u00E7izmek i\u00E7in (yeni istek atmadan)
    if (d.facets) curFacets = d.facets;
    var res = d.results || [], rec = d.recommendations || [], m = d.meta || {}, html = '';
    var total = typeof m.total === 'number' ? m.total : res.length;
    if (res.length || hasFilters()) {
      html += toolbarHTML(total, m) + narrowHTML() + (filterOpen ? filterPanelHTML() : '');
    }
    if (res.length) html += '<div class="grid rgrid">' + res.map(cardHTML).join('') + '</div>';
    else html += '<div class="empty"><div class="big">\uD83D\uDE41</div>"' + esc(q) + '" i\u00E7in' + (hasFilters() ? ' bu filtrelerle' : '') + ' sonu\u00E7 yok.</div>';
    /* Oneriler ayri blokta: zeminli kutu + "arama sonucu degil" aciklamasi \u2014 sonuclarin
       devami gibi gorunup yaniltmasin (43 arayana cocuk urunu "sonuc" sanilmisti) */
    if (rec.length) {
      html += '<div class="recdiv"><i></i><span>\u00D6NER\u0130LER</span><i></i></div>' +
        '<div class="recs"><div class="rt">' + (res.length ? 'Bunlar da ilgini \u00E7ekebilir' : '\u00D6nerilenler') + '</div>' +
        '<div class="rs">' + (res.length
          ? 'Araman\u0131n sonu\u00E7lar\u0131 yukar\u0131da \u2014 bunlar be\u011Fenebilece\u011Fin benzer \u00FCr\u00FCnler'
          : 'Aramana birebir uyan \u00FCr\u00FCn bulamad\u0131k, bunlara g\u00F6z atabilirsin') + '</div>' +
        '<div class="grid">' + rec.map(cardHTML).join('') + '</div></div>';
    }
    bd.classList.remove('busy');
    bd.innerHTML = html;
    if (!preserveScroll) bd.scrollTop = 0; // yeni sorgu \u2192 ba\u015Fa d\u00F6n (filtre de\u011Fi\u015Fiminde koru)
    preserveScroll = false;
    resCount = res.length; pageHasMore = !!m.has_more; loadingMore = false;
    if (d.search_id) curSearchId = d.search_id;
    bindCards();
    bindFilters();
    lastRendered = q;
  }
  /* Filtre de\u011Fi\u015Fince yeni istek atmadan mevcut yan\u0131t\u0131 yeniden \u00E7iz (panel a\u00E7/kapa gibi). */
  function rerenderFilters() { if (lastData) { preserveScroll = true; render(lastData, lastRendered || input.value.trim()); } }
  /* Filtre uygula \u2192 yeni sonu\u00E7+facet getir (sorgu metni sabit). */
  function applyFilterChange() { preserveScroll = true; runPreview(input.value.trim() || lastRendered); }
  /* Sonsuz kayd\u0131rma: dibe yakla\u015F\u0131nca s\u0131radaki sayfay\u0131 getir, grid'e ekle */
  function loadMore() {
    var q = lastRendered;
    loadingMore = true;
    var sp = document.createElement('div'); sp.className = 'ld'; sp.innerHTML = '<i></i><i></i><i></i>';
    bd.appendChild(sp);
    getJSON(API + '?q=' + encodeURIComponent(q) + '&sid=' + SID + '&log=0&offset=' + resCount + filterQS())
      .then(function (d) {
        sp.remove(); loadingMore = false;
        if (q !== lastRendered) return; // bu arada sorgu de\u011Fi\u015Fti
        var res = d.results || [], grid = bd.querySelector('.rgrid');
        if (!grid || !res.length) { pageHasMore = false; return; }
        grid.insertAdjacentHTML('beforeend', res.map(function (p, i) { return cardHTML(p, resCount + i); }).join(''));
        resCount += res.length;
        pageHasMore = !!(d.meta && d.meta.has_more);
        bindCards();
      })
      .catch(function () { sp.remove(); loadingMore = false; });
  }
  bd.addEventListener('scroll', function () {
    if (!pageHasMore || loadingMore || !lastRendered) return;
    if (bd.scrollTop + bd.clientHeight >= bd.scrollHeight - 350) loadMore();
  });
  function bindCards() {
    // Tekrarl\u0131 \u00E7a\u011Fr\u0131l\u0131r (sayfalama ekledik\u00E7e) \u2014 __yb korumas\u0131 \u00E7ift dinleyiciyi \u00F6nler
    [].forEach.call(bd.querySelectorAll('.card'), function (el) {
      if (el.__yb) return; el.__yb = true;
      el.addEventListener('click', function () {
        addRecent(input.value.trim());
        // attribution penceresi: satin alma otomatik yakalamada "aramadan geldi mi" kaniti
        try { localStorage.setItem('yunbi_lastclick_' + TENANT, String(Date.now())); } catch (e) {}
        postEvent({ type: 'click', search_id: curSearchId, product_id: +el.getAttribute('data-id'), position: +el.getAttribute('data-i') + 1, sid: SID });
      });
    });
    // K\u0131r\u0131k g\u00F6rsel: \u00F6nce orijinal boyuta (thumb 404 olabilir), o da k\u0131r\u0131ksa placeholder
    [].forEach.call(bd.querySelectorAll('.card .im img'), function (img) {
      if (img.__yb) return; img.__yb = true;
      img.addEventListener('error', function () {
        var full = img.getAttribute('data-full');
        if (full && img.src !== full) { img.removeAttribute('data-full'); img.src = full; return; }
        var im = img.parentNode;
        if (im && im.querySelectorAll('img').length <= 1) { im.classList.add('noimg'); }
        img.remove();
      });
    });
    // Karusel: hover-bolgesi (masaustu) + dokunmatik kaydirma (mobil) ile gorsel degistir
    [].forEach.call(bd.querySelectorAll('.card .im'), function (im) {
      if (im.__ybc) return; im.__ybc = true;
      var imgs = im.querySelectorAll('img'), dots = im.querySelectorAll('.dots b');
      if (imgs.length < 2) return;
      var show = function (n) {
        n = Math.max(0, Math.min(imgs.length - 1, n));
        [].forEach.call(imgs, function (g, k) { g.classList.toggle('on', k === n); });
        [].forEach.call(dots, function (d, k) { d.classList.toggle('on', k === n); });
        im.__n = n;
      };
      var zones = im.querySelectorAll('.zones i');
      [].forEach.call(zones, function (z, k) {
        z.addEventListener('mouseenter', function () { show(k); });
      });
      im.addEventListener('mouseleave', function () { show(0); });
      // mobil: yatay kaydirma \u2192 sonraki/onceki gorsel (dikey kaydirmayi engelleme)
      var x0 = null, y0 = null;
      im.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
      im.addEventListener('touchend', function (e) {
        if (x0 == null) return; var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
        if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); show((im.__n || 0) + (dx < 0 ? 1 : -1)); }
        x0 = y0 = null;
      });
    });
  }
  function runPreview(q) {
    q = (q || '').trim(); if (q.length < MIN) { showEmpty(); return; }
    // \u0130lk y\u00FCkleme: nokta animasyonu; sonrakiler: mevcut sonu\u00E7lar solukla\u015F\u0131r (flicker yok)
    if (lastRendered) bd.classList.add('busy');
    else bd.innerHTML = '<div class="ld"><i></i><i></i><i></i></div>';
    getJSON(API + '?q=' + encodeURIComponent(q) + '&sid=' + SID + '&log=0' + filterQS())
      .then(function (d) { render(d, q); })
      .catch(function () { if (q === input.value.trim()) { bd.classList.remove('busy'); bd.innerHTML = '<div class="empty">Arama \u015Fu an yap\u0131lam\u0131yor.</div>'; lastRendered = ''; } });
  }
  var lastCommitted = '';
  function commit(q) {
    q = (q || '').trim(); if (q.length < MIN || q === lastCommitted) return;
    lastCommitted = q;
    addRecent(q);
    getJSON(API + '?q=' + encodeURIComponent(q) + '&sid=' + SID + '&log=1').then(function (d) { if (d.search_id) curSearchId = d.search_id; }).catch(function () {});
  }
  function scheduleCommit(q) { clearTimeout(commitT); commitT = setTimeout(function () { commit(q); }, 1500); }

  input.addEventListener('input', function () {
    var q = input.value.trim();
    clearTimeout(previewT); clearTimeout(commitT);
    resetFilters(); // yeni sorgu metni: onceki facet secimleri anlamsiz
    if (input.value) { phStop(); } else { phT = setTimeout(phRun, 900); }
    if (q.length < MIN) { showEmpty(); return; }
    previewT = setTimeout(function () { runPreview(q); }, 280);
    scheduleCommit(q);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(previewT); clearTimeout(commitT); var q = input.value.trim(); if (q.length >= MIN) { runPreview(q); commit(q); } }
  });

  /* \u2550\u2550\u2550 Storefront tetikleyicileri \u2550\u2550\u2550 */
  function bindTrigger(el) {
    if (el.__yunbi) return; el.__yunbi = true;
    el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(''); }, true);
  }
  function bindInput(el) {
    if (el.__yunbi) return; el.__yunbi = true;
    el.setAttribute('autocomplete', 'off');
    var openFromInput = function (e) { e.preventDefault(); open(el.value || ''); };
    el.addEventListener('focus', openFromInput);
    el.addEventListener('click', openFromInput);
  }
  function scan() {
    try { [].forEach.call(document.querySelectorAll(TRIGGER_SEL), bindTrigger); } catch (e) {}
    try { [].forEach.call(document.querySelectorAll(INPUT_SEL), bindInput); } catch (e) {}
  }

  window.YunbiSearch = { open: function (q) { open(q || ''); }, close: close };

  /* === Panel ayarlari: secici config'i sunucudan (temaya dokunmadan yonetim) ===
     Oncelik: panel ayari > script attribute > yerlesik varsayilanlar. 10dk cache. */
  function applyTheme(t) {
    // Marka kimliği (panel): yazı tipi + vurgu + metin rengi; vurgudan açık ton/çizgi/halka türetilir. Boşsa varsayılan kalır.
    if (!t) return;
    var st = host.style;
    if (t.font) st.setProperty('--font', t.font + ',-apple-system,Segoe UI,Roboto,Arial,sans-serif');
    if (t.accent && /^#[0-9a-f]{6}$/i.test(t.accent)) { st.setProperty('--acc', t.accent); st.setProperty('--acc2', t.accent); st.setProperty('--soft', t.accent + '12'); st.setProperty('--line', t.accent + '33'); st.setProperty('--ring', t.accent + '1f'); }
    if (t.ink && /^#[0-9a-f]{6}$/i.test(t.ink)) st.setProperty('--ink', t.ink);
    if (t.ratio && /^[1-4]\/[1-4]$/.test(t.ratio)) st.setProperty('--ratio', t.ratio);
  }
  function applyPlaceholders(list) {
    // Örnek sorgular mağazaya göre (panel ayarı ya da kategorilerden otomatik); boş gelirse yerleşik liste kalır
    if (list && list.length) { phExamples = list.slice(0, 8); phI = 0; }
  }
  function applyCfg(c) {
    if (!c) return;
    if (c.trigger) TRIGGER_SEL = c.trigger;
    if (c.input) INPUT_SEL = c.input;
    applyTheme(c.theme);
    applyPlaceholders(c.placeholders);
    // sablon: panel ayari; data-template attribute'u (demo/onizleme) varsa o kazanir
    if (!TPL_LOCKED && (c.template === 'drawer' || c.template === 'fullscreen')) {
      TEMPLATE = c.template;
      applyTemplate();
    }
    scan();
    dbg('cfg', TRIGGER_SEL, INPUT_SEL, TEMPLATE);
  }
  function loadCfg() {
    var K = 'yunbi_scfg_' + TENANT;
    try {
      var c = JSON.parse(localStorage.getItem(K) || 'null');
      if (c && Date.now() - c.ts < 600000) applyCfg(c);
    } catch (e) {}
    getJSON(API + '/config').then(function (d) {
      var c = { trigger: d.trigger || '', input: d.input || '', template: d.template || '', theme: d.theme || null, placeholders: d.placeholders || [], ts: Date.now() };
      try { localStorage.setItem(K, JSON.stringify(c)); } catch (e) {}
      applyCfg(c);
    }).catch(function () {});
  }

  /* === Satin alma otomatik yakalama (tema snippet'i GEREKMEZ) ===
     Ticimax GA entegrasyonu tesekkur sayfasinda dataLayer'a purchase yazar; onu dinleyip
     conversion gonderiyoruz. Yalniz son 24 saatte aramadan URUN TIKLAMASI varsa sayilir
     (attribution) ve ayni siparis bir kez islenir. */
  function extractPurchase(o) {
    try {
      if (!o) return null;
      // gtag('event','purchase',{...}) bicimi: Arguments listesi
      if (typeof o.length === 'number' && o[0] === 'event' && o[1] === 'purchase' && o[2]) {
        var g = o[2];
        if (g.transaction_id != null) return { id: String(g.transaction_id), value: parseFloat(g.value) || 0 };
      }
      if (typeof o !== 'object') return null;
      var ec = o.ecommerce || {};
      if (o.event === 'purchase' && (ec.transaction_id != null || o.transaction_id != null)) {
        return { id: String(ec.transaction_id != null ? ec.transaction_id : o.transaction_id), value: parseFloat(ec.value != null ? ec.value : o.value) || 0 };
      }
      if (ec.purchase && ec.purchase.actionField && ec.purchase.actionField.id != null) {
        var af = ec.purchase.actionField;
        return { id: String(af.id), value: parseFloat(af.revenue) || 0 };
      }
    } catch (e) {}
    return null;
  }
  function fireConversion(pu) {
    if (!pu || !pu.id) return;
    try {
      var last = parseInt(localStorage.getItem('yunbi_lastclick_' + TENANT) || '0', 10);
      if (!last || Date.now() - last > 86400000) return; // aramadan gelmemis, sayma
      var K = 'yunbi_conv_' + TENANT + '_' + pu.id;
      if (localStorage.getItem(K)) return;
      localStorage.setItem(K, '1');
      postEvent({ type: 'conversion', value: pu.value, order_id: pu.id, sid: SID });
      dbg('conversion', pu.id, pu.value);
    } catch (e) {}
  }
  function watchPurchase() {
    try {
      var dl = window.dataLayer = window.dataLayer || [];
      for (var i = 0; i < dl.length; i++) fireConversion(extractPurchase(dl[i]));
      var orig = dl.push;
      dl.push = function () {
        for (var j = 0; j < arguments.length; j++) fireConversion(extractPurchase(arguments[j]));
        return orig.apply(dl, arguments);
      };
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  try { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  loadCfg();
  watchPurchase();
  dbg('init', TENANT, API);
})();
