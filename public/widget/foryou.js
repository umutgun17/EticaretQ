/*! Yunbi "Sana Özel" öneri kulakçığı (CRO) — ziyaretçi dolaştıkça kişiselleşen 3-4 ürünlük yan panel.
 *  <script src="https://eticaretq.com/widget/foryou.js?v=1" data-tenant="SLUG" async></script>
 *
 *  Kademeli kaynak (sunucu karar verir): sepet > gezilen ürünler > üyenin önceki siparişleri > bulunulan kategori > çok satanlar.
 *  Kullanıcıyı rahatsız etmez: kulakçık kapalı başlar, kendiliğinden açılmaz; oturumda N ürün gezince bir kez küçük balon;
 *  ürün sayfasında silik, ödeme sayfasında yok. Gezinti yalnız tarayıcıda tutulur (ürün id'leri), hub'a id listesi gider.
 *  ikas (Next.js) vitrini: sayfa yenilenmeden gezildiği için yol değişimi izlenir; ürün/kategori bilgisi router props'tan okunur.
 */
(function () {
  'use strict';
  if (window.__yunbiForYouLoaded) return;
  window.__yunbiForYouLoaded = true;

  var SCRIPT = document.currentScript || document.querySelector('script[src*="/widget/foryou.js"]');
  if (!SCRIPT) return;
  var SLUG = SCRIPT.getAttribute('data-tenant');
  if (!SLUG) return;
  var API = SCRIPT.src.replace(/\/widget\/foryou\.js.*$/, '') + '/w/' + encodeURIComponent(SLUG) + '/foryou';
  var DEBUG = /yunbi_debug=1/.test(location.search);
  var VIEWED_KEY = 'yunbi_fy_v', SESS_KEY = 'yunbi_fy_s';

  var cfg = null, R = null;
  var host = null, root = null, tabEl = null, drawerEl = null, bubbleEl = null;
  var open = false, lastPath = '', page = { type: '', id: '', name: '' };
  var sug = { sig: '', data: null, loading: '' };
  var cart = { id: '', lines: [], member: '', at: 0 };
  var sess = load(SESS_KEY, sessionStorage) || { views: 0, nudged: false, opened: false, viewSent: '' };

  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-foryou]'].concat([].slice.call(arguments))); }
  function qs(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { v = parseFloat(v); return isFinite(v) ? v : 0; }
  function money(n) { try { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; } catch (e) { return n.toFixed(2) + ' TL'; } }
  function load(k, store) { try { var v = (store || localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function save(k, v, store) { try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} }
  function saveSess() { save(SESS_KEY, sess, sessionStorage); }
  function sid() {
    try { var s = localStorage.getItem('yunbi_sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('yunbi_sid', s); } return s; } catch (e) { return ''; }
  }
  function device() { return (window.innerWidth || 1024) < 900 ? 'm' : 'd'; }
  function isMobile() { return device() === 'm'; }

  /* ── olaylar ── */
  function send(type, extra) {
    var body = Object.assign({ type: type, sid: sid(), device: device(), path: location.pathname, page_type: (page.type || '').toLowerCase(), mode: sug.data ? sug.data.mode : '', cart_id: cart.id || '', member: cart.member || '' }, extra || {});
    try {
      var payload = JSON.stringify(body);
      if (navigator.sendBeacon && (type === 'click' || type === 'close')) { navigator.sendBeacon(API + '/event', new Blob([payload], { type: 'text/plain' })); return; }
      fetch(API + '/event', { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) {}
  }

  /* ── sayfa bilgisi (ikas router props → __NEXT_DATA__ → yol) ── */
  function readPage() {
    var pp = null;
    try { var r = window.next && window.next.router; var c = r && r.components && r.components[r.route]; pp = c && c.props && c.props.pageProps; } catch (e) {}
    if (!pp) { try { pp = window.__NEXT_DATA__.props.pageProps; } catch (e) {} }
    var d = (pp && pp.pageSpecificData) || {};
    var t = (pp && pp.pageType) || '';
    // İlk yüklemede router props sayfayla uyumlu; SPA geçişinde bazen bir önceki sayfa kalır → yol ile çapraz kontrol
    return { type: t, id: t === 'PRODUCT' || t === 'CATEGORY' ? String(d.id || '') : '', name: t === 'CATEGORY' ? String(d.name || '') : '' };
  }
  function hidden() {
    var paths = String(R.hide_paths || '').split(',');
    for (var i = 0; i < paths.length; i++) { var p = paths[i].trim(); if (p && location.pathname.indexOf(p) === 0) return true; }
    return false;
  }

  /* ── gezilen ürünler (tarayıcıda) ── */
  function viewed() {
    var list = load(VIEWED_KEY) || [], now = Date.now(), out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].p && now - (list[i].t || 0) < 30 * 86400000) out.push(list[i]);
    return out;
  }
  function addViewed(pid) {
    var list = viewed().filter(function (x) { return x.p !== pid; });
    list.unshift({ p: pid, t: Date.now() });
    save(VIEWED_KEY, list.slice(0, 20));
  }

  /* ── sepet (ikas storefront) ── */
  function ikasCfg() { try { return window.__NEXT_DATA__.props.pageProps.configJson || null; } catch (e) { return null; } }
  function cartId() { try { return localStorage.getItem('cartId') || ''; } catch (e) { return ''; } }
  function fetchCart(cb) {
    var id = cartId(), c = ikasCfg();
    if (!id || !c || !c.apiKey) { cart = { id: id, lines: [], member: '', at: Date.now() }; return cb(); }
    if (cart.id === id && Date.now() - cart.at < 60000) return cb();
    var url = (c.apiUrl || 'https://api.myikas.com/api/sf/graphql').replace(/\?.*$/, '') + '?op=getCartById';
    fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'x-sfid': c.storefrontId || '', 'x-sfrid': c.storefrontRoutingId || '', 'x-timezone': 'Europe/Istanbul' },
      body: JSON.stringify({ query: 'query getCartById($id: String) { getCartById(id: $id) { id customerId orderLineItems { quantity deleted variant { id productId barcodeList } } } }', variables: { id: id } }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var cc = j && j.data && j.data.getCartById, lines = [];
        ((cc && cc.orderLineItems) || []).forEach(function (l) { if (!l || l.deleted || !l.variant) return; lines.push({ p: String(l.variant.productId || ''), v: String(l.variant.id || ''), q: num(l.quantity || 1), b: String((l.variant.barcodeList || [])[0] || '') }); });
        cart = { id: id, lines: lines, member: String((cc && cc.customerId) || ''), at: Date.now() };
      })
      .catch(function () { cart = { id: id, lines: [], member: '', at: Date.now() }; })
      .then(cb);
  }

  /* ── öneri ── */
  function signature() {
    var v = viewed().map(function (x) { return x.p; }).filter(function (p) { return p !== page.id; }).slice(0, 12);
    var c = cart.lines.map(function (l) { return l.p + ':' + l.v + ':' + l.q + ':' + l.b; });
    var cur = page.type === 'PRODUCT' ? page.id : '', cat = page.type === 'CATEGORY' ? page.name : '';
    return { q: 'viewed=' + encodeURIComponent(v.join(',')) + '&cart=' + encodeURIComponent(c.join(',')) + '&member=' + encodeURIComponent(cart.member) + '&cur=' + encodeURIComponent(cur) + '&cat=' + encodeURIComponent(cat), key: [v.join(','), c.join(','), cart.member, cur, cat].join('|') };
  }
  function suggest(cb) {
    fetchCart(function () {
      var s = signature();
      if (sug.data && sug.sig === s.key) return cb(sug.data);
      if (sug.loading === s.key) return;
      sug.loading = s.key;
      fetch(API + '/suggest?' + s.q, { mode: 'cors', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (sug.loading !== s.key) return;
          sug.loading = '';
          sug.sig = s.key; sug.data = j && j.items ? j : { mode: 'bestseller', subtitle: '', items: [] };
          dbg('öneri', sug.data.mode, sug.data.items.length);
          cb(sug.data);
        })
        .catch(function () { sug.loading = ''; send('error', { value: 'suggest' }); cb(null); });
    });
  }

  /* ── görünüm ── */
  var CSS = function () {
    var acc = R.accent || '#111111', left = R.side === 'left', side = left ? 'left' : 'right', oside = left ? 'right' : 'left';
    return ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:inherit}' +
      '.w{font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}' +
      '.tab{position:fixed;z-index:2147481800;' + side + ':0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px 9px 12px;background:' + acc + ';color:#fff;border-radius:' + (left ? '0 12px 12px 0' : '12px 0 0 12px') + ';box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;user-select:none;transition:opacity .25s,transform .25s;font-weight:700;letter-spacing:.12em;font-size:11px}' +
      '.tab svg{width:18px;height:18px}' +
      '.tab .tx{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;line-height:1}' +
      '.tab.subtle{opacity:.62;transform:translateY(-50%) scale(.9)}.tab.subtle:hover{opacity:1;transform:translateY(-50%)}' +
      '.tab.hide{opacity:0;pointer-events:none}' +
      '.tab .ct{position:absolute;top:-6px;' + oside + ':-6px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#fff;color:' + acc + ';font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2);letter-spacing:0}' +
      '.bub{position:fixed;z-index:2147481801;top:50%;' + side + ':54px;transform:translateY(-50%);background:#fff;color:#111;border-radius:12px;padding:10px 13px;font-size:12.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.18);cursor:pointer;max-width:200px;line-height:1.35;animation:fy-in .3s ease}' +
      '.bub:after{content:"";position:absolute;top:50%;' + side + ':-6px;margin-top:-6px;border:6px solid transparent;border-' + oside + '-color:#fff;border-' + side + ':0}' +
      '.bub small{display:block;font-weight:400;color:#666;font-size:11px;margin-top:2px}' +
      '@keyframes fy-in{from{opacity:0;transform:translateY(-50%) translateX(' + (left ? '-' : '') + '8px)}to{opacity:1;transform:translateY(-50%)}}' +
      '.ov{position:fixed;inset:0;z-index:2147481850;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .25s}' +
      '.ov.on{opacity:1;pointer-events:auto}' +
      '.dr{position:fixed;z-index:2147481860;top:0;bottom:0;' + side + ':0;width:min(640px,calc(100vw - 16px));background:#fff;box-shadow:-12px 0 40px rgba(0,0,0,.2);transform:translateX(' + (left ? '-' : '') + '105%);transition:transform .3s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column}' +
      '.dr.on{transform:none}' +
      '.hd{padding:16px 18px 10px;border-bottom:1px solid #eee;display:flex;align-items:flex-start;gap:10px}' +
      '.hd h3{margin:0;font-size:17px;font-weight:700;letter-spacing:.01em}.hd p{margin:3px 0 0;font-size:12.5px;color:#666}' +
      '.hd .x{margin-' + oside + ':auto;width:32px;height:32px;border:0;background:#f3f3f3;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#333;flex:none}' +
      // Masaüstü: 3 sütun × satır sayısı panel yüksekliğine ESNER (alt boşluk kalmaz, görseller uzar); mobil: 2 sütun 3:4, kaydırmalı
      '.ls{padding:12px 14px 14px;flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(var(--rows,2),minmax(0,1fr));gap:12px 12px;overflow:hidden}' +
      '.cd{min-width:0;min-height:0;display:flex;flex-direction:column}.cd .imw{position:relative;flex:1;min-height:0}' +
      '.cd .im{display:block;position:relative;width:100%;height:100%;border-radius:12px;overflow:hidden;background:#f5f5f5}.cd .im img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s}.cd .im:hover img{transform:scale(1.04)}' +
      '.cd .ad{margin-top:7px;width:100%;height:34px;border-radius:8px;border:1.5px solid ' + acc + ';background:#fff;color:' + acc + ';font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,color .15s}' +
      '.cd .ad:hover{background:' + acc + ';color:#fff}.cd .ad.ok{background:' + acc + ';color:#fff}.cd .ad.busy{opacity:.6;pointer-events:none}' +
      '.cd .lw{position:absolute;top:8px;' + side + ':8px;background:#fff;color:#b45309;font-size:10px;font-weight:700;padding:3px 7px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.15)}' +
      '.cd .nm{display:block;margin-top:8px;font-size:12.5px;font-weight:600;line-height:1.3;color:#111;text-decoration:none;height:2.6em;overflow:hidden}' +
      '.cd .pr{margin-top:3px;font-size:13.5px;font-weight:700}.cd .pr s{color:#999;font-weight:400;font-size:11.5px;margin-right:5px}' +
      '.em{grid-column:1/-1;padding:30px 16px;text-align:center;color:#777;font-size:13px}' +
      '.ft{padding:9px 18px 12px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center}' +
      // Dikkat (sırıtmadan): kulakçık ilk gelişte kenardan süzülür, 6 sn'de bir nefes alır + üzerinden ince bir ışık süpürmesi geçer, ikon göz kırpar;
      // panel açılınca kartlar sırayla belirir; masaüstünde kartın üstüne gelince hafif yükselir; "Eklendi" küçük bir zıplamayla onaylar.
      '@keyframes fy-pulse{0%,70%,100%{transform:translateY(-50%) scale(1);box-shadow:0 8px 24px rgba(0,0,0,.18)}80%{transform:translateY(-50%) scale(1.07);box-shadow:0 12px 32px rgba(0,0,0,.3)}90%{transform:translateY(-50%) scale(1)}}' +
      '@keyframes fy-tabin{from{transform:translateY(-50%) translateX(' + (left ? '-' : '') + '110%);opacity:0}to{transform:translateY(-50%);opacity:1}}' +
      '@keyframes fy-sheen{0%,76%{transform:translateY(-130%) rotate(12deg);opacity:0}80%{opacity:.9}100%{transform:translateY(130%) rotate(12deg);opacity:0}}' +
      '@keyframes fy-twinkle{0%,85%,100%{transform:scale(1) rotate(0)}90%{transform:scale(1.25) rotate(-12deg)}95%{transform:scale(1.1) rotate(8deg)}}' +
      '@keyframes fy-card{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}' +
      '@keyframes fy-pop{0%{transform:scale(1)}40%{transform:scale(1.08)}100%{transform:scale(1)}}' +
      '@keyframes fy-badge{0%{transform:scale(0)}60%{transform:scale(1.25)}100%{transform:scale(1)}}' +
      '.tab.in{animation:fy-tabin .55s cubic-bezier(.2,.8,.2,1) both}' +
      '.tab .sh{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}' +
      '.tab .sh:before{content:"";position:absolute;left:-40%;right:-40%;top:0;height:40%;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.35),rgba(255,255,255,0));opacity:0}' +
      (R.pulse !== false ? '.tab.pulse:not(.subtle):not(.hide){animation:fy-pulse 6s ease-in-out infinite}.tab.pulse:not(.subtle):not(.hide) .sh:before{animation:fy-sheen 6s ease-in-out infinite}.tab.pulse:not(.hide) svg{animation:fy-twinkle 6s ease-in-out infinite 1s}' : '') +
      '.tab .ct{animation:fy-badge .45s cubic-bezier(.2,.8,.2,1) both}' +
      '.dr.on .cd{animation:fy-card .4s cubic-bezier(.2,.8,.2,1) both}' +
      '@media (hover:hover){.cd{transition:transform .25s,filter .25s}.cd:hover{transform:translateY(-3px)}.cd:hover .im{box-shadow:0 10px 24px rgba(0,0,0,.14)}}' +
      '.cd .ad.ok{animation:fy-pop .35s ease}' +
      '@media (max-width:640px){.dr{top:auto;bottom:0;left:0;right:0;width:auto;height:88vh;height:88dvh;border-radius:20px 20px 0 0;transform:translateY(105%);box-shadow:0 -12px 40px rgba(0,0,0,.22)}.dr.on{transform:none}.dr:before{content:"";position:absolute;top:8px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:#ddd}.hd{padding-top:20px}.ls{display:flex;flex-wrap:wrap;align-content:flex-start;gap:14px 10px;padding:10px 12px 14px;overflow:auto;-webkit-overflow-scrolling:touch}.cd{display:block;width:calc(50% - 5px);flex:none}.cd .imw{position:relative}.cd .im{aspect-ratio:3/4;height:auto}.cd .nm{height:2.6em}.tab{padding:12px 7px 10px;font-size:10px}.tab svg{width:16px;height:16px}}' +
      '@media (prefers-reduced-motion:reduce){.dr,.ov,.tab,.bub,.cd,.ct,.ad,.tab:before,.tab svg{transition:none;animation:none!important}}';
  };
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>';

  function mount() {
    host = document.createElement('div');
    host.id = 'yunbi-foryou';
    host.setAttribute('data-yunbi', '1');
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' + CSS() + '</style><div class="w">' +
      '<button type="button" class="tab hide pulse" aria-label="' + esc(R.title) + '"><span class="sh"></span>' + ICON + '<span class="tx">' + esc(R.tab_text) + '</span><span class="ct" style="display:none"></span></button>' +
      '<div class="ov"></div>' +
      '<aside class="dr" role="dialog" aria-label="' + esc(R.title) + '"><div class="hd"><div><h3>' + esc(R.title) + '</h3><p class="sb"></p></div><button type="button" class="x" aria-label="Kapat">' + ICON_X + '</button></div><div class="ls"><div class="em">Hazırlanıyor…</div></div><div class="ft">Gezdiklerine ve en çok sevilenlere göre seçildi</div></aside></div>';
    document.body.appendChild(host);
    tabEl = qs('.tab', root); drawerEl = qs('.dr', root);
    tabEl.classList.add('in'); setTimeout(function () { tabEl.classList.remove('in'); }, 700);
    tabEl.addEventListener('click', function () { openPanel('tab'); });
    qs('.x', root).addEventListener('click', closePanel);
    qs('.ov', root).addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) closePanel(); });
  }
  function syncTab() {
    if (!tabEl) return;
    var hide = hidden() || (page.type === 'PRODUCT' && R.product_page === 'hidden');
    tabEl.classList.toggle('hide', hide);
    tabEl.classList.toggle('subtle', !hide && page.type === 'PRODUCT' && R.product_page === 'subtle' && !open);
    var ct = qs('.ct', tabEl), n = sug.data ? sug.data.items.length : 0;
    ct.style.display = n && !sess.opened ? 'flex' : 'none'; ct.textContent = n;
  }
  function render(data) {
    var ls = qs('.ls', root), sb = qs('.sb', root);
    if (!data || !data.items.length) { ls.innerHTML = '<div class="em">Şu an öneri hazırlayamadık, biraz sonra tekrar bak.</div>'; sb.textContent = ''; return; }
    sb.textContent = data.subtitle || '';
    ls.style.setProperty('--rows', String(Math.max(1, Math.ceil(data.items.length / 3))));
    ls.innerHTML = data.items.map(function (it, i) {
      var pr = num(it.discounted) > 0 && num(it.discounted) < num(it.price) ? '<s>' + esc(money(num(it.price))) + '</s>' + esc(money(num(it.discounted))) : esc(money(num(it.price)));
      var add = R.show_add && it.variant_id && typeof window.addToCart === 'function';
      return '<div class="cd" data-i="' + i + '" style="animation-delay:' + (i * 60) + 'ms"><div class="imw">' +
        '<a class="im" href="' + esc(it.url) + '" data-i="' + i + '"><img src="' + esc(it.image) + '" alt="" loading="lazy">' +
        (it.low_stock ? '<span class="lw">Son ' + esc(it.low_stock) + '</span>' : '') + '</a></div>' +
        '<a class="nm" href="' + esc(it.url) + '" data-i="' + i + '">' + esc(it.name) + '</a><div class="pr">' + pr + '</div>' +
        (add ? '<button type="button" class="ad" data-i="' + i + '">' + ICON_PLUS + 'Sepete ekle</button>' : '') + '</div>';
    }).join('');
    ls.querySelectorAll('a[data-i]').forEach(function (a) {
      a.addEventListener('click', function () { var it = data.items[+a.getAttribute('data-i')]; send('click', { product_id: it.id, position: +a.getAttribute('data-i') + 1 }); });
    });
    ls.querySelectorAll('.ad').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-i'), it = data.items[i];
        if (b.classList.contains('busy') || b.classList.contains('ok')) return;
        b.classList.add('busy');
        var done = function (ok) {
          b.classList.remove('busy');
          if (ok) { b.classList.add('ok'); b.innerHTML = ICON_CHECK + 'Eklendi'; cart.at = 0; send('atc', { product_id: it.id, position: i + 1, value: String(it.variant_id) }); }
          else { b.innerHTML = ICON_PLUS + 'Sepete ekle'; send('error', { value: 'atc', product_id: it.id }); try { location.href = it.url; } catch (e) {} }
        };
        try {
          var p = window.addToCart({ variantId: String(it.variant_id), quantity: 1 });
          if (p && typeof p.then === 'function') p.then(function (r) { done(r !== false); }, function () { done(false); });
          else setTimeout(function () { done(true); }, 900);
        } catch (e) { done(false); }
      });
    });
  }
  function openPanel(source) {
    if (open) return;
    open = true; sess.opened = true; saveSess(); hideBubble();
    window.__yunbiForYouOpen = true;
    qs('.ov', root).classList.add('on'); drawerEl.classList.add('on'); syncTab();
    suggest(function (data) {
      render(data);
      send('open', { source: source, mode: data ? data.mode : '' });
      if (data && data.items.length) send('impression', { value: data.items.map(function (it) { return it.id; }).join(',') });
    });
  }
  function closePanel() {
    if (!open) return;
    open = false;
    window.__yunbiForYouOpen = false;
    qs('.ov', root).classList.remove('on'); drawerEl.classList.remove('on'); syncTab();
    send('close');
  }
  function showBubble() {
    if (bubbleEl || open) return;
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'bub';
    bubbleEl.innerHTML = esc(String(R.nudge_text || '').replace('{count}', String(sug.data ? sug.data.items.length : R.count))) + '<small>Göz atmak için dokun</small>';
    bubbleEl.addEventListener('click', function () { openPanel('nudge'); });
    qs('.w', root).appendChild(bubbleEl);
    send('nudge');
    setTimeout(hideBubble, 8000);
  }
  function hideBubble() { if (bubbleEl && bubbleEl.parentNode) bubbleEl.parentNode.removeChild(bubbleEl); bubbleEl = null; }

  /* ── otomatik açılma (ürün/ödeme sayfasında asla; günde auto_daily; kapatan o gün görmez) ── */
  var AO_KEY = 'yunbi_fy_ao';
  function aoState() { var v = load(AO_KEY) || {}; var d = new Date().toISOString().slice(0, 10); if (v.d !== d) v = { d: d, n: 0 }; return v; }
  function aoAllowed() {
    if (!R.auto_open || open || hidden() || page.type === 'PRODUCT') return false;
    if (window.__yunbiWelcomeOpen) return false;                       // Hoş geldin kartı açıkken kendiliğinden açılmaz
    if (sess.opened) return false;
    var v = aoState(); return v.n < (R.auto_daily || 1);
  }
  function autoOpen(source) {
    if (!aoAllowed()) return;
    suggest(function (data) {
      if (!data || !data.items.length || !aoAllowed()) return;
      var v = aoState(); v.n++; save(AO_KEY, v);
      openPanel(source);
    });
  }
  var idleTimer = null, viewsTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    if (!(R.auto_idle > 0) || page.type === 'PRODUCT' || !aoAllowed()) return;
    idleTimer = setTimeout(function () { autoOpen('auto_idle'); }, R.auto_idle * 1000);
  }
  function armExit() {
    if (!R.auto_exit || isMobile() || ('ontouchstart' in window)) return;
    document.addEventListener('mouseout', function (e) { if (e.clientY <= 0 && !e.relatedTarget) autoOpen('auto_exit'); });
  }

  /* ── sayfa değişimi ── */
  function onPage(first) {
    clearTimeout(viewsTimer);
    var p = readPage();
    page = p;
    if (p.type === 'PRODUCT' && p.id) { addViewed(p.id); sess.views++; saveSess(); }
    syncTab();
    // Önerinin modu olay kayıtlarına girsin diye arka planda hazırla (sinyalsiz akış sunucuda önbellekli)
    suggest(function (data) {
      syncTab();
      if (data && !sess.viewSent) { sess.viewSent = data.mode; saveSess(); send('view', { mode: data.mode }); }
      if (open) render(data);
      // Gezdikten sonra ürün dışı sayfaya dönünce panel kendiliğinden açılır — ama "şak diye" değil: sayfa önce algılansın diye
      // auto_delay sn sonra (bu arada başka sayfaya geçerse iptal); ürün sayfasındaysa yalnız balon
      if (R.auto_views > 0 && sess.views >= R.auto_views && page.type !== 'PRODUCT' && aoAllowed()) {
        clearTimeout(viewsTimer);
        var atPath = location.pathname;
        viewsTimer = setTimeout(function () { if (location.pathname === atPath) autoOpen('auto_views'); }, Math.max(0, R.auto_delay == null ? 8 : R.auto_delay) * 1000);
        return;
      }
      if (R.nudge_after > 0 && !sess.nudged && !sess.opened && !hidden() && sess.views >= R.nudge_after && data && data.items.length) { sess.nudged = true; saveSess(); showBubble(); }
    });
    armIdle();
    if (open && !first) closePanel();
    else if (!first) sug.data = null; // yeni sayfa → eski liste bayat; kapalıyken sessizce yenilenir
  }
  function watch() {
    lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        // ikas router props birkaç yüz ms sonra yeni sayfaya geçer
        setTimeout(function () { if (location.pathname === lastPath) onPage(false); }, 700);
      }
      if (host && host.isConnected === false) document.body.appendChild(host);
    }, 400);
    try {
      if (window.IkasEvents && window.IkasEvents.subscribe) window.IkasEvents.subscribe({ id: 'yunbi-foryou', callback: function (e) {
        var t = e && e.type;
        // Sepet değişti → bir sonraki açılışta taze öneri (açıkken yeniden çizmez: "Eklendi" geri bildirimi kaybolmasın)
        if (t === 'ADD_TO_CART' || t === 'REMOVE_FROM_CART' || /CART/.test(String(t))) cart.at = 0;
      } });
    } catch (e) {}
  }

  function start() {
    mount();
    onPage(true);
    watch();
    armExit();
  }

  function init() {
    fetch(API + '/config', { mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.enabled || !j.rules) return;
        cfg = j; R = j.rules;
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
      })
      .catch(function () {});
  }
  init();
})();
