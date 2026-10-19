/*!
 * Yunbi "Kampanya Duyuruları" widget'ı — 3'ü 1 arada, bağımsız (no deps):
 *   1) Bildirim çanı  : yüzen çan + kampanya listesi paneli (okunmamış rozeti localStorage)
 *   2) Üst bar        : sticky topbar — (a) sayaçlı: GERÇEK-deadline geri sayaç + CTA + kapat
 *                       (b) kayan maddeler: "24 saatte kargo · 1500 TL üzeri ücretsiz kargo · 3 taksit"
 *                           gibi maddeler sırayla yukarı kayarak geçer (ayrı toggle, sayaç öncelikli)
 *   3) Güven rozetleri: ürün detayda "kargo bedava / hızlı kargo / iade garantisi" şeridi
 *
 *   <script src="https://hub.yunbi.ai/widget/announce.js?v=12"
 *           data-tenant="tonnyblack" async crossorigin="anonymous"></script>
 *
 * TEK async script + TEK config isteği — host sitede render-blocking kaynak YOK, CSS shadow
 * DOM içinde gömülü. Sunucu çökse bile host site etkilenmez; widget sessizce görünmez.
 * (Embed koduna SRI KOYMUYORUZ — deploy'da hash uyuşmazlığı widget'ı sessizce öldürür, çark dersi.)
 *
 * Dürüst aciliyet: sayaç YALNIZ panelde girilen gerçek bitiş tarihiyle çalışır, saat SUNUCUDAN
 * gelir (client saati yanlışsa drift düzeltilir). Süresi geçen bar/duyuru sunucudan hiç dönmez.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var TENANT = script.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiAnnounceLoaded) return; // çifte gömme koruması
  window.__yunbiAnnounceLoaded = true;

  var SRC = new URL(script.src);
  var API = SRC.origin + '/w/' + encodeURIComponent(TENANT) + '/announce/config';

  var LS_SEEN = 'yunbi_ann_seen';       // çanda görülen duyuru id'leri (JSON dizi)
  var LS_BAR = 'yunbi_ann_bar_dismiss'; // kapatılan üst barın içerik anahtarı

  var cfg = null;
  var drift = 0; // sunucu saati - client saati (ms)

  function now() { return Date.now() + drift; }

  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  /** Basit içerik hash'i — bar metni/tarihi değişince "kapatıldı" bilgisi sıfırlansın diye. */
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtCountdown(ms) {
    if (ms < 0) ms = 0;
    var d = Math.floor(ms / 86400000);
    var h = Math.floor((ms % 86400000) / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    if (d > 0) return d + ' gün ' + pad(h) + ':' + pad(m) + ':' + pad(s);
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  /** Çan listesi için kaba kalan-süre etiketi ("Son 3 saat", "Son 2 gün"). */
  function fmtRemainRough(ms) {
    if (ms <= 0) return '';
    var d = Math.floor(ms / 86400000);
    if (d >= 1) return 'Son ' + d + ' gün';
    var h = Math.floor(ms / 3600000);
    if (h >= 1) return 'Son ' + h + ' saat';
    return 'Son ' + Math.max(1, Math.floor(ms / 60000)) + ' dakika';
  }

  // ---- SVG ikon seti (güven rozetleri + çan) ---------------------------------
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICONS = {
    truck: svg('<path d="M1 8h13v8H1z"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="6" cy="18.5" r="1.7"/><circle cx="17.5" cy="18.5" r="1.7"/>'),
    zap: svg('<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>'),
    shield: svg('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 1.9z"/>'),
    star: svg('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z"/>'),
    box: svg('<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
    check: svg('<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-6"/>'),
    card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>')
  };
  var BELL = svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>');
  var X = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

  // ---- Sabit (position:fixed) tema header'ı ile çakışma önleme -----------------
  // Ticimax "headerNew": ürün sayfalarında hep, diğer sayfalarda kaydırınca (.fixed)
  // position:fixed; top:0 oluyor. Barımız body'nin başında sticky olduğundan ikisi
  // üst üste biniyor. Çözüm: bar ekranda olduğu sürece ekranın tepesine yapışık,
  // geniş fixed elemanları bar yüksekliği kadar aşağı it (top = barH). Tema class'ı
  // sonradan ekleyip kaldırdığından (scroll) düzenli aralıkla yeniden kontrol edilir;
  // bar kapatılınca orijinal top değerleri geri yazılır.
  function keepFixedHeadersBelow(host) {
    var touched = []; // {el, prevTop, prevPri}
    function barH() { return host.isConnected ? host.offsetHeight : 0; }
    function candidates() {
      var list = [];
      try {
        var q = document.querySelectorAll('header, [id*="header" i], [class*="header" i], [class*="navbar" i], [id*="navbar" i]');
        for (var i = 0; i < q.length; i++) list.push(q[i]);
      } catch (e) {}
      return list;
    }
    function apply() {
      var h = barH();
      if (!h) { restore(); return; }
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var els = candidates();
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el === host || el.closest('#yunbi-announce-topbar')) continue;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { continue; }
        // static header'a top yazmak zararsızdır ama tema onu kaydırınca fixed'e
        // çevirdiği AN doğru yerde başlar (transition/gecikme yok) → static'e de ÖNDEN yaz.
        if (cs.position !== 'fixed' && cs.position !== 'static') continue;
        var r = el.getBoundingClientRect();
        if (r.width < vw * 0.8) continue;           // dar/yüzen parçalar (arama, sepet paneli) değil
        var already = null;
        for (var j = 0; j < touched.length; j++) if (touched[j].el === el) { already = touched[j]; break; }
        if (already) {                              // biz ittik; yükseklik değiştiyse tazele
          if (el.style.top !== h + 'px') el.style.setProperty('top', h + 'px', 'important');
          continue;
        }
        if (cs.position === 'fixed' && (r.top > 1 || r.top < -1)) continue; // tepede değil (alt bar, drawer vb.)
        if (cs.position === 'static' && r.top > h + 200) continue;          // sayfanın aşağısındaki bir "header" değil
        touched.push({ el: el, prevTop: el.style.getPropertyValue('top'), prevPri: el.style.getPropertyPriority('top') });
        el.style.setProperty('top', h + 'px', 'important');
        el.style.setProperty('transition-property', 'none', 'important'); // tema "transition:all" → top'u animasyonla kaydırmasın
      }
      // Eleman fixed/static dışına çıktıysa (relative/absolute/sticky) ya da DOM'dan düştüyse geri al
      for (var k = touched.length - 1; k >= 0; k--) {
        var t = touched[k], p = '';
        try { p = getComputedStyle(t.el).position; } catch (e) {}
        if ((p !== 'fixed' && p !== 'static') || !t.el.isConnected) { undo(t); touched.splice(k, 1); }
      }
    }
    function undo(t) {
      if (t.prevTop) t.el.style.setProperty('top', t.prevTop, t.prevPri); else t.el.style.removeProperty('top');
      t.el.style.removeProperty('transition-property');
    }
    function restore() {
      for (var i = 0; i < touched.length; i++) undo(touched[i]);
      touched = [];
      clearInterval(iv);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', apply);
    }
    var onScroll = (function () { var t = 0; return function () { if (t) return; apply(); t = setTimeout(function () { t = 0; apply(); }, 150); }; })();
    var iv = setInterval(function () { if (!host.isConnected) { restore(); return; } apply(); }, 700);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', apply);
    apply();
    setTimeout(apply, 300); setTimeout(apply, 1200); // tema JS'i header'ı geç kuruyor olabilir
    return restore;
  }

  // ============================ 1) ÜST BAR ====================================
  // Metni kaçışlayarak basar; vurgu ifadelerini renkli (linkli) haplara çevirir.
  function richText(text, hls) {
    if (!hls || !hls.length) return esc(text);
    var low = function (t) { try { return t.toLocaleLowerCase('tr'); } catch (e) { return t.toLowerCase(); } };
    var out = '', rest = String(text);
    for (var guard = 0; guard < 20 && rest; guard++) {
      var best = -1, bh = null, blen = 0;
      for (var i = 0; i < hls.length; i++) {
        var p = String(hls[i].text || ''); if (!p) continue;
        var at = rest.indexOf(p);
        if (at < 0 && low(rest).length === rest.length && low(p).length === p.length) at = low(rest).indexOf(low(p));
        if (at >= 0 && (best < 0 || at < best)) { best = at; bh = hls[i]; blen = p.length; }
      }
      if (best < 0) break;
      var c = /^#[0-9a-fA-F]{6}$/.test(bh.color || '') ? bh.color : '#f97316';
      var word = esc(rest.substr(best, blen));
      out += esc(rest.slice(0, best)) + (bh.url
        ? '<a class="hl" href="' + esc(bh.url) + '" style="background:' + c + ';--hb:' + c + '">' + word + '</a>'
        : '<span class="hl" style="background:' + c + '">' + word + '</span>');
      rest = rest.slice(best + blen);
    }
    return out + esc(rest);
  }

  function mountTopbar() {
    var tb = cfg.topbar;
    if (!tb || !tb.enabled) return;
    if (tb.kind === 'ticker') { mountTicker(tb); return; }
    if (!tb.text) return;

    var key = hash(tb.text + '|' + (tb.ends_at || '') + '|' + (tb.url || ''));
    if (tb.dismissible && lsGet(LS_BAR) === key) return;

    var host = document.createElement('div');
    host.id = 'yunbi-announce-topbar';
    // Sticky en üstte kalır; tema body'de overflow kısıtlıyorsa statike düşer (zararsız)
    host.style.cssText = 'position:sticky;top:0;z-index:2147482000;display:block;width:100%';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var css =
      ':host{display:block}' +
      '.bar{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;' +
      'padding:10px 40px 10px 14px;position:relative;box-sizing:border-box;text-align:center;overflow:hidden;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.18);' +
      'font:13.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}' +
      // Kayan parlama şeridi (sheen) — tenant rengini bozmadan hareket hissi verir
      '.bar::after{content:"";position:absolute;inset:0;pointer-events:none;' +
      'background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.16) 50%,transparent 58%);' +
      'background-size:230% 100%;animation:ysheen 5.5s linear infinite}' +
      '@keyframes ysheen{0%{background-position:125% 0}100%{background-position:-125% 0}}' +
      '.bar .fl{display:inline-flex;vertical-align:-3px;margin-right:5px;line-height:0;color:#fbbf24;' +
      'animation:yflash 2.2s ease-in-out infinite}' +
      '.bar .fl svg{width:16px;height:16px;fill:currentColor;stroke:currentColor}' +
      '@keyframes yflash{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.8}}' +
      '.bar .txt{font-weight:600;min-width:0}' +
      // Segmentli geri sayım: GÜN | SA | DK | SN kutuları
      '.cd{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}' +
      '.seg{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;' +
      'min-width:36px;padding:4px 6px 3px;border-radius:8px;background:rgba(0,0,0,.28);' +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -2px 0 rgba(0,0,0,.22)}' +
      '.seg b{font-size:15px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;display:block}' +
      '.seg b.tick{animation:ytick .28s ease-out}' +
      '@keyframes ytick{0%{transform:translateY(-45%);opacity:0}100%{transform:translateY(0);opacity:1}}' +
      '.seg i{font-style:normal;font-size:8px;font-weight:700;letter-spacing:.09em;opacity:.72;margin-top:2px}' +
      '.sep{font-weight:800;opacity:.55;animation:yblink 1s steps(1) infinite;margin:0 -1px;padding-bottom:9px}' +
      '@keyframes yblink{50%{opacity:.12}}' +
      // Son 1 saat: kutular kırmızıya döner ve nabız atar (gerçek deadline, sahte aciliyet değil)
      '.cd.urgent .seg{background:#dc2626;animation:ypulse 1.2s ease-in-out infinite}' +
      '@keyframes ypulse{50%{transform:scale(1.06)}}' +
      '.bar a{color:inherit;font-weight:700;text-decoration:none;white-space:nowrap;' +
      'background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;' +
      'padding:4px 14px;transition:background .15s}' +
      '.bar a:hover{background:rgba(255,255,255,.3)}' +
      // Metin içi vurgu (ör. "%50 İndirim", "1 Alana 1 Bedava"): renkli hap, linkliyse ilgili sayfaya gider
      '.bar .hl,.bar a.hl{display:inline-block;color:#fff;font-weight:800;border:0;border-radius:6px;' +
      'padding:1px 8px;margin:0 1px;line-height:1.45;white-space:nowrap;text-decoration:none;' +
      'box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 2px 6px rgba(0,0,0,.25);transition:filter .15s,transform .15s}' +
      '.bar a.hl:hover{filter:brightness(1.12);transform:translateY(-1px);background:var(--hb)}' +
      '.bar .cls{position:absolute;right:6px;top:50%;transform:translateY(-50%);cursor:pointer;' +
      'background:none;border:0;color:inherit;opacity:.75;padding:6px;line-height:0;z-index:1}' +
      '.bar .cls:hover{opacity:1}.bar .cls svg{width:15px;height:15px}' +
      '@media (max-width:560px){.bar{font-size:12.5px;gap:7px;padding:8px 36px 8px 10px}' +
      '.seg{min-width:31px;padding:3px 4px 2px}.seg b{font-size:13px}.seg i{font-size:7px}' +
      '.bar a{padding:3px 11px}}' +
      '@media (prefers-reduced-motion:reduce){.bar::after,.bar .fl,.sep,.cd.urgent .seg,.seg b.tick{animation:none}}';

    var inner = '<span class="txt">' + richText(tb.text, tb.highlights) + '</span>';
    if (tb.ends_at) {
      inner += '<span class="cd" role="timer" aria-label="Kampanya bitimine kalan süre">' +
        '<span class="seg" data-u="d"><b>0</b><i>GÜN</i></span><span class="sep" data-u="d">:</span>' +
        '<span class="seg"><b data-u="h">00</b><i>SAAT</i></span><span class="sep">:</span>' +
        '<span class="seg"><b data-u="m">00</b><i>DK</i></span><span class="sep">:</span>' +
        '<span class="seg"><b data-u="s">00</b><i>SN</i></span></span>';
    }
    if (tb.url) inner += '<a href="' + esc(tb.url) + '">' + esc(tb.link_text || 'İncele') + '</a>';
    if (tb.dismissible) inner += '<button class="cls" type="button" aria-label="Kapat">' + X + '</button>';

    root.innerHTML = '<style>' + css + '</style>' +
      '<div class="bar" role="region" aria-label="Kampanya duyurusu" style="background:' + esc(tb.bg) + ';color:' + esc(tb.fg) + '">' + inner + '</div>';

    var cls = root.querySelector('.cls');
    if (cls) cls.addEventListener('click', function () {
      lsSet(LS_BAR, key);
      if (host.parentNode) host.parentNode.removeChild(host);
    });

    document.body.insertBefore(host, document.body.firstChild);
    hideEmptyThemeTopbar();
    keepFixedHeadersBelow(host);

    var cd = root.querySelector('.cd');
    if (cd) {
      var daySeg = cd.querySelector('.seg[data-u=d]');
      var daySep = cd.querySelector('.sep[data-u=d]');
      var dayVal = daySeg.querySelector('b');
      var uh = cd.querySelector('b[data-u=h]');
      var um = cd.querySelector('b[data-u=m]');
      var us = cd.querySelector('b[data-u=s]');

      var setVal = function (el, txt) { // değer değişince küçük "düşme" animasyonu
        if (el.textContent === txt) return;
        el.textContent = txt;
        el.classList.remove('tick');
        void el.offsetWidth; // animasyonu yeniden tetikle
        el.classList.add('tick');
      };

      var tick = function () {
        var remain = tb.ends_at - now();
        if (remain <= 0) { // süre doldu → bar tamamen kalkar (sahte aciliyet yok)
          if (host.parentNode) host.parentNode.removeChild(host);
          clearInterval(iv);
          return;
        }
        var d = Math.floor(remain / 86400000);
        var show = d > 0 ? '' : 'none';
        if (daySeg.style.display !== show) { daySeg.style.display = show; daySep.style.display = show; }
        if (d > 0) setVal(dayVal, String(d));
        setVal(uh, pad(Math.floor((remain % 86400000) / 3600000)));
        setVal(um, pad(Math.floor((remain % 3600000) / 60000)));
        setVal(us, pad(Math.floor((remain % 60000) / 1000)));
        if (remain < 3600000) cd.classList.add('urgent');
        else cd.classList.remove('urgent');
      };
      var iv = setInterval(tick, 1000);
      tick();
    }
  }

  // ---- 1b) KAYAN MADDE BARI -------------------------------------------------
  // Maddeler dikey şeritte alt alta durur; şerit her `interval` sn'de bir madde
  // yukarı kayar (translateY). Sona gelince ilk maddenin klonuna kayıp geçişsiz
  // başa döner = kesintisiz döngü. Üzerine gelince (hover) durur.
  function mountTicker(tb) {
    var items = tb.items || [];
    if (!items.length) return;

    var sig = '';
    for (var k = 0; k < items.length; k++) sig += items[k].text + '|' + (items[k].url || '') + ';';
    var key = hash('ticker:' + sig);
    if (tb.dismissible && lsGet(LS_BAR) === key) return;

    var host = document.createElement('div');
    host.id = 'yunbi-announce-topbar';
    // Tam genişlik: tema body'ye margin/max-width verse bile bar kenardan kenara
    host.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:2147482000;display:block;width:100%;max-width:none;margin:0;padding:0;box-sizing:border-box';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var H = 40, HM = 36; // bar yüksekliği (masaüstü / mobil) — kayma adımı bu yüksekliktir
    var css =
      ':host{display:block}' +
      '.bar{position:relative;box-sizing:border-box;overflow:hidden;height:' + H + 'px;width:100%;' +
      'padding:0 40px 0 14px;box-shadow:0 2px 10px rgba(0,0,0,.18);' +
      'font:14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}' +
      '.bar::after{content:"";position:absolute;inset:0;pointer-events:none;' +
      'background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.14) 50%,transparent 58%);' +
      'background-size:230% 100%;animation:ysheen 5.5s linear infinite}' +
      '@keyframes ysheen{0%{background-position:125% 0}100%{background-position:-125% 0}}' +
      '.trk{display:block;will-change:transform;transition:transform .55s cubic-bezier(.65,0,.35,1)}' +
      '.trk.snap{transition:none}' +
      '.it{display:flex;align-items:center;justify-content:center;gap:8px;height:' + H + 'px;' +
      'padding:0 4px;box-sizing:border-box;color:inherit;text-decoration:none;font-weight:600;white-space:nowrap;min-width:0}' +
      '.it .tx{overflow:hidden;text-overflow:ellipsis}' +
      '.it .ic{display:inline-flex;line-height:0;flex:none;color:#fbbf24}' +
      '.it .ic svg{width:22px;height:22px;stroke-width:2.4;shape-rendering:geometricPrecision}' +
      'a.it:hover .tx{text-decoration:underline}' +
      '.cls{position:absolute;right:6px;top:50%;transform:translateY(-50%);cursor:pointer;' +
      'background:none;border:0;color:inherit;opacity:.75;padding:6px;line-height:0;z-index:1}' +
      '.cls:hover{opacity:1}.cls svg{width:15px;height:15px}' +
      '@media (max-width:560px){.bar{height:' + HM + 'px;font-size:12.5px;padding:0 34px 0 10px}' +
      '.it{height:' + HM + 'px;gap:6px}.it .ic svg{width:19px;height:19px}}' +
      '@media (prefers-reduced-motion:reduce){.bar::after{animation:none}.trk{transition:none}}';

    function itemHtml(it) {
      var tag = it.url ? 'a' : 'div';
      var attrs = it.url ? ' href="' + esc(it.url) + '"' : '';
      return '<' + tag + ' class="it"' + attrs + '><span class="ic">' + (ICONS[it.icon] || ICONS.check) + '</span>' +
        '<span class="tx">' + esc(it.text) + '</span></' + tag + '>';
    }
    var html = '';
    for (var i = 0; i < items.length; i++) html += itemHtml(items[i]);
    if (items.length > 1) html += itemHtml(items[0]); // döngü klonu

    root.innerHTML = '<style>' + css + '</style>' +
      '<div class="bar" role="region" aria-label="Mağaza avantajları" aria-live="polite" style="background:' + esc(tb.bg) + ';color:' + esc(tb.fg) + '">' +
      '<div class="trk">' + html + '</div>' +
      (tb.dismissible ? '<button class="cls" type="button" aria-label="Kapat">' + X + '</button>' : '') +
      '</div>';

    var cls = root.querySelector('.cls');
    if (cls) cls.addEventListener('click', function () {
      lsSet(LS_BAR, key);
      if (host.parentNode) host.parentNode.removeChild(host);
      clearInterval(iv);
    });

    document.body.insertBefore(host, document.body.firstChild);
    hideEmptyThemeTopbar();
    keepFixedHeadersBelow(host);

    var iv = null;
    if (items.length > 1) {
      var bar = root.querySelector('.bar');
      var trk = root.querySelector('.trk');
      var idx = 0, paused = false;
      var step = function () { return bar.offsetHeight || H; }; // mobil/masaüstü yüksekliğine göre
      var go = function (i, snap) {
        if (snap) trk.classList.add('snap'); else trk.classList.remove('snap');
        trk.style.transform = 'translateY(-' + (i * step()) + 'px)';
        if (snap) void trk.offsetWidth; // transition'sız konumu hemen uygula
      };
      trk.addEventListener('transitionend', function () {
        if (idx === items.length) { idx = 0; go(0, true); } // klondan gerçek ilk maddeye geçişsiz dön
      });
      bar.addEventListener('mouseenter', function () { paused = true; });
      bar.addEventListener('mouseleave', function () { paused = false; });
      iv = setInterval(function () {
        if (paused || document.hidden) return;
        idx++;
        go(idx, false);
      }, Math.max(2, tb.interval || 4) * 1000);
      // Pencere yeniden boyutlanınca (mobil↔masaüstü) kayma adımı değişir → konumu tazele
      window.addEventListener('resize', function () { go(idx, true); });
    }
  }

  // Bazı temalar (örn. Ticimax "Header3") header'ın içinde KENDİ boş üst barını
  // ("#top-bar"/".header-top", çoğunlukla siyah) hiç kullanılmasa da render eder.
  // Bizim barımız body'nin en başına (dolayısıyla header'ın da üstüne) girince bu
  // boş bar altta ikinci bir siyah şerit gibi kalır. Gerçekten boşsa (metin/link/
  // görsel yok) gizle — dolu ise (tema o alanı fiilen kullanıyorsa) DOKUNMA.
  function hideEmptyThemeTopbar() {
    var SEL = ['#top-bar', '.header-top'];
    setTimeout(function () { // tema kendi JS'iyle dolduruyor olabilir, biraz bekle
      for (var i = 0; i < SEL.length; i++) {
        var els;
        try { els = document.querySelectorAll(SEL[i]); } catch (e) { continue; }
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (!el || el.id === 'yunbi-announce-topbar' || el.closest('#yunbi-announce-topbar')) continue;
          if (el.querySelector('img,svg,a[href]')) continue;
          if ((el.textContent || '').replace(/\s+/g, '') !== '') continue;
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }, 400);
  }

  // ========================= 2) BİLDİRİM ÇANI =================================
  function seenIds() {
    try { var a = JSON.parse(lsGet(LS_SEEN) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  function mountBell() {
    var bl = cfg.bell;
    if (!bl || !bl.enabled || !bl.items || !bl.items.length) return;

    var host = document.createElement('div');
    host.id = 'yunbi-announce-bell';
    host.style.cssText = 'position:fixed;bottom:20px;' + (bl.position === 'left' ? 'left:20px' : 'right:20px') + ';z-index:2147481000';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var side = bl.position === 'left' ? 'left' : 'right';
    var css =
      ':host{display:block}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}' +
      '.btn{position:relative;width:52px;height:52px;border-radius:50%;border:0;cursor:pointer;' +
      'background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.22);transition:transform .15s}' +
      '.btn:hover{transform:scale(1.06)}.btn svg{width:24px;height:24px}' +
      '.btn .bdg{position:absolute;top:-3px;right:-3px;min-width:19px;height:19px;border-radius:10px;' +
      'background:#dc2626;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;' +
      'justify-content:center;padding:0 5px;border:2px solid #fff}' +
      '.btn .bdg[hidden]{display:none}' +
      '.pnl{position:absolute;bottom:62px;' + side + ':0;width:min(340px,calc(100vw - 32px));max-height:min(420px,70vh);' +
      'background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.24);overflow:hidden;' +
      'display:none;flex-direction:column}' +
      '.pnl.open{display:flex}' +
      '.hd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;' +
      'background:#111827;color:#fff;font-size:13.5px;font-weight:700}' +
      '.hd button{background:none;border:0;color:#fff;opacity:.8;cursor:pointer;padding:4px;line-height:0}' +
      '.hd button svg{width:15px;height:15px}' +
      '.ls{overflow-y:auto;padding:6px}' +
      '.it{display:block;padding:11px 12px;border-radius:10px;text-decoration:none;color:inherit}' +
      'a.it:hover{background:#f3f4f6}' +
      '.it+.it{margin-top:2px}' +
      '.it .t{font-size:13.5px;font-weight:700;color:#111827;margin:0 0 3px}' +
      '.it .x{font-size:12.5px;line-height:1.45;color:#4b5563;margin:0}' +
      '.it .r{display:inline-block;margin-top:5px;font-size:11px;font-weight:700;color:#b45309;' +
      'background:#fef3c7;border-radius:6px;padding:2px 7px}' +
      '.it .lnk{display:inline-block;margin-top:5px;font-size:12px;font-weight:700;color:#4f46e5}' +
      '@media (max-width:560px){.btn{width:46px;height:46px}.btn svg{width:21px;height:21px}}';

    var listHtml = '';
    for (var i = 0; i < bl.items.length; i++) {
      var it = bl.items[i];
      var tag = it.url ? 'a' : 'div';
      var attrs = it.url ? ' href="' + esc(it.url) + '"' : '';
      listHtml += '<' + tag + ' class="it"' + attrs + '>' +
        '<p class="t">' + esc(it.title) + '</p>' +
        (it.text ? '<p class="x">' + esc(it.text) + '</p>' : '') +
        (it.ends_at ? '<span class="r" data-ends="' + it.ends_at + '"></span>' : '') +
        (it.url ? '<span class="lnk">' + 'İncele →' + '</span>' : '') +
        '</' + tag + '>';
    }

    root.innerHTML = '<style>' + css + '</style>' +
      '<div class="pnl" role="dialog" aria-label="Kampanyalar">' +
      '<div class="hd"><span>Kampanyalar</span><button type="button" aria-label="Kapat">' + X + '</button></div>' +
      '<div class="ls">' + listHtml + '</div></div>' +
      '<button class="btn" type="button" aria-label="Kampanya bildirimleri">' + BELL + '<span class="bdg" hidden></span></button>';

    var btn = root.querySelector('.btn');
    var bdg = root.querySelector('.bdg');
    var pnl = root.querySelector('.pnl');

    function refreshBadge() {
      var seen = seenIds(), unread = 0;
      for (var i = 0; i < bl.items.length; i++) {
        if (seen.indexOf(bl.items[i].id) === -1) unread++;
      }
      if (unread > 0) { bdg.hidden = false; bdg.textContent = unread > 9 ? '9+' : String(unread); }
      else bdg.hidden = true;
    }

    function refreshRemains() {
      var els = root.querySelectorAll('.r[data-ends]');
      for (var i = 0; i < els.length; i++) {
        els[i].textContent = fmtRemainRough(+els[i].getAttribute('data-ends') - now());
      }
    }

    function markAllSeen() {
      var seen = seenIds();
      for (var i = 0; i < bl.items.length; i++) {
        if (seen.indexOf(bl.items[i].id) === -1) seen.push(bl.items[i].id);
      }
      lsSet(LS_SEEN, JSON.stringify(seen.slice(-100)));
      refreshBadge();
    }

    btn.addEventListener('click', function () {
      var open = pnl.classList.toggle('open');
      if (open) { refreshRemains(); markAllSeen(); }
    });
    root.querySelector('.hd button').addEventListener('click', function () {
      pnl.classList.remove('open');
    });
    // Panel dışına tıklama → kapat (shadow içi tıklamalar host'tan geçer, composedPath kontrolü)
    document.addEventListener('click', function (e) {
      if (!pnl.classList.contains('open')) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(host) === -1) pnl.classList.remove('open');
    });

    refreshBadge();
    refreshRemains();
    document.body.appendChild(host);
  }

  // ======================= 3) GÜVEN ROZETLERİ =================================
  // Ürün detayda sepet butonu bloğunun ALTINA gelir (kargo sayacı üstte kalır).
  var TRUST_TARGETS = ['after:#divSatinAl', 'after:.buybutton', 'after:#pnlFiyatlar', 'after:.urunDetayFiyatContainer'];

  function isVisible(el) { return el.offsetParent !== null; }

  // Ekrana çakılı (position:fixed) bar içine şerit konmaz — mobilde Ticimax
  // sepet/favori butonlarını alta fixed bar yapıyor; şerit orada ekrana yapışık kalır.
  function inFixedBar(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      try { if (getComputedStyle(n).position === 'fixed') return true; } catch (e) { return false; }
    }
    return false;
  }

  function queryAll(sel) {
    try { return document.querySelectorAll(sel); } catch (e) { return []; }
  }

  // Tema JS'i düğümleri runtime'da taşıyıp eski konteyneri gizleyebiliyor (Ticimax
  // .ProductIcon → hidden-phone). Bu yüzden: tüm adaylar içinde önce GÖRÜNÜR (ve
  // fixed-bar dışı) hedef aranır; requireVisible=false ise (son çare) görünmez
  // hedef de kabul edilir. selector virgülle birden çok aday alabilir.
  function placeTrust(host, requireVisible) {
    var candidates = TRUST_TARGETS;
    if (cfg.trust.selector) {
      candidates = cfg.trust.selector.split(',').map(function (s) { return s.trim(); })
        .filter(Boolean).concat(TRUST_TARGETS);
    }
    var fallback = null, fallbackBefore = false;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i], sel = c, before = false;
      if (c.indexOf('before:') === 0) { before = true; sel = c.slice(7); }
      else if (c.indexOf('after:') === 0) { sel = c.slice(6); }
      var list = queryAll(sel);
      for (var j = 0; j < list.length; j++) {
        var el = list[j];
        if (el === host || !el.parentNode || inFixedBar(el)) continue;
        if (isVisible(el)) {
          el.parentNode.insertBefore(host, before ? el : el.nextSibling);
          return true;
        }
        if (!fallback) { fallback = el; fallbackBefore = before; }
      }
    }
    if (!requireVisible && fallback) {
      fallback.parentNode.insertBefore(host, fallbackBefore ? fallback : fallback.nextSibling);
      return true;
    }
    return false;
  }

  function mountTrust() {
    var tr = cfg.trust;
    if (!tr || !tr.enabled || !tr.items || !tr.items.length) return;
    if (document.getElementById('yunbi-announce-trust')) return;

    var host = document.createElement('div');
    host.id = 'yunbi-announce-trust';
    // Tema CSS'i (float:left'li buton blokları, genel div kuralları) şeridi butonların
    // yanına/arkasına itmesin: kendi satırında, tam genişlik — !important ile sabitle.
    host.style.setProperty('clear', 'both', 'important');
    host.style.setProperty('float', 'none', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('width', '100%', 'important');
    host.style.setProperty('max-width', '100%', 'important');
    host.style.setProperty('position', 'static', 'important');
    host.style.setProperty('flex', '0 0 100%', 'important'); // ebeveyn flex ise kendi satırına sar

    var tries = 0;
    (function attempt() {
      // İlk ~6 sn yalnız görünür hedef kabul (tema düğümleri taşıyana kadar bekle);
      // sonrasında son 3 deneme görünmez hedefe de razı olur (hiç yoktan iyidir).
      if (!placeTrust(host, tries < 15)) {
        if (++tries < 18) setTimeout(attempt, 400); // ürün sayfası değilse sessizce vazgeç
        return;
      }

      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var n = tr.items.length;
      var css =
        ':host{display:block;width:100%;max-width:100%;clear:both}' + // clear: tema butonları float:left ise şerit arkalarına kaymasın
        '.tg{display:grid;grid-template-columns:repeat(' + Math.min(n, 3) + ',1fr);gap:8px;margin:18px 0;width:100%;box-sizing:border-box}' +
        '.ti{display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:10px;' +
        'background:#f8fafc;border:1px solid #e2e8f0;box-sizing:border-box;min-width:0;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;text-align:left}' +
        '.ti svg{flex:none;width:21px;height:21px;color:#0f766e}' +
        '.ti .tt{min-width:0}' +
        '.ti .a{display:block;font-size:12.5px;font-weight:700;color:#0f172a;line-height:1.3}' +
        '.ti .b{display:block;font-size:11.5px;color:#64748b;line-height:1.35;margin-top:1px}' +
        '@media (max-width:560px){.tg{grid-template-columns:repeat(' + Math.min(n, 3) + ',1fr);gap:6px;margin:16px 0}' +
        '.ti{flex-direction:column;text-align:center;gap:5px;padding:9px 6px}' +
        '.ti .a{font-size:11.5px}.ti .b{font-size:10.5px}}';

      var html = '';
      for (var i = 0; i < tr.items.length; i++) {
        var it = tr.items[i];
        html += '<div class="ti">' + (ICONS[it.icon] || ICONS.check) +
          '<span class="tt"><span class="a">' + esc(it.title) + '</span>' +
          (it.subtitle ? '<span class="b">' + esc(it.subtitle) + '</span>' : '') +
          '</span></div>';
      }
      root.innerHTML = '<style>' + css + '</style><div class="tg">' + html + '</div>';

      // Bekçi: tema JS'i (handlebars re-render) şeridi silerse geri tak; şerit gizli
      // konteynerde kaldıysa (hidden-phone vb.) ya da tema bulunduğu bloğu sonradan
      // fixed bar'a çevirdiyse görünür/akış-içi bir hedefe taşı
      setInterval(function () {
        if (host.isConnected === false || host.offsetParent === null || inFixedBar(host)) placeTrust(host, true);
      }, 2000);
    })();
  }

  // ============================================================================
  function start() {
    mountTopbar();
    mountBell();
    mountTrust();
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
