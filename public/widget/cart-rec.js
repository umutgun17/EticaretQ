/*!
 * Yunbi Urun Oneri widget v4
 * v4: checkout ust blok = 'Sana Ozel Teklif' (tek urun, kalici sayac, kupon modu: CTA'da
 *     Ticimax'ta tek kullanimlik kupon acilir ve SPA API'siyle (checkout_addToCart /
 *     checkout_addGiftCode) yenilemesiz sepete ekleme + otomatik kupon uygulama).
 * Surface 1 (atc): add-to-cart detected on theme pages -> co-purchase, size-aware offer sheet
 * Surface 2 (checkout): INLINE blocks INSIDE the /checkout page (Ticimax checkout SPA):
 *   - top strip (with countdown) above the basket item list
 *   - bottom grid (no timer, more options) below the basket item list
 *   Cart is read from window.checkout_basket (barcode per line -> exact variant/size
 *   resolution server-side). Add-to-cart uses same-origin /cart/AddToCartV3 + reload.
 * Tracks impression / click / atc with surface tag via text/plain beacon.
 * NOTE: file must stay 100% ASCII (Turkish text uses \uXXXX escapes).
 */
(function () {
  'use strict';

  var w = window, d = document;
  if (w.__yunbiCartRec) return; // double include guard (theme embed + GTM both possible)
  w.__yunbiCartRec = true;

  var script = d.currentScript || (function () { var s = d.getElementsByTagName('script'); return s[s.length - 1]; })();
  var HUB = (script && script.src ? script.src.split('/widget/')[0] : 'https://hub.yunbi.ai');
  var TENANT = (script && script.getAttribute('data-tenant')) || 'tonnyblack';
  var BASE = HUB + '/w/' + TENANT + '/rec';

  var CFG = null;
  var selfAdd = false;
  var open = false;
  var timerInt = null;
  var IS_CHECKOUT = /^\/(checkout|sepetim)(\/|$|\?|\.)/i.test(w.location.pathname);

  /* ---------- session id ---------- */
  function sid() {
    try {
      var k = 'yunbi_rec_sid', v = localStorage.getItem(k);
      if (!v) { v = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  }

  /* ---------- member id ---------- */
  function memberId() {
    try {
      if (w.globalModel && w.globalModel.isAuthenticated && w.globalModel.member && w.globalModel.member.memberId) {
        return String(w.globalModel.member.memberId);
      }
    } catch (e) { }
    return '';
  }

  /* ---------- event beacon (text/plain => no preflight) ---------- */
  function postEvent(payload) {
    try {
      payload.sid = sid();
      var m = memberId(); if (m) payload.member = m;
      var body = new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=UTF-8' });
      if (navigator.sendBeacon) { navigator.sendBeacon(BASE + '/event', body); return; }
      fetch(BASE + '/event', { method: 'POST', body: body, keepalive: true });
    } catch (e) { }
  }

  /* ============================================================
   * SURFACE 1 - add-to-cart offer (theme pages)
   * ============================================================ */
  function extractIds(data) {
    var vid = 0, pid = 0;
    try {
      var o = typeof data === 'string' ? JSON.parse(data) : (data || {});
      vid = parseInt(o.variantId || o.VariantId || 0, 10) || 0;
      pid = parseInt(o.productId || o.ProductId || 0, 10) || 0;
    } catch (e) {
      var mv = /"?variantId"?[=:]\s*"?(\d+)/i.exec(String(data || ''));
      if (mv) vid = parseInt(mv[1], 10) || 0;
      var mp = /"?productId"?[=:]\s*"?(\d+)/i.exec(String(data || ''));
      if (mp) pid = parseInt(mp[1], 10) || 0;
    }
    return { vid: vid, pid: pid };
  }

  function hookAjax() {
    var jq = w.jQuery || w.$;
    if (!jq || !jq.fn || !jq.fn.jquery) return false;
    jq(d).ajaxSuccess(function (ev, xhr, settings) {
      try {
        var url = String((settings && settings.url) || '');
        if (url.indexOf('/cart/AddToCart') === -1) return;
        if (selfAdd) return;
        var ids = extractIds(settings.data);
        if (ids.vid || ids.pid) onAdded(ids.vid, ids.pid);
      } catch (e) { }
    });
    return true;
  }

  function hookSepeteEkle(triesLeft) {
    if (typeof w.sepeteEkle === 'function' && !w.sepeteEkle.__yunbiWrapped) {
      var orig = w.sepeteEkle;
      var wrapped = function (n, t, i, r, u, f, e, o, s, h, c, l) {
        try {
          if (!selfAdd) {
            var vid = parseInt(n, 10) || 0;
            var pid = parseInt(l, 10) || parseInt(u, 10) || 0;
            if (vid || pid) setTimeout(function () { onAdded(vid, pid); }, 400);
          }
        } catch (err) { }
        return orig.apply(this, arguments);
      };
      wrapped.__yunbiWrapped = true;
      w.sepeteEkle = wrapped;
      return;
    }
    if (triesLeft > 0) setTimeout(function () { hookSepeteEkle(triesLeft - 1); }, 500);
  }

  var lastShownKey = '';
  var pendingKey = '';
  function onAdded(variantId, productId) {
    if (!CFG || !CFG.enabled || !CFG.atc_enabled || open) return;
    var key = 'p' + productId + 'v' + variantId;
    // ayni ekleme icin hem sepeteEkle-wrap hem ajaxSuccess tetiklenebilir -> tek istek
    if (key === lastShownKey || key === pendingKey) return;
    pendingKey = key;
    setTimeout(function () { if (pendingKey === key) pendingKey = ''; }, 5000);
    try {
      var seen = JSON.parse(sessionStorage.getItem('yunbi_rec_seen') || '[]');
      if (seen.indexOf(key) !== -1) return;
    } catch (e) { }

    var qs = 'variant=' + encodeURIComponent(variantId || '') + '&product=' + encodeURIComponent(productId || '');
    var m = memberId(); if (m) qs += '&member=' + encodeURIComponent(m);
    fetch(BASE + '/cart-offer?' + qs, { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.items || !res.items.length) return;
        lastShownKey = key;
        try {
          var seen = JSON.parse(sessionStorage.getItem('yunbi_rec_seen') || '[]');
          seen.push(key); sessionStorage.setItem('yunbi_rec_seen', JSON.stringify(seen.slice(-40)));
        } catch (e) { }
        // small delay: let the theme's own added-to-cart feedback settle first
        setTimeout(function () {
          renderSheet(res.items, {
            sourceId: res.source_id || null,
            sizeLabel: res.size || '',
            personalized: !!res.personalized,
            title: CFG.title, subtitle: CFG.subtitle, badge: CFG.badge, cta: CFG.cta,
            timer: CFG.timer_seconds
          });
        }, 700);
        postEvent({
          type: 'impression', surface: 'atc',
          source_id: res.source_id || null,
          size: res.size || '',
          products: res.items.map(function (it, i) { return { id: it.id, pos: i + 1 }; })
        });
      })
      .catch(function () { });
  }

  /* ============================================================
   * SURFACE 2 - INLINE blocks inside the checkout page
   * ============================================================ */
  function readCheckoutCart(cb, triesLeft) {
    triesLeft = triesLeft == null ? 30 : triesLeft; // SPA sepeti gec doldurur -> ~15s bekle
    var prods = null;
    try {
      prods = w.checkout_basket && w.checkout_basket.products;
    } catch (e) { }
    if (prods && prods.length) {
      var out = [];
      for (var i = 0; i < prods.length && out.length < 40; i++) {
        var p = prods[i] || {};
        out.push({
          p: parseInt(p.cardId || p.productId || 0, 10) || 0,
          v: 0, // checkout modelinde varyant id belirsiz -> barkod esas
          b: String(p.barcode || ''),
          q: parseInt(p.quantity || p.piece || 1, 10) || 1
        });
      }
      return cb(out);
    }
    // fallback: tema REST'i (ayni origin, cookie'li)
    if (triesLeft === 20) {
      fetch('/api/cart/GetCartLite', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var arr = j ? findProductsArray(j, 0) : null;
          if (arr && arr.length) {
            var out = [];
            for (var i = 0; i < arr.length && out.length < 40; i++) {
              var p = arr[i] || {};
              out.push({
                p: parseInt(p.productId || p.ProductId || 0, 10) || 0,
                v: parseInt(p.variantId || p.VariantId || 0, 10) || 0,
                b: String(p.barcode || p.Barkod || ''),
                q: parseInt(p.piece || p.quantity || 1, 10) || 1
              });
            }
            return cb(out);
          }
        })
        .catch(function () { });
    }
    if (triesLeft > 0) setTimeout(function () { readCheckoutCart(cb, triesLeft - 1); }, 500);
    else cb([]);
  }

  function findProductsArray(o, depth) {
    if (depth > 4 || !o || typeof o !== 'object') return null;
    if (Object.prototype.toString.call(o) === '[object Array]') {
      if (o.length && o[0] && typeof o[0] === 'object' &&
          ('variantId' in o[0] || 'VariantId' in o[0]) &&
          ('productId' in o[0] || 'ProductId' in o[0])) return o;
      for (var i = 0; i < o.length; i++) { var f = findProductsArray(o[i], depth + 1); if (f) return f; }
      return null;
    }
    for (var k in o) { var g = findProductsArray(o[k], depth + 1); if (g) return g; }
    return null;
  }

  // Yerlestirme: "prepend:.sel, append:.sel, before:.sel, after:.sel" - ilk GORUNUR aday kazanir
  function placeHost(spec, host) {
    var cands = String(spec || '').split(',');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i].trim();
      if (!c) continue;
      var mode = 'before', sel = c;
      var m = /^(before|after|prepend|append):(.+)$/i.exec(c);
      if (m) { mode = m[1].toLowerCase(); sel = m[2].trim(); }
      var nodes;
      try { nodes = d.querySelectorAll(sel); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (!el.offsetParent && el !== d.body) continue; // gorunmez
        try {
          if (mode === 'before') el.parentNode.insertBefore(host, el);
          else if (mode === 'after') el.parentNode.insertBefore(host, el.nextSibling);
          else if (mode === 'prepend') el.insertBefore(host, el.firstChild);
          else el.appendChild(host);
          return true;
        } catch (e) { }
      }
    }
    return false;
  }

  var coRendered = false;
  var HERO = null; // checkout-offer yaniti: teklif urunu + kupon on-hesabi
  function initCheckoutInline() {
    readCheckoutCart(function (lines) {
      lines = (lines || []).filter(function (l) { return l.p || l.v || l.b; });
      if (!lines.length || coRendered) return;

      var qs = 'items=' + encodeURIComponent(lines.map(function (l) {
        return l.p + ':' + (l.v || 0) + ':' + l.q + ':' + (l.b || '');
      }).join(','));
      var m = memberId(); if (m) qs += '&member=' + encodeURIComponent(m);

      fetch(BASE + '/checkout-offer?' + qs, { mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          if (!res || !res.items || !res.items.length || coRendered) return;
          coRendered = true;
          HERO = res.hero || null;
          mountCheckoutBlocks(res);
          postEvent({
            type: 'impression', surface: 'checkout',
            size: (res.sizes || []).join('/'),
            products: res.items.map(function (it, i) { return { id: it.id, pos: i + 1 }; })
          });
        })
        .catch(function () { });
    });
  }

  function mountCheckoutBlocks(res) {
    var items = res.items;
    var topSel = CFG.co_top_selector || 'prepend:.basket-main-wrapper, prepend:.basket-content, prepend:[class*="basket-container"]';
    var botSel = CFG.co_bottom_selector || 'append:.basket-main-wrapper, append:.basket-content, append:[class*="basket-container"]';

    var mounted = { top: null, bottom: null };
    var tryMount = function () {
      if (CFG.co_top_enabled && !mounted.top) {
        var topItems = items.slice(0, CFG.co_top_count || 3);
        var h1 = (CFG.offer ? buildOfferBlock(topItems) : buildInlineBlock('top', topItems));
        if (placeHost(topSel, h1.host)) { mounted.top = h1; h1.start(); }
      }
      if (CFG.co_bottom_enabled && !mounted.bottom) {
        var h2 = buildInlineBlock('bottom', items);
        if (placeHost(botSel, h2.host)) { mounted.bottom = h2; h2.start(); }
      }
      return (!CFG.co_top_enabled || mounted.top) && (!CFG.co_bottom_enabled || mounted.bottom);
    };

    // SPA gec render eder + re-render'da dugumu silebilir -> dene + bekci
    var tries = 40; // 20s
    var iv = setInterval(function () {
      tryMount();
      if (mounted.top && !mounted.top.host.isConnected && !mounted.top.host.__yunbiDone) mounted.top = null;
      if (mounted.bottom && !mounted.bottom.host.isConnected) mounted.bottom = null;
      if (--tries <= 0) clearInterval(iv);
    }, 500);
    tryMount();
  }

  function buildInlineBlock(kind, items) {
    var accent = CFG.accent || '#111111', highlight = CFG.highlight || '#e11d48';
    var host = d.createElement('div');
    host.className = 'yunbi-rec-inline';
    host.setAttribute('data-kind', kind);
    // SPA layout'una karsi sigorta
    host.style.cssText = 'display:block!important;width:100%!important;max-width:100%!important;margin:10px 0!important;position:static!important;float:none!important;clear:both!important;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = d.createElement('style');
    style.textContent = inlineCss(accent, highlight);
    root.appendChild(style);

    var wrap = d.createElement('div');
    wrap.className = 'blk ' + kind;
    root.appendChild(wrap);

    var isTop = kind === 'top';
    var title = isTop ? (CFG.co_title || 'Son bir f\u0131rsat!') : (CFG.co_bottom_title || 'Bunlar\u0131 da be\u011fenebilirsin');
    var badge = (isTop && CFG.co_badge) ? '<span class="bdg">' + ICON_SPARK + esc(CFG.co_badge) + '</span>' : '';
    var timer = (isTop && CFG.co_timer_seconds > 0) ? '<span class="tmr" id="ytmr">' + mmss(CFG.co_timer_seconds) + '</span>' : '';
    var sub = isTop && CFG.co_subtitle ? '<div class="st">' + esc(CFG.co_subtitle) + '</div>' : '';

    var cards = items.map(function (it, i) {
      var disc = it.discounted != null;
      var pct = disc ? Math.round((1 - it.discounted / it.price) * 100) : 0;
      return '<div class="cd" data-i="' + i + '">' +
        '<a class="im" data-go="1" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
          (it.image ? '<img loading="lazy" src="' + esc(it.image) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(String(it.image).replace('/thumb/', '/buyuk/')) + '\'">' : '') +
          (pct > 0 ? '<span class="dc">-%' + pct + '</span>' : '') +
          (it.size ? '<span class="szc">' + esc(it.size) + '</span>' : '') +
          (it.low_stock ? '<span class="ls">Son ' + it.low_stock + '</span>' : '') +
        '</a>' +
        '<div class="inf">' +
          '<a class="nm" data-go="1" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a>' +
          '<div class="pr">' + (disc ? '<span class="po">' + fmtPrice(it.price) + '</span><span class="pn">' + fmtPrice(it.discounted) + '</span>' : '<span class="pn nod">' + fmtPrice(it.price) + '</span>') + '</div>' +
          '<button class="bt" data-add="1">' + ICON_CART + esc(CFG.co_cta || 'Sepete Ekle') + '</button>' +
        '</div></div>';
    }).join('');

    wrap.innerHTML =
      '<div class="hd">' +
        '<div class="rowb">' + badge + timer + '</div>' +
        '<div class="tt">' + esc(title) + '</div>' + sub +
      '</div>' +
      '<div class="row' + (isTop ? ' scrollx' : ' grid') + '">' + cards + '</div>';

    wrap.addEventListener('click', function (ev) {
      var addEl = closestAttr(ev.target, 'data-add', wrap);
      var goEl = closestAttr(ev.target, 'data-go', wrap);
      var cd = closestClass(ev.target, 'cd', wrap);
      if (!cd) return;
      var idx = parseInt(cd.getAttribute('data-i'), 10);
      var it = items[idx];
      if (!it) return;
      if (addEl) {
        ev.preventDefault();
        if (addEl.classList.contains('ok') || addEl.classList.contains('busy')) return;
        addEl.classList.add('busy');
        postEvent({ type: 'atc', surface: 'checkout', product_id: it.id, size: it.size || '', position: idx + 1 });
        checkoutAddToCart(it, addEl);
        return;
      }
      if (goEl) {
        // yeni sekme - musteriyi odeme akisindan koparma
        postEvent({ type: 'click', surface: 'checkout', product_id: it.id, size: it.size || '', position: idx + 1 });
      }
    });

    var started = false;
    return {
      host: host,
      start: function () {
        if (started) return; started = true;
        if (isTop && CFG.co_timer_seconds > 0) {
          var left = CFG.co_timer_seconds;
          var el = wrap.querySelector('#ytmr');
          var t = setInterval(function () {
            left--;
            if (el) {
              el.textContent = mmss(left);
              if (left <= 30) el.classList.add('warn');
            }
            if (left <= 0) {
              clearInterval(t);
              // sure bitti -> ust blok sessizce kaybolur (musteri odemede, engel yok)
              host.__yunbiDone = true;
              host.style.display = 'none';
            }
          }, 1000);
        }
      }
    };
  }

  // Checkout icinde tema fonksiyonlari yok -> ayni-origin klasik REST + sayfa yenile
  // Checkout SPA'si global API acar: checkout_addToCart({productId: VARYANT id, quantity}) ve
  // checkout_addGiftCode(kod). Ikisi de promise DONDURMEZ -> sepet modelini yoklayarak bekleriz.
  function spaReady() { return typeof w.checkout_addToCart === 'function' && !!w.checkout_basket; }

  function cartLines() {
    try { return (w.checkout_basket && w.checkout_basket.products) || []; } catch (e) { return []; }
  }
  function cartHas(vid) {
    var ps = cartLines();
    for (var i = 0; i < ps.length; i++) if (parseInt(ps[i].productId, 10) === vid) return true;
    return false;
  }
  function cartTotal() {
    var ps = cartLines(), t = 0;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i] || {};
      var u = parseFloat(p.basketPriceWithVat || p.salePriceWithVat || p.basketPrice || 0) || 0;
      t += u * (parseInt(p.quantity, 10) || 1);
    }
    if (!t) { try { t = parseFloat(w.checkout_basket.orderTotalPrice) || 0; } catch (e) { } }
    return Math.round(t * 100) / 100;
  }
  function giftVoucher() {
    try {
      var pi = w.checkout_basket && w.checkout_basket.paymentInformation;
      if (typeof pi === 'string') pi = JSON.parse(pi);
      return pi && pi.giftVoucher ? pi.giftVoucher : null;
    } catch (e) { return null; }
  }
  function waitFor(test, ms, cb) {
    var t0 = Date.now();
    (function tick() {
      var v = null;
      try { v = test(); } catch (e) { }
      if (v) return cb(v);
      if (Date.now() - t0 > ms) return cb(null);
      setTimeout(tick, 250);
    })();
  }

  // SPA ile ekle (yenileme yok); SPA yoksa REST + yenileme
  function spaAdd(it, cb) {
    var vid = parseInt(it.variant_id, 10) || 0;
    if (!vid) return cb(false);
    if (spaReady()) {
      if (cartHas(vid)) return cb(true);
      try { w.checkout_addToCart({ productId: vid, quantity: 1 }); } catch (e) { return cb(false); }
      return waitFor(function () { return cartHas(vid); }, 10000, function (ok) { cb(!!ok); });
    }
    cb(null); // SPA yok
  }
  function spaApplyCode(code, cb) {
    if (typeof w.checkout_addGiftCode !== 'function') return cb(null);
    try { w.checkout_addGiftCode(code); } catch (e) { return cb(false); }
    waitFor(function () { var g = giftVoucher(); return g && String(g.voucher || g.code || '').toUpperCase() === String(code).toUpperCase() ? g : null; }, 10000, function (g) { cb(!!g); });
  }
  function restAdd(it, cb) {
    var vid = parseInt(it.variant_id, 10) || 0;
    var pid = parseInt(it.pid, 10) || 0;
    fetch('/api/cart/AddToCartV3', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        AsortiUrunKartId: 0, KampanyaId: 0, BagliUrunId: 0,
        UrunKartId: pid, UrunId: vid, Adet: 1,
        UrunNot: '', AssortmentQuantities: []
      })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { cb(!!(j && !j.isError)); })
      .catch(function () { cb(false); });
  }

  function checkoutAddToCart(it, btn) {
    var vid = parseInt(it.variant_id, 10) || 0;
    if (!vid) { w.open(it.url, '_blank'); btn.classList.remove('busy'); return; }
    spaAdd(it, function (ok) {
      if (ok === true) {
        btn.classList.remove('busy'); btn.classList.add('ok');
        btn.innerHTML = ICON_CHECK + 'Eklendi';
        return;
      }
      if (ok === false) { btn.classList.remove('busy'); w.open(it.url, '_blank'); return; }
      restAdd(it, function (done) {
        btn.classList.remove('busy');
        if (!done) { w.open(it.url, '_blank'); return; }
        btn.classList.add('ok');
        btn.innerHTML = ICON_CHECK + 'Eklendi';
        // SPA sepeti kendi store'undan cizer -> yenile ki yeni urun gorunsun
        setTimeout(function () { w.location.reload(); }, 900);
      });
    });
  }

  /* ============================================================
   * 'Sana Ozel Teklif' - checkout ust blok (tek urun + kalici sayac + kupon)
   * ============================================================ */
  function cartSig() {
    var ps = cartLines(), a = [];
    for (var i = 0; i < ps.length; i++) a.push((ps[i].productId || ps[i].cardId || '') + 'x' + (ps[i].quantity || 1));
    return a.sort().join(',');
  }
  // Sayac sepet imzasina bagli baslar; yenileme/yeniden render sifirlamaz (durust geri sayim)
  function offerStart(total) {
    var key = 'yunbi_rec_offer_t0', sig = cartSig(), t0 = 0;
    try {
      var st = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (st && st.sig === sig && st.t0) t0 = st.t0;
      if (!t0) { t0 = Date.now(); sessionStorage.setItem(key, JSON.stringify({ sig: sig, t0: t0 })); }
    } catch (e) { t0 = Date.now(); }
    return Math.floor(total - (Date.now() - t0) / 1000);
  }

  function buildOfferBlock(items) {
    var accent = CFG.accent || '#111111', highlight = CFG.highlight || '#e11d48';
    var O = CFG.offer || {};
    var hero = items[0];
    var alts = items.slice(1);
    var timerTotal = CFG.co_timer_seconds > 0 ? CFG.co_timer_seconds : 0;
    var left = timerTotal > 0 ? offerStart(timerTotal) : 0;

    var host = d.createElement('div');
    host.className = 'yunbi-rec-inline';
    host.setAttribute('data-kind', 'top');
    host.style.cssText = 'display:block!important;width:100%!important;max-width:100%!important;margin:10px 0!important;position:static!important;float:none!important;clear:both!important;';
    // sure zaten dolmus -> ust blok hic cizilmez (alt grid kalir)
    if (timerTotal > 0 && left <= 0) { host.__yunbiDone = true; host.style.display = 'none'; return { host: host, start: function () { } }; }

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = d.createElement('style');
    style.textContent = inlineCss(accent, highlight) + offerCss(accent, highlight);
    root.appendChild(style);
    var wrap = d.createElement('div');
    wrap.className = 'blk top ofr';
    root.appendChild(wrap);

    var coupon = HERO && HERO.mode === 'coupon' && HERO.amount > 0;
    var unit = hero.discounted != null ? hero.discounted : hero.price;
    var priceHtml;
    if (coupon) {
      priceHtml = '<span class="po">' + fmtPrice(unit) + '</span><span class="pn">' + fmtPrice(HERO.price_after) + '</span>' +
        '<span class="opc">-%' + HERO.percent + ' sana \u00f6zel</span>';
    } else {
      var pct = hero.discounted != null ? Math.round((1 - hero.discounted / hero.price) * 100) : 0;
      priceHtml = (hero.discounted != null ? '<span class="po">' + fmtPrice(hero.price) + '</span><span class="pn">' + fmtPrice(hero.discounted) + '</span>' : '<span class="pn nod">' + fmtPrice(hero.price) + '</span>') +
        (pct > 0 ? '<span class="opc">-%' + pct + '</span>' : '');
    }
    var chips = '';
    if (hero.size) chips += '<span class="och">' + esc(hero.size) + (/^\d+$/.test(hero.size) ? ' numara' : '') + '</span>';
    if (hero.low_stock) chips += '<span class="och warn">Son ' + hero.low_stock + ' adet</span>';
    if (!coupon && CFG.co_badge) chips += '<span class="och camp">' + esc(CFG.co_badge) + '</span>';

    var altHtml = '';
    if (alts.length) {
      altHtml = '<div class="oalt"><div class="oal">Ya da bunlardan biri</div><div class="row scrollx">' +
        alts.map(function (it, i) {
          var disc = it.discounted != null;
          var p2 = disc ? Math.round((1 - it.discounted / it.price) * 100) : 0;
          return '<div class="cd" data-i="' + (i + 1) + '">' +
            '<a class="im" data-go="1" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
              (it.image ? '<img loading="lazy" src="' + esc(it.image) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(String(it.image).replace('/thumb/', '/buyuk/')) + '\'">' : '') +
              (p2 > 0 ? '<span class="dc">-%' + p2 + '</span>' : '') +
              (it.size ? '<span class="szc">' + esc(it.size) + '</span>' : '') +
            '</a>' +
            '<div class="inf">' +
              '<a class="nm" data-go="1" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a>' +
              '<div class="pr">' + (disc ? '<span class="po">' + fmtPrice(it.price) + '</span><span class="pn">' + fmtPrice(it.discounted) + '</span>' : '<span class="pn nod">' + fmtPrice(it.price) + '</span>') + '</div>' +
              '<button class="bt" data-add="1">' + ICON_CART + esc(CFG.co_cta || 'Sepete Ekle') + '</button>' +
            '</div></div>';
        }).join('') + '</div></div>';
    }

    wrap.innerHTML =
      '<div class="oh">' +
        '<span class="bdg">' + ICON_SPARK + esc(O.title || 'Sana \u00f6zel teklif') + '</span>' +
        (timerTotal > 0 ? '<span class="tmr" id="ytmr">' + mmss(left) + '</span>' : '') +
      '</div>' +
      '<div class="ob cd" data-i="0">' +
        '<a class="oim" data-go="1" href="' + esc(hero.url) + '" target="_blank" rel="noopener">' +
          (hero.image ? '<img loading="lazy" src="' + esc(hero.image) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(String(hero.image).replace('/thumb/', '/buyuk/')) + '\'">' : '') +
        '</a>' +
        '<div class="oi">' +
          (O.text ? '<div class="ot">' + esc(O.text) + '</div>' : '') +
          '<a class="onm" data-go="1" href="' + esc(hero.url) + '" target="_blank" rel="noopener">' + esc(hero.name) + '</a>' +
          '<div class="opr">' + priceHtml + '</div>' +
          (chips ? '<div class="ochips">' + chips + '</div>' : '') +
          '<button class="bt obt" data-add="1">' + ICON_CART + esc(O.cta || 'Teklifi kullan, sepete ekle') + '</button>' +
          '<div class="omsg" id="yomsg"></div>' +
        '</div>' +
      '</div>' + altHtml;

    var msg = wrap.querySelector('#yomsg');
    function say(html, cls) { if (msg) { msg.innerHTML = html; msg.className = 'omsg ' + (cls || ''); } }

    function claimAndAdd(it, btn) {
      var rem = timerTotal > 0 ? left : 0;
      var payload = { product_id: it.id, variant_id: it.variant_id || '', total: cartTotal(), remaining: rem, sid: sid() };
      var m = memberId(); if (m) payload.member = m;
      var finishAdd = function (code, amount) {
        spaAdd(it, function (ok) {
          if (ok === null) {
            // SPA API yok (demo / eski tema): REST + yenileme; kod yenileme sonrasi uygulanir
            if (code) { try { sessionStorage.setItem('yunbi_rec_pending_code', code); } catch (e) { } }
            restAdd(it, function (done) {
              btn.classList.remove('busy');
              if (!done) { w.open(it.url, '_blank'); return; }
              btn.classList.add('ok'); btn.innerHTML = ICON_CHECK + 'Eklendi';
              setTimeout(function () { w.location.reload(); }, 900);
            });
            return;
          }
          if (!ok) { btn.classList.remove('busy'); say('Eklenemedi, \u00fcr\u00fcn sayfas\u0131 a\u00e7\u0131l\u0131yor', 'err'); w.open(it.url, '_blank'); return; }
          if (!code) {
            btn.classList.remove('busy'); btn.classList.add('ok'); btn.innerHTML = ICON_CHECK + 'Sepete eklendi';
            return;
          }
          say('Kupon uygulan\u0131yor\u2026', '');
          spaApplyCode(code, function (applied) {
            btn.classList.remove('busy'); btn.classList.add('ok');
            if (applied) {
              btn.innerHTML = ICON_CHECK + esc(O.applied || 'Teklif uyguland\u0131') + (amount ? ' \u00b7 -' + fmtPrice(amount) : '');
              say('Kod <b>' + esc(code) + '</b> sepetine tan\u0131mland\u0131, toplam g\u00fcncellendi.', 'ok');
            } else {
              btn.innerHTML = ICON_CHECK + 'Sepete eklendi';
              say('Kupon kodun: <b class="ocode">' + esc(code) + '</b> <button class="ocp" data-copy="' + esc(code) + '">Kopyala</button><br>Hediye \u00c7eki Kullan alan\u0131na yap\u0131\u015ft\u0131r' + (amount ? ' (-' + fmtPrice(amount) + ')' : '') + '.', 'warn');
            }
          });
        });
      };
      if (!coupon) return finishAdd(null, 0);
      var body = new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=UTF-8' });
      fetch(BASE + '/claim', { method: 'POST', mode: 'cors', body: body })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          if (res && res.ok && res.mode === 'coupon' && res.code) return finishAdd(res.code, res.amount || HERO.amount);
          finishAdd(null, 0); // kupon acilamadi -> yine de ekle
        })
        .catch(function () { finishAdd(null, 0); });
    }

    wrap.addEventListener('click', function (ev) {
      var cp = closestAttr(ev.target, 'data-copy', wrap);
      if (cp) { try { navigator.clipboard.writeText(cp.getAttribute('data-copy')); cp.textContent = 'Kopyaland\u0131'; } catch (e) { } return; }
      var addEl = closestAttr(ev.target, 'data-add', wrap);
      var goEl = closestAttr(ev.target, 'data-go', wrap);
      var cd = closestClass(ev.target, 'cd', wrap);
      if (!cd) return;
      var idx = parseInt(cd.getAttribute('data-i'), 10);
      var it = items[idx];
      if (!it) return;
      if (addEl) {
        ev.preventDefault();
        if (addEl.classList.contains('ok') || addEl.classList.contains('busy')) return;
        addEl.classList.add('busy');
        postEvent({ type: 'atc', surface: 'checkout', product_id: it.id, size: it.size || '', position: idx + 1 });
        if (idx === 0) claimAndAdd(it, addEl); else checkoutAddToCart(it, addEl);
        return;
      }
      if (goEl) postEvent({ type: 'click', surface: 'checkout', product_id: it.id, size: it.size || '', position: idx + 1 });
    });

    var started = false;
    return {
      host: host,
      start: function () {
        if (started) return; started = true;
        if (timerTotal <= 0) return;
        var el = wrap.querySelector('#ytmr');
        var t = setInterval(function () {
          left--;
          if (el) { el.textContent = mmss(Math.max(0, left)); if (left <= 30) el.classList.add('warn'); }
          if (left <= 0) {
            clearInterval(t);
            // teklif kullanildiysa blok kalsin (basari mesaji), kullanilmadiysa sessizce kaybolsun
            var ok = wrap.querySelector('.obt.ok');
            if (!ok) { host.__yunbiDone = true; host.style.display = 'none'; }
            else if (el) { el.textContent = 'Kullan\u0131ld\u0131'; el.classList.remove('warn'); }
          }
        }, 1000);
      }
    };
  }

  // REST + yenileme yolunda kod yenileme sonrasi uygulanir
  function applyPendingCode() {
    var code = '';
    try { code = sessionStorage.getItem('yunbi_rec_pending_code') || ''; } catch (e) { }
    if (!code) return;
    waitFor(function () { return typeof w.checkout_addGiftCode === 'function' && w.checkout_basket && cartLines().length ? 1 : null; }, 20000, function (ready) {
      if (!ready) return;
      try { sessionStorage.removeItem('yunbi_rec_pending_code'); } catch (e) { }
      spaApplyCode(code, function () { });
    });
  }

  function offerCss(accent, highlight) {
    return '' +
'.ofr{padding:12px 14px 14px}' +
'.oh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}' +
'.oh .bdg{font-size:12px;padding:5px 11px}' +
'.oh .tmr{font-size:12.5px;padding:5px 11px;margin-left:auto}' +
'.ob{display:flex;gap:14px;align-items:stretch;border:0!important;border-radius:0!important;overflow:visible!important;flex-direction:row!important}' +
'.oim{flex:0 0 118px;width:118px;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:#f6f6f8;display:block}' +
'@media(min-width:760px){.oim{flex-basis:140px;width:140px}}' +
'.oim img{width:100%;height:100%;object-fit:cover;display:block}' +
'.oi{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}' +
'.ot{font-size:12px;color:#6b6b74;line-height:1.35}' +
'.onm{font-size:14px;line-height:1.3;color:#141418;font-weight:700;text-decoration:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
'.opr{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
'.opr .po{font-size:12.5px}.opr .pn{font-size:18px}' +
'.opc{display:inline-block;background:' + highlight + '14;color:' + highlight + ';border:1px solid ' + highlight + '33;font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;align-self:center}' +
'.ochips{display:flex;gap:6px;flex-wrap:wrap}' +
'.och{display:inline-block;background:#f2f2f5;color:#26262c;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px}' +
'.och.warn{background:#17171c;color:#fff}' +
'.och.camp{background:' + highlight + ';color:#fff}' +
'.obt{margin-top:auto;font-size:13px;padding:11px 12px;border-radius:10px;width:100%;max-width:360px}' +
'.obt.ok{background:#189a55}' +
'.omsg{font-size:11.5px;line-height:1.4;color:#6b6b74}.omsg:empty{display:none}' +
'.omsg.ok{color:#189a55}.omsg.warn{color:#8a5a00}.omsg.err{color:' + highlight + '}' +
'.ocode{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#141418;letter-spacing:.5px}' +
'.ocp{border:1px solid #d9d9df;background:#fff;border-radius:6px;font-size:11px;padding:2px 7px;cursor:pointer;margin-left:4px;color:#26262c}' +
'.oalt{margin-top:12px;padding-top:10px;border-top:1px dashed #e6e6ec}' +
'.oal{font-size:11.5px;font-weight:700;color:#6b6b74;margin-bottom:8px;text-transform:uppercase;letter-spacing:.3px}';
  }

  function inlineCss(accent, highlight) {
    return '' +
':host{all:initial}*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
'.blk{background:#fff;border:1px solid #ececf0;border-radius:14px;padding:12px 14px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
'.blk.top{border-color:' + highlight + '33;background:linear-gradient(180deg,#fff 0%,#fff 60%,#fafafb 100%)}' +
'.hd{margin-bottom:10px}' +
'.rowb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}' +
'.rowb:empty{display:none}' +
'.bdg{display:inline-flex;align-items:center;gap:5px;background:' + highlight + ';color:#fff;font-size:11px;font-weight:700;letter-spacing:.2px;padding:4px 9px;border-radius:999px}' +
'.bdg svg{width:12px;height:12px}' +
'.tmr{display:inline-flex;align-items:center;background:#17171c;color:#fff;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:999px;font-variant-numeric:tabular-nums}' +
'.tmr.warn{background:' + highlight + ';animation:yb-pulse 1s infinite}' +
'@keyframes yb-pulse{50%{opacity:.75}}' +
'.tt{font-size:15px;font-weight:800;color:#141418;line-height:1.3}' +
'.st{font-size:12px;color:#6b6b74;margin-top:2px}' +
'.row.scrollx{display:flex;gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:thin}' +
'.row.scrollx .cd{flex:0 0 128px}' +
'.row.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}' +
'.cd{border:1px solid #ececf0;border-radius:12px;overflow:hidden;background:#fff;display:flex;flex-direction:column}' +
'.im{position:relative;display:block;width:100%;aspect-ratio:2/3;background:#f6f6f8;text-decoration:none}' +
'.im img{width:100%;height:100%;object-fit:cover;display:block}' +
'.dc{position:absolute;top:6px;left:6px;background:' + highlight + ';color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px}' +
'.szc{position:absolute;top:6px;right:6px;background:rgba(255,255,255,.92);color:#26262c;font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.15)}' +
'.ls{position:absolute;bottom:6px;left:6px;background:rgba(20,20,25,.82);color:#fff;font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:6px}' +
'.inf{padding:7px 8px 9px;display:flex;flex-direction:column;gap:5px;flex:1 1 auto}' +
'.nm{font-size:11px;line-height:1.3;color:#232329;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em;text-decoration:none}' +
'.pr{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}' +
'.po{font-size:10.5px;color:#9a9aa2;text-decoration:line-through}' +
'.pn{font-size:12.5px;font-weight:800;color:' + highlight + '}' +
'.pn.nod{color:#141418}' +
'.bt{margin-top:auto;border:0;border-radius:8px;background:' + accent + ';color:#fff;font-size:11px;font-weight:700;padding:8px 6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:opacity .12s ease}' +
'.bt:hover{opacity:.92}' +
'.bt.busy{opacity:.6;cursor:wait}' +
'.bt.ok{background:#189a55;cursor:default}' +
'.bt svg{width:12px;height:12px}';
  }

  /* ---------- shared UI (surface 1 sheet) ---------- */
  function fmtPrice(v) {
    try {
      return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ba';
    } catch (e) { return v + ' \u20ba'; }
  }

  function sheetCss(accent, highlight) {
    return '' +
':host{all:initial}*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
'.ov{position:fixed;inset:0;background:rgba(15,15,20,.55);backdrop-filter:blur(2px);z-index:2147483000;opacity:0;transition:opacity .25s ease}' +
'.ov.on{opacity:1}' +
'.sh{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -12px 48px rgba(0,0,0,.28);transform:translateY(105%);transition:transform .32s cubic-bezier(.22,.9,.3,1);max-height:86vh;display:flex;flex-direction:column}' +
'.sh.on{transform:translateY(0)}' +
'@media(min-width:760px){.sh{left:50%;right:auto;bottom:auto;top:50%;width:720px;max-width:94vw;border-radius:20px;transform:translate(-50%,-46%);opacity:0;transition:opacity .28s ease,transform .28s ease;max-height:88vh}.sh.on{transform:translate(-50%,-50%);opacity:1}}' +
'@media(prefers-reduced-motion:reduce){.ov,.sh{transition:none}}' +
'.grab{width:44px;height:5px;border-radius:3px;background:#e2e2e6;margin:10px auto 0;flex:0 0 auto}' +
'@media(min-width:760px){.grab{display:none}}' +
'.hd{padding:14px 20px 10px;flex:0 0 auto;position:relative}' +
'.x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:50%;background:#f2f2f5;color:#555;font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
'.x:hover{background:#e8e8ec}' +
'.rowb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding-right:40px}' +
'.bdg{display:inline-flex;align-items:center;gap:6px;background:' + highlight + ';color:#fff;font-size:12px;font-weight:700;letter-spacing:.2px;padding:5px 11px;border-radius:999px}' +
'.bdg svg{width:13px;height:13px}' +
'.tmr{display:inline-flex;align-items:center;gap:6px;background:#17171c;color:#fff;font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:999px;font-variant-numeric:tabular-nums}' +
'.tmr.warn{background:' + highlight + ';animation:yb-pulse 1s infinite}' +
'@keyframes yb-pulse{50%{opacity:.75}}' +
'.tt{font-size:18px;font-weight:800;color:#141418;line-height:1.25}' +
'.st{font-size:13px;color:#6b6b74;margin-top:3px}' +
'.szch{display:inline-block;background:#f2f2f5;color:#26262c;border-radius:6px;font-size:11.5px;font-weight:700;padding:2px 7px;margin-left:6px;vertical-align:2px}' +
'.bo{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px 18px;flex:1 1 auto}' +
'.gr{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}' +
'@media(min-width:760px){.gr{grid-template-columns:repeat(4,1fr);gap:12px}}' +
'.cd{border:1px solid #ececf0;border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column;position:relative}' +
'.im{position:relative;display:block;width:100%;aspect-ratio:2/3;background:#f6f6f8;cursor:pointer;border:0;padding:0}' +
'.im img{width:100%;height:100%;object-fit:cover;display:block}' +
'.dc{position:absolute;top:8px;left:8px;background:' + highlight + ';color:#fff;font-size:11px;font-weight:800;padding:3px 7px;border-radius:7px}' +
'.ls{position:absolute;bottom:8px;left:8px;background:rgba(20,20,25,.82);color:#fff;font-size:10.5px;font-weight:700;padding:3px 7px;border-radius:7px}' +
'.inf{padding:9px 10px 10px;display:flex;flex-direction:column;gap:6px;flex:1 1 auto}' +
'.nm{font-size:12.5px;line-height:1.35;color:#232329;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em;cursor:pointer}' +
'.pr{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}' +
'.po{font-size:12px;color:#9a9aa2;text-decoration:line-through}' +
'.pn{font-size:15px;font-weight:800;color:' + highlight + '}' +
'.pn.nod{color:#141418}' +
'.bt{margin-top:auto;border:0;border-radius:10px;background:' + accent + ';color:#fff;font-size:13px;font-weight:700;padding:10px 8px;cursor:pointer;transition:transform .12s ease,opacity .12s ease;display:flex;align-items:center;justify-content:center;gap:6px}' +
'.bt:hover{opacity:.92}.bt:active{transform:scale(.97)}' +
'.bt.ok{background:#189a55;cursor:default}' +
'.bt svg{width:14px;height:14px}' +
'.ft{padding:0 20px 14px;flex:0 0 auto;text-align:center}' +
'.ftl{font-size:11px;color:#b0b0b8}';
  }

  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.7L20 9l-5.2 3.1L16 18l-4-3.4L8 18l1.2-5.9L4 9l6.1-1.3L12 2z"/></svg>';
  var ICON_CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.6"/><circle cx="19" cy="21" r="1.6"/><path d="M2.5 3h3l2.6 12.5a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.6L22 7H6.2"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  function renderSheet(items, opts) {
    if (open) return;
    open = true;

    var host = d.createElement('div');
    host.id = 'yunbi-cart-rec';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    d.body.appendChild(host);

    var style = d.createElement('style');
    style.textContent = sheetCss(CFG.accent || '#111111', CFG.highlight || '#e11d48');
    root.appendChild(style);

    var ov = d.createElement('div'); ov.className = 'ov'; root.appendChild(ov);
    var sh = d.createElement('div'); sh.className = 'sh'; root.appendChild(sh);

    var sizeChip = opts.sizeLabel
      ? '<span class="szch">' + esc(opts.sizeLabel) + (/^\d+$/.test(opts.sizeLabel) ? ' numara' : '') + '</span>'
      : '';
    var badge = opts.badge ? '<span class="bdg">' + ICON_SPARK + esc(opts.badge) + '</span>' : '';
    var timer = (opts.timer > 0) ? '<span class="tmr" id="ytmr">' + mmss(opts.timer) + '</span>' : '';

    var cards = items.map(function (it, i) {
      var disc = it.discounted != null;
      var pct = disc ? Math.round((1 - it.discounted / it.price) * 100) : 0;
      return '<div class="cd" data-i="' + i + '">' +
        '<button class="im" data-go="1">' +
          (it.image ? '<img loading="lazy" src="' + esc(it.image) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(String(it.image).replace('/thumb/', '/buyuk/')) + '\'">' : '') +
          (pct > 0 ? '<span class="dc">-%' + pct + '</span>' : '') +
          (it.low_stock ? '<span class="ls">Son ' + it.low_stock + ' adet</span>' : '') +
        '</button>' +
        '<div class="inf">' +
          '<div class="nm" data-go="1">' + esc(it.name) + '</div>' +
          '<div class="pr">' + (disc ? '<span class="po">' + fmtPrice(it.price) + '</span><span class="pn">' + fmtPrice(it.discounted) + '</span>' : '<span class="pn nod">' + fmtPrice(it.price) + '</span>') + '</div>' +
          '<button class="bt" data-add="1">' + ICON_CART + esc(opts.cta || 'Sepete Ekle') + '</button>' +
        '</div></div>';
    }).join('');

    sh.innerHTML =
      '<div class="grab"></div>' +
      '<div class="hd">' +
        '<button class="x" aria-label="Kapat">&#10005;</button>' +
        '<div class="rowb">' + badge + timer + '</div>' +
        '<div class="tt">' + esc(opts.title || '') + sizeChip + '</div>' +
        '<div class="st">' + esc(opts.subtitle || '') + '</div>' +
      '</div>' +
      '<div class="bo"><div class="gr">' + cards + '</div></div>' +
      '<div class="ft"><span class="ftl">' + (opts.personalized ? 'Ge\u00e7mi\u015f al\u0131\u015fveri\u015flerine g\u00f6re se\u00e7ildi' : 'Ger\u00e7ek sat\u0131\u015f verisine g\u00f6re se\u00e7ildi') + '</span></div>';

    requestAnimationFrame(function () { ov.classList.add('on'); sh.classList.add('on'); });

    function close() {
      ov.classList.remove('on'); sh.classList.remove('on');
      if (timerInt) { clearInterval(timerInt); timerInt = null; }
      setTimeout(function () { host.remove(); open = false; }, 300);
    }
    ov.addEventListener('click', close);
    sh.querySelector('.x').addEventListener('click', close);

    if (opts.timer > 0) {
      var left = opts.timer;
      var el = sh.querySelector('#ytmr');
      timerInt = setInterval(function () {
        left--;
        if (el) {
          el.textContent = mmss(left);
          if (left <= 30) el.classList.add('warn');
        }
        if (left <= 0) close();
      }, 1000);
    }

    sh.querySelector('.gr').addEventListener('click', function (ev) {
      var goEl = closestAttr(ev.target, 'data-go', sh);
      var addEl = closestAttr(ev.target, 'data-add', sh);
      var cd = closestClass(ev.target, 'cd', sh);
      if (!cd) return;
      var idx = parseInt(cd.getAttribute('data-i'), 10);
      var it = items[idx];
      if (!it) return;

      if (addEl) {
        if (addEl.classList.contains('ok')) return;
        postEvent({ type: 'atc', surface: 'atc', product_id: it.id, source_id: opts.sourceId, size: it.size || '', position: idx + 1 });
        themeAddToCart(it, addEl);
        return;
      }
      if (goEl) {
        postEvent({ type: 'click', surface: 'atc', product_id: it.id, source_id: opts.sourceId, size: it.size || '', position: idx + 1 });
        setTimeout(function () { w.location.href = it.url; }, 60);
      }
    });
  }

  function themeAddToCart(it, btn) {
    var vid = parseInt(it.variant_id, 10) || 0;
    var done = function () {
      btn.classList.add('ok');
      btn.innerHTML = ICON_CHECK + 'Sepete eklendi';
    };
    if (typeof w.sepeteEkle === 'function' && vid) {
      selfAdd = true;
      try {
        // sepeteEkle(variantId, qty, campaignId, campaignConnProdId, assortmentId, note, popup, cb, formId, notify, ?, productId)
        w.sepeteEkle(vid, 1, 0, 0, 0, '', false, function () { done(); }, undefined, false, undefined, parseInt(it.pid, 10) || 0);
      } catch (e) { }
      setTimeout(function () { selfAdd = false; done(); }, 1200);
      return;
    }
    postEvent({ type: 'click', surface: 'atc', product_id: it.id, source_id: null, size: it.size || '' });
    w.location.href = it.url;
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mmss(s) {
    if (s < 0) s = 0;
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function closestAttr(el, attr, stop) {
    while (el && el !== stop) { if (el.getAttribute && el.getAttribute(attr)) return el; el = el.parentNode; }
    return null;
  }
  function closestClass(el, cls, stop) {
    while (el && el !== stop) { if (el.classList && el.classList.contains(cls)) return el; el = el.parentNode; }
    return null;
  }

  /* ---------- manual triggers for demo pages ---------- */
  w.__yunbiCartRecTrigger = function (productId, variantId) { onAdded(variantId || 0, productId || 0); };
  w.__yunbiCartRecCheckoutDemo = function (lines) {
    if (!CFG || !CFG.enabled) return;
    var qs = 'items=' + encodeURIComponent((lines || []).map(function (l) { return l.p + ':' + (l.v || 0) + ':' + (l.q || 1) + ':' + (l.b || ''); }).join(','));
    fetch(BASE + '/checkout-offer?' + qs, { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.items || !res.items.length) return;
        HERO = res.hero || null;
        mountCheckoutBlocks(res);
        postEvent({ type: 'impression', surface: 'checkout', size: (res.sizes || []).join('/'), products: res.items.map(function (it, i) { return { id: it.id, pos: i + 1 }; }) });
      });
  };

  /* ---------- boot ---------- */
  function boot() {
    fetch(BASE + '/config', { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.enabled) return;
        CFG = cfg;
        if (IS_CHECKOUT) {
          if (cfg.checkout_enabled) { initCheckoutInline(); applyPendingCode(); }
          return; // checkout sayfasinda tema hook'lari yok
        }
        if (!hookAjax()) {
          var tries = 20;
          var iv = setInterval(function () { if (hookAjax() || --tries <= 0) clearInterval(iv); }, 500);
        }
        hookSepeteEkle(24);
      })
      .catch(function () { });
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
