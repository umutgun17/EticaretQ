/*!
 * Yunbi "Bugün Kargoda" widget'ı — kargo cutoff geri sayacı (Trendyol tarzı), bağımsız (no deps).
 *
 *   <script src="https://eticaretq.com/widget/shipping.js?v=1"
 *           data-tenant="tonnyblack" async crossorigin="anonymous"></script>
 *
 * TEK async script — host sitede RENDER-BLOCKING kaynak YOK, CSS shadow DOM içinde gömülü.
 * Sunucu çökse bile host site etkilenmez; widget sessizce görünmez. (Embed koduna SRI
 * KOYMUYORUZ — deploy'da hash uyuşmazlığı widget'ı sessizce öldürür, çark dersi.)
 *
 * Dürüst aciliyet: saat SUNUCUDAN gelir (client saati yanlış olsa da drift düzeltilir),
 * cutoff ve kargo günleri tenant panelinden yönetilir. Europe/Istanbul sabit UTC+3 (DST yok).
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var TENANT = script.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiShippingLoaded) return; // çifte gömme koruması
  window.__yunbiShippingLoaded = true;

  var SRC = new URL(script.src);
  var BASE = SRC.origin;
  var API = BASE + '/w/' + encodeURIComponent(TENANT) + '/shipping/config';

  var TR_OFFSET = 3 * 3600000; // Europe/Istanbul: sabit UTC+3, DST yok
  var DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']; // ISO 1-7

  // Ürün detayda beden/varyasyon ile sepet butonu ARASI: satın alma bloğunun hemen önü.
  // "before:SEL" = elementin önüne, "after:SEL" (veya çıplak SEL) = arkasına eklenir.
  // Ticimax varsayılanları; panelden (shipping_widget_selector) özelleştirilebilir.
  var DEFAULT_TARGETS = ['before:.product-detail-page-buy-box', 'before:#divSatinAl', 'before:.buybutton', 'after:#pnlFiyatlar', 'after:.urunDetayFiyatContainer', 'after:#fiyat'];

  var cfg = null;
  var schedule = [];      // [{d: ISO gün 1-7, h, m, prev}] — her kargo gününün kesim anı
  var drift = 0;          // sunucu saati - client saati (ms)
  var host = null, box = null, timeEl = null;
  var curKey = '';        // render edilen durumun anahtarı (durum değişince tam re-render)

  function trNowMs() { return Date.now() + drift + TR_OFFSET; }
  function isoDay(d) { var w = d.getUTCDay(); return w === 0 ? 7 : w; }

  /**
   * Gün-bazlı kesim takvimi: her KARGO gününün kendi kesim saati vardır ve kesim önceki
   * güne düşebilir (prev — ör. "Cmt kargosu için Cuma 23:59'a kadar sipariş"). Sunucu
   * schedule alanını verir; vermezse (bayat config) eski days+cutoff'tan türetilir.
   */
  function buildSchedule() {
    var i, out = [];
    if (cfg.schedule && cfg.schedule.length) {
      for (i = 0; i < cfg.schedule.length; i++) {
        var e = cfg.schedule[i], p = String(e.t || '').split(':');
        if (e.d >= 1 && e.d <= 7 && p.length === 2) out.push({ d: e.d, h: +p[0], m: +p[1], prev: !!e.prev });
      }
    } else if (cfg.days && cfg.cutoff) {
      var c = cfg.cutoff.split(':');
      for (i = 0; i < cfg.days.length; i++) out.push({ d: cfg.days[i], h: +c[0], m: +c[1], prev: false });
    }
    return out;
  }

  /**
   * Bir sonraki geçerli sipariş penceresi: kesimi henüz geçmemiş İLK kargo günü.
   *   deadline: kesim anı (TR-kaydırmalı Date) — prev'li günde önceki güne düşer
   *   offset:   kargo gününün bugünden gün farkı (0=bugün kargoda, 1=yarın, …)
   *   dlToday:  kesim anı bugün gece yarısından önce mi (yarın-kargoda geri sayımı için)
   */
  function nextShip() {
    var now = new Date(trNowMs());
    var y = now.getUTCFullYear(), mo = now.getUTCMonth(), da = now.getUTCDate();
    var midnight = Date.UTC(y, mo, da + 1, 0, 0, 0);
    for (var i = 0; i < 8; i++) {
      var shipDow = isoDay(new Date(Date.UTC(y, mo, da + i)));
      for (var j = 0; j < schedule.length; j++) {
        var e = schedule[j];
        if (e.d !== shipDow) continue;
        var dl = new Date(Date.UTC(y, mo, da + i - (e.prev ? 1 : 0), e.h, e.m, 0));
        if (dl.getTime() > now.getTime()) {
          return { deadline: dl, offset: i, dlToday: dl.getTime() < midnight };
        }
      }
    }
    return null;
  }

  function fmtRemain(ms) {
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return h + ' sa ' + m + ' dk';
    if (m >= 10) return m + ' dk';
    if (m > 0) return m + ' dk ' + s + ' sn';
    return s + ' sn';
  }

  var CSS =
    ':host{display:block;max-width:100%}' +
    '.ysb{display:flex;align-items:center;gap:10px;margin:14px 0;padding:11px 14px;border-radius:10px;' +
    'font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'box-sizing:border-box;max-width:100%;text-align:left}' +
    '.ysb span{min-width:0}' +
    '.ysb b{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.ysb svg{flex:none;width:22px;height:22px}' +
    '@media (max-width:560px){.ysb{margin:12px 0;padding:10px 12px;gap:8px;font-size:12.5px;border-radius:8px}' +
    '.ysb svg{width:19px;height:19px}}' +
    '.ysb-today{background:#f0faf4;border:1px solid #b7e4c7;color:#14532d}' +
    '.ysb-urgent{background:#fff4ec;border:1px solid #fdc9a5;color:#9a3412}' +
    '.ysb-urgent svg{animation:ysbp 1.2s ease-in-out infinite}' +
    '.ysb-next{background:#f4f7fb;border:1px solid #d5e0ef;color:#1e3a5f}' +
    '@keyframes ysbp{0%,100%{transform:translateX(0)}50%{transform:translateX(3px)}}' +
    '@media (prefers-reduced-motion:reduce){.ysb-urgent svg{animation:none}}';

  var TRUCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 8h13v8H1z"/><path d="M14 11h4l3 3v2h-7z"/>' +
    '<circle cx="6" cy="18.5" r="1.7"/><circle cx="17.5" cy="18.5" r="1.7"/></svg>';

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(root) {
    var ns = nextShip();
    if (!ns) { root.innerHTML = ''; curKey = 'none'; return; }

    var remain = ns.deadline.getTime() - trNowMs();
    // Geri sayım: kargo günü bugünse HER ZAMAN; yarınsa yalnız kesim BUGÜN doluyorsa
    // (prev'li gün, ör. Cuma 23:59 → Cmt kargosu). Kesimi yarına taşan "yarın kargoda"
    // durumunda sayaç gösterilmez — gece yarısı zaten "bugün kargoda"ya döner.
    var countdown = ns.offset === 0 || (ns.offset === 1 && ns.dlToday);
    var urgent = countdown && remain <= cfg.urgent_minutes * 60000;
    var key = countdown
      ? (ns.offset === 0 ? 'today' : 'tomorrow') + (urgent ? '-urgent' : '')
      : 'next-' + ns.offset + '-' + isoDay(new Date(trNowMs() + ns.offset * 86400000));

    if (key !== curKey) {
      curKey = key;
      var cls, html;
      var when = ns.offset === 0 ? 'bugün' : ns.offset === 1 ? 'yarın'
        : cfg.later_label ? esc(cfg.later_label)
        : esc(DAY_NAMES[isoDay(new Date(trNowMs() + ns.offset * 86400000)) - 1]) + ' günü';
      if (countdown) {
        cls = urgent ? 'ysb ysb-urgent' : 'ysb ysb-today';
        html = TRUCK + '<span><b class="ysb-t"></b> içinde sipariş verirsen <b>' + when + ' kargoda!</b></span>';
      } else {
        cls = 'ysb ysb-next';
        html = TRUCK + '<span>Şimdi sipariş verirsen <b>' + when + ' kargoda!</b></span>';
      }
      root.innerHTML = '<style>' + CSS + '</style><div class="' + cls + '" role="status">' + html + '</div>';
      timeEl = root.querySelector('.ysb-t');
    }

    if (timeEl) timeEl.textContent = fmtRemain(Math.max(0, remain));
  }

  // Tema HTML'lerinde aynı id birden çok kez geçebiliyor (ör. quick-view / try-on kopyaları) —
  // ekranda GÖRÜNEN ilk eşleşmeyi al, hiçbiri görünmüyorsa ilkine düş.
  function firstVisible(sel) {
    var list;
    try { list = document.querySelectorAll(sel); } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) return list[i];
    }
    return list.length ? list[0] : null;
  }

  /** Hedefi bul ve host'u yerleştir. Tema JS'i (handlebars re-render) bölgeyi yeniden
   *  çizip rozeti silebiliyor — bu yüzden yerleştirme tekrar çağrılabilir olmalı. */
  function place() {
    var target = null, before = false;
    var candidates = cfg.selector ? [cfg.selector] : DEFAULT_TARGETS;
    for (var i = 0; i < candidates.length && !target; i++) {
      var c = candidates[i], sel = c;
      before = false;
      if (c.indexOf('before:') === 0) { before = true; sel = c.slice(7); }
      else if (c.indexOf('after:') === 0) { sel = c.slice(6); }
      target = firstVisible(sel);
    }
    if (!target || !target.parentNode) return false;
    target.parentNode.insertBefore(host, before ? target : target.nextSibling);
    return true;
  }

  function mount() {
    host = document.createElement('div');
    host.id = 'yunbi-shipping-badge';
    if (!place()) { host = null; return false; }

    var root = host;
    if (host.attachShadow) root = host.attachShadow({ mode: 'open' });
    render(root);
    setInterval(function () {
      // Bekçi: tema DOM'u yeniden çizip rozeti sildiyse aynı host'u (shadow içeriğiyle) geri tak
      // (isConnected desteklemeyen çok eski tarayıcılarda undefined → bekçi devre dışı kalır)
      if (host.isConnected === false) { if (!place()) return; }
      render(root);
    }, 1000);
    return true;
  }

  /* ── Güven barı (yalnız config.trust tanımlı tenant'ta): hızlı kargo / ücretsiz kargo / iade ── */
  var trustHost = null;
  var TRUST_ICONS = {
    fast: '<path d="M1 8h13v8H1z"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="6" cy="18.5" r="1.7"/><circle cx="17.5" cy="18.5" r="1.7"/>',
    free: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    'return': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    secure: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  };
  var TRUST_CSS =
    ':host{display:block;max-width:100%}' +
    '.ytb{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));margin:14px 0;border:1px solid #e7e5e4;border-radius:10px;background:#fafaf9;' +
    'font-family:inherit;color:#111;box-sizing:border-box;overflow:hidden}' +
    '.ytb-i{display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;padding:12px 8px;min-width:0}' +
    '.ytb-i+.ytb-i{border-left:1px solid #e7e5e4}' +
    '.ytb svg{width:24px;height:24px;flex:none}' +
    '.ytb b{font-size:12.5px;font-weight:600;line-height:1.25}' +
    '.ytb small{font-size:11.5px;line-height:1.3;color:#57534e}' +
    '@media (max-width:560px){.ytb-i{padding:10px 4px}.ytb b{font-size:11.5px}.ytb small{font-size:10.5px}.ytb svg{width:21px;height:21px}}';

  function trustTick() {
    if (!cfg || !cfg.trust || !cfg.trust.length) return;
    if (!trustHost) {
      trustHost = document.createElement('div');
      trustHost.id = 'yunbi-trust-bar';
      var r = trustHost.attachShadow ? trustHost.attachShadow({ mode: 'open' }) : trustHost;
      r.innerHTML = '<style>' + TRUST_CSS + '</style><div class="ytb" style="--n:' + cfg.trust.length + '">' + cfg.trust.map(function (it) {
        return '<div class="ytb-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TRUST_ICONS[it.k] || TRUST_ICONS.fast) + '</svg>' +
          '<b>' + esc(it.t) + '</b>' + (it.s ? '<small>' + esc(it.s) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (trustHost.isConnected !== false && trustHost.parentNode) return;
    var cands = (cfg.trust_target || 'before:.product-detail-page-easy-refund, after:.product-detail-page-buy-box').split(/\s*,\s*/);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], sel = c, before = false;
      if (c.indexOf('before:') === 0) { before = true; sel = c.slice(7); } else if (c.indexOf('after:') === 0) sel = c.slice(6);
      var t = firstVisible(sel) || (function () { try { return document.querySelector(sel); } catch (e) { return null; } })();
      if (t && t.parentNode) { t.parentNode.insertBefore(trustHost, before ? t : t.nextSibling); return; }
    }
  }
  function hideNative() {
    if (!cfg || !cfg.hide_selector || document.getElementById('yunbi-ship-hide')) return;
    var st = document.createElement('style');
    st.id = 'yunbi-ship-hide';
    st.textContent = cfg.hide_selector + '{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // ikas (Next.js) vitrini: sayfa yenilenmeden ürünler arası gezilir → sürekli bekçi:
  // rozet yoksa/silindiyse ürün sayfasında yeniden takılır, ürün dışı sayfada hiçbir şey yapmaz.
  function isIkas() { return !!(window.IkasEvents || window.__NEXT_DATA__ && document.querySelector('script[src*="myikas"], link[href*="myikas"]')); }
  function startSpa() {
    var root = null;
    setInterval(function () {
      if (!host) {
        host = document.createElement('div');
        host.id = 'yunbi-shipping-badge';
        root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
        curKey = '';
      }
      if (host.isConnected === false || !host.parentNode) {
        if (!place()) return;
        curKey = '';
      }
      render(root);
    }, 600);
    setInterval(trustTick, 600);
  }

  function start() {
    if (document.getElementById('yunbi-shipping-badge')) return;
    hideNative();
    if (isIkas()) return startSpa();
    var tries = 0;
    (function attempt() {
      if (mount()) return;
      if (++tries < 15) setTimeout(attempt, 400); // tema geç render ederse bekle; ürün sayfası değilse sessizce vazgeç
    })();
  }

  function init() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API, true);
    xhr.timeout = 8000;
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (!data || !data.enabled) return;
      cfg = data;
      schedule = buildSchedule();
      if (!schedule.length) return;
      drift = (typeof data.now === 'number' ? data.now : Date.now()) - Date.now();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
      } else {
        start();
      }
    };
    try { xhr.send(); } catch (e) {}
  }

  init();
})();
