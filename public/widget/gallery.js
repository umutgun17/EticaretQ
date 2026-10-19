/*!
 * Yunbi "Ürün Galerisi" widget'ı (CRO) — ürün detay sayfasında temanın görsel slider'ını değiştirir.
 *
 *   <script src="https://hub.yunbi.ai/widget/gallery.js?v=1" data-tenant="tonnyblack" async></script>
 *
 * Ne yapar: temanın ürün görsellerini (Ticimax #divMobileImageList / lightItem) okur, kendi galerisini çizer:
 *   • üstte büyük ana görsel — parmakla yana kaydırılır (scroll-snap), nokta + sayaç
 *   • altında küçük görseller (thumb) — dokununca ana görsel o kareye gider
 *   • ürün videosu varsa (Ticimax videoSettings) R.video_position'ıncı kare olur (vars. 2) — sessiz, aktifken oynar;
 *     masaüstünde temanın video küçük resmi aynı sıraya taşınır
 *   • video A/B (R.video_ab): ziyaretçi sabit kovaya düşer — A videoyu görür, B görmez (mobil + masaüstü);
 *     video_expose / video_view / video_play / video_3s / video_50 / video_100 / add_cart olayları kovayla gönderilir,
 *     satış atfı sunucuda (IP + ürün). Elle kova: ?yunbi_vab=A | B | off
 *   • ana görsele dokununca TAM EKRAN inceleme: pinch / çift dokunuş / tekerlek ile yakınlaştırma,
 *     yakınken parmakla gezdirme, yana kaydırarak sonraki görsel, altta küçük görsel şeridi, geri tuşu kapatır
 * Ana görsel ve tam ekran mağazaya yüklenen ORİJİNAL dosyayı birebir kullanır (CDN yeniden sıkıştırmaz);
 * yalnız küçük görseller CDN'den küçültülür. Tema slider'ı DOM'da kalır (gizlenir) — temanın varyant
 * scriptleri bozulmaz; kaynak değişirse (renk seçimi) galeri kendini yeniden kurar.
 * Bağımsız (no deps), shadow DOM, tek async script; API düşerse sessizce hiçbir şey yapmaz.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var TENANT = script.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiGalleryLoaded) return;
  window.__yunbiGalleryLoaded = true;

  var SRC = new URL(script.src);
  var BASE = SRC.origin;
  var API = BASE + '/w/' + encodeURIComponent(TENANT) + '/gallery';
  var IS_HUB = location.origin === BASE; // demo sayfası: data-* override'ları yalnız burada
  var DEBUG = /[?&]yunbi_debug=1/.test(location.search);
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-gallery]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var cfg = null, T = null, R = null;

  /* ── Ürün videosu A/B kovası: A = video gösterilir, B = gizlenir. Ziyaretçiye sabit (oturum kimliğinden). ── */
  var VFORCED = (function () {
    try {
      var m = /[?&]yunbi_vab=(A|B|off)\b/i.exec(location.search), k = 'yunbi_video_ab_force';
      if (m) { if (m[1].toLowerCase() === 'off') localStorage.removeItem(k); else localStorage.setItem(k, m[1].toUpperCase()); }
      return localStorage.getItem(k) || '';
    } catch (e) { return ''; }
  })();
  function vBucket() {
    if (!R || !R.video_ab) return '';
    if (VFORCED === 'A' || VFORCED === 'B') return VFORCED;
    var h = 0, k = SID + '|product-video';
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return (Math.abs(h) % 100) < (+R.video_ab_share || 50) ? 'A' : 'B';
  }
  function videoOn() { return R.video_enabled !== false && vBucket() !== 'B'; }
  var host = null, root = null, images = [], cur = 0, sourceEl = null, rebuildTimer = null, viewer = null;
  var zoomSent = false;

  function qs(s, el) { try { return (el || document).querySelector(s); } catch (e) { return null; } }
  function qsa(s, el) { try { return [].slice.call((el || document).querySelectorAll(s)); } catch (e) { return []; } }
  function isMobileWidth() { return window.innerWidth <= (R.max_width || 991); }
  function isTouch() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
  function device() { return isMobileWidth() ? 'm' : 'd'; }
  function isProductPage() { return !!(window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage, #divMobileImageList')); }
  function productName() {
    try { var m = window.productDetailModel; if (m && m.productName) return String(m.productName).trim(); } catch (e) {}
    var h = qs('h1'); if (h && h.innerText.trim()) return h.innerText.trim();
    return (document.title || '').split(' - ')[0].split(' | ')[0].trim();
  }
  function productId() { try { return +(window.productDetailModel && window.productDetailModel.productId) || 0; } catch (e) { return 0; } }

  function send(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, device: device(), product_id: productId(), index: cur, count: images.length, ab: vBucket() }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) {}
  }

  /* ── Görsel URL'leri: Ticimax cdn-cgi kalıbı → istenen genişlik ── */
  /* Ana görsel ve tam ekran: mağazaya yüklenen ORİJİNAL dosya birebir (cdn-cgi yeniden sıkıştırma katmanı atlanır,
     çözünürlük neyse o gelir). Yalnız küçük görseller (thumb) CDN'den küçültülmüş ister. */
  function original(url) { return url ? url.replace(/\/cdn-cgi\/image\/[^/]*\//, '/') : url; }
  function cdn(url, w) {
    if (!url) return url;
    if (/\/cdn-cgi\/image\//.test(url)) return url.replace(/\/cdn-cgi\/image\/[^/]*\//, '/cdn-cgi/image/width=' + w + ',quality=85,format=auto/');
    return url;
  }
  function baseKey(url) { return (url || '').replace(/\/cdn-cgi\/image\/[^/]*\//, '/').split('?')[0].toLowerCase(); }

  /* Kaynak: tema slider'ındaki <a> (href = tam boy) + <img> (data-src/src, alt). Video/iframe içeren kare atlanır. */
  function collect() {
    var sels = (R.source_selector || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var found = [], seen = {};
    for (var i = 0; i < sels.length; i++) {
      var els = qsa(sels[i]);
      if (!els.length) continue;
      sourceEl = els[0].closest('#divMobileImageList, .Images, .leftImage, [class*=mage]') || els[0].parentElement;
      for (var j = 0; j < els.length; j++) {
        var a = els[j];
        if (a.querySelector('video, iframe')) continue;
        var img = a.tagName === 'IMG' ? a : a.querySelector('img');
        var full = a.tagName === 'A' ? a.getAttribute('href') : '';
        var mid = img ? (img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || img.getAttribute('src')) : '';
        if (!/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(full || '')) full = '';
        var u = full || mid;
        if (!u || /load\.gif|blank\.|data:image/i.test(u)) { if (!mid || /load\.gif|data:image/i.test(mid)) continue; u = mid; }
        var key = baseKey(u);
        if (seen[key]) continue;
        seen[key] = 1;
        found.push({ full: u, mid: mid && !/load\.gif|data:image/i.test(mid) ? mid : u, alt: (img && img.getAttribute('alt')) || '' });
      }
      if (found.length) break;
    }
    return found;
  }

  /* ── Ürün videosu (Ticimax productDetailModel.videoSettings) → galeride R.video_position'ıncı kare (varsayılan 2) ── */
  function videoInfo() {
    try {
      var v = window.productDetailModel && window.productDetailModel.videoSettings;
      if (!v || !v.videoLink || (v.videoTagTipi && v.videoTagTipi !== 'video')) return null;
      if (!/\.mp4(\?|$)/i.test(v.videoLink)) return null;
      var d = v.urunDetayVideoAyar || {};
      // Yunbi barındırdığı videolarda kapak aynı adla .jpg olarak durur
      var poster = /\/pv\/\d+\/[^/]+\.mp4$/i.test(v.videoLink) ? v.videoLink.replace(/\.mp4$/i, '.jpg') : '';
      return { link: v.videoLink, poster: poster, autoplay: d.otomatikOynat !== false, loop: d.videoYenidenBaslasin !== false };
    } catch (e) { return null; }
  }
  function videoIndex(n) { var p = (+R.video_position || 2) - 1; return Math.max(0, Math.min(p, n)); }
  function withVideo(list) {
    if (!videoOn()) return list;
    var v = videoInfo(); if (!v || !list.length) return list;
    var poster = v.poster || list[0].full;
    var item = { video: v.link, autoplay: v.autoplay, loop: v.loop, full: poster, mid: poster, alt: '' };
    var out = list.slice(); out.splice(videoIndex(list.length), 0, item);
    return out;
  }
  function makeVideo(im, viewerMode) {
    var vd = document.createElement('video');
    vd.muted = true; vd.defaultMuted = true; vd.setAttribute('muted', ''); vd.playsInline = true;
    vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', '');
    vd.loop = im.loop !== false; vd.preload = 'metadata';
    if (im.full) vd.poster = original(im.full);
    if (!viewerMode) vd.src = im.video;
    return vd;
  }
  function playOnly(vids, i) {
    vids.forEach(function (x) { if (!x) return; if (x.idx === i && x.auto) { var pr = x.el.play(); if (pr && pr.catch) pr.catch(function () {}); } else if (!x.el.paused) x.el.pause(); });
  }

  /* Masaüstü (tema galerisi): Tonny teması (Temp.js) geniş ekranda video kutusunu (#divVideoGoruntulemeAlan)
     ızgaranın EN BAŞINA koyar → biz onu R.video_position'ıncı sıraya taşırız. Tema bunu yüklemeden ~0,5 sn sonra
     yaptığından ve tekrar edebildiğinden 20 sn boyunca kontrol edilir. */
  function desktopVideo() {
    if (!videoOn() || !videoInfo()) return;
    var t0 = Date.now();
    function fix() {
      var box = qs('#divVideoGoruntulemeAlan');
      var list = box && box.parentElement;
      if (box && list && box.querySelector('video') && /SmallImages/.test(list.className || '')) {
        var items = [].slice.call(list.children).filter(function (c) { return c !== box && c.id !== 'divThumpVideo' && c.offsetParent !== null; });
        var ref = items[videoIndex(items.length)] || null;
        if (ref ? box.nextElementSibling !== ref : list.lastElementChild !== box) { list.insertBefore(box, ref); dbg('masaüstü video kutusu sıra', videoIndex(items.length) + 1); }
        // Yükseklik: video (çoğu 9:16) fotoğraflardan (2:3) uzun kalmasın → komşu fotoğrafın oranına kırp
        var pi = items[0] && items[0].querySelector('img');
        if (pi && pi.naturalWidth && pi.naturalHeight) {
          box.style.setProperty('--yg-ar', pi.naturalWidth + '/' + pi.naturalHeight);
          var cw = getComputedStyle(items[0]);
          box.style.setProperty('width', cw.width, 'important');
          box.style.setProperty('flex', cw.flex);
          box.style.setProperty('margin', cw.margin);
          if (!document.getElementById('yunbi-gallery-dvideo')) {
            var stv = document.createElement('style'); stv.id = 'yunbi-gallery-dvideo';
            stv.textContent = '.SmallImages>#divVideoGoruntulemeAlan video{width:100%!important;height:auto!important;aspect-ratio:var(--yg-ar,2/3);object-fit:cover;display:block}';
            document.head.appendChild(stv);
          }
        }
      }
      if (Date.now() - t0 < 20000) setTimeout(fix, 400);
    }
    fix();
    var rz = null;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { t0 = Date.now() - 19000; fix(); }, 200); });
  }

  /* ── Video ölçümü: sayfa başına her olay bir kez. Görünme = videonun %50'si ekranda (IntersectionObserver
     kaydırma şeridinin kırpmasını da hesaba katar → yalnız aktif kare sayılır). İzlenme = gerçekten oynayan süre
     (döngü başa sarınca da sayılır); 50/100 = videonun ulaşılan en ileri noktası. ── */
  var vSent = {};
  function vSend(type, extra) { if (vSent[type]) return; vSent[type] = 1; send(type, extra); }
  function bindVideo(vd, where) {
    if (!vd || vd.__ybV) return; vd.__ybV = 1;
    try {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.5) vSend('video_view', { value: where }); }); }, { threshold: [0.5] }).observe(vd);
      }
    } catch (e) {}
    var last = 0, watched = 0, maxFrac = 0;
    vd.addEventListener('playing', function () { vSend('video_play', { value: where }); last = vd.currentTime || 0; });
    vd.addEventListener('timeupdate', function () {
      var t = vd.currentTime || 0, d = vd.duration || 0, dt = t - last;
      if (dt > 0 && dt < 1.5) watched += dt;
      if (dt < -1 && d && last >= d * 0.9) maxFrac = 1; // döngü başa sardı = sonuna kadar izlendi
      last = t;
      if (d) maxFrac = Math.max(maxFrac, t / d);
      if (watched >= 3) vSend('video_3s', { value: where });
      if (maxFrac >= 0.5) vSend('video_50', { value: where });
      if (maxFrac >= 0.95) vSend('video_100', { value: where });
    });
    vd.addEventListener('ended', function () { vSend('video_100', { value: where }); });
  }
  /* Videolu ürün sayfası: kovayı kaydet (A ve B — karnenin paydası), B'de tema video kutusunu gizle,
     A'da masaüstü tema videosunu izle, ürün detay "Sepete Ekle"yi say. */
  function videoTrack() {
    var tries = 0;
    (function wait() {
      var v = videoInfo();
      if (!v) { if (++tries < 12) setTimeout(wait, 500); return; }
      vSend('video_expose', { value: v.link.split('/').pop().slice(0, 160) });
      if (vBucket() === 'B') hideThemeVideo();
      else {
        var t0 = Date.now();
        (function find() {
          var el = qs('#divVideoGoruntulemeAlan video');
          if (el && el.offsetParent !== null) bindVideo(el, 'theme');
          else if (Date.now() - t0 < 20000) setTimeout(find, 500);
        })();
      }
      hookAddCart();
    })();
  }
  function hideThemeVideo() {
    if (!document.getElementById('yunbi-gallery-vab')) {
      var st = document.createElement('style'); st.id = 'yunbi-gallery-vab';
      st.textContent = '#divVideoGoruntulemeAlan,#divThumpVideo{display:none!important}';
      (document.head || document.documentElement).appendChild(st);
    }
    var t0 = Date.now();
    (function stop() {
      qsa('#divVideoGoruntulemeAlan video').forEach(function (x) { try { if (!x.paused) x.pause(); x.removeAttribute('autoplay'); x.preload = 'none'; } catch (e) {} });
      if (Date.now() - t0 < 20000) setTimeout(stop, 500);
    })();
  }
  function hookAddCart() {
    var t0 = Date.now();
    (function hook() {
      var add = window.sepeteEkleUrunDetay;
      if (typeof add !== 'function') { if (Date.now() - t0 < 15000) setTimeout(hook, 500); return; }
      if (add.__ybG) return;
      var w = function () {
        try { var h = document.getElementById('hddnUrunID'); if (h && +h.value > 0) send('add_cart', { value: String(h.value) }); } catch (e) {}
        return add.apply(this, arguments);
      };
      w.__ybG = 1;
      window.sepeteEkleUrunDetay = w;
    })();
  }

  /* ── CSS ── */
  function css() {
    var t = T, r = R, acc = t.accent || '#111827';
    var ar = t.aspect === '3:4' ? '3/4' : t.aspect === '2:3' ? '2/3' : t.aspect === '4:5' ? '4/5' : t.aspect === 'auto' ? 'auto' : t.aspect === 'photo' ? 'var(--thr,2/3)' : '1/1';
    var fit = t.aspect === 'photo' ? 'contain' : (t.fit === 'contain' ? 'contain' : 'cover'); // fotoğraf oranında asla kırpma
    var th = +t.thumb_size || 64, gap = +t.thumb_gap || 8;
    var thH = t.thumb_style === 'tall' ? Math.round(th * 4 / 3) : th;
    var photo = t.thumb_style === 'photo';
    var thR = t.thumb_style === 'round' ? '50%' : '8px';
    return ':host{all:initial;display:block;width:100%;font-family:' + (t.font ? t.font + ',' : '') + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;--acc:' + acc + ';--bg:' + (t.bg || '#fff') + '}' +
      '*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}' +
      '.g{background:var(--bg);width:100%;position:relative}' +
      '.stage{position:relative;width:100%;aspect-ratio:' + ar + ';overflow:hidden;border-radius:' + (+t.radius || 0) + 'px;background:#f4f5f7}' +
      (t.aspect === 'auto' ? '.stage{aspect-ratio:auto;min-height:200px}' : '') +
      '.track{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;cursor:' + (r.viewer_enabled === false ? 'default' : 'zoom-in') + '}' +
      '.track::-webkit-scrollbar{display:none}' +
      '.sl{flex:0 0 100%;width:100%;height:100%;scroll-snap-align:start;scroll-snap-stop:always;position:relative;display:flex;align-items:center;justify-content:center}' +
      '.sl video{object-fit:cover!important}' +
      '.sl img,.sl video{width:100%;height:100%;object-fit:' + fit + ';display:block;user-select:none;-webkit-user-drag:none;background:#f4f5f7}' +
      '.th{position:relative}.th .pl,.sl .pl{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;background:rgba(17,24,39,.6);display:flex;align-items:center;justify-content:center;pointer-events:none}' +
      '.th .pl{width:24px;height:24px}.sl .pl{width:54px;height:54px;opacity:0;transition:opacity .2s}.sl.paused .pl{opacity:1}' +
      '.pl svg{width:45%;height:45%;fill:#fff;margin-left:8%}' +
      '.vsl video{max-width:100%;max-height:100%;width:auto;height:auto;display:block}' +
      (t.aspect === 'auto' ? '.sl img{height:auto}' : '') +
      '.ind{position:absolute;left:0;right:0;bottom:10px;display:flex;align-items:center;justify-content:center;gap:5px;pointer-events:none}' +
      '.dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.65);box-shadow:0 0 0 1px rgba(0,0,0,.12);transition:transform .2s,background .2s}' +
      '.dot.on{background:var(--acc);transform:scale(1.35)}' +
      '.cnt{position:absolute;right:10px;bottom:10px;background:rgba(17,24,39,.72);color:#fff;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:999px;pointer-events:none;letter-spacing:.3px}' +
      '.cnt.top{bottom:auto;top:10px}' +
      '.hint{position:absolute;left:10px;bottom:10px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.15);pointer-events:none}' +
      '.hint svg{width:16px;height:16px;stroke:#111827;fill:none;stroke-width:2;stroke-linecap:round}' +
      '.thumbs{display:flex;gap:' + gap + 'px;overflow-x:auto;padding:' + gap + 'px 2px 4px;scrollbar-width:none;scroll-behavior:smooth}' +
      '.thumbs::-webkit-scrollbar{display:none}' +
      (photo ? '.th{flex:0 0 auto;width:auto;height:' + Math.round(th * 1.25) + 'px;aspect-ratio:var(--thr,2/3)' : '.th{flex:0 0 ' + th + 'px;width:' + th + 'px;height:' + thH + 'px') + ';border-radius:' + thR + ';overflow:hidden;border:2px solid transparent;opacity:.72;transition:opacity .2s,border-color .2s;cursor:pointer;background:#f4f5f7}' +
      '.th.on{border-color:var(--acc);opacity:1}' +
      '.th img{width:100%;height:100%;object-fit:cover;display:block;-webkit-user-drag:none}' +
      '.arr{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.92);border:0;display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.18);z-index:2}' +
      '.arr svg{width:18px;height:18px;stroke:#111827;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
      '.arr.l{left:10px}.arr.r{right:10px}' +
      '@media(hover:hover){.g:hover .arr{display:flex}}' +
      /* ── tam ekran görüntüleyici ── */
      '.v{position:fixed;inset:0;z-index:2147483000;background:' + (t.viewer_bg || '#000') + ';display:flex;flex-direction:column;opacity:0;transition:opacity .18s;touch-action:none;overscroll-behavior:contain}' +
      '.v.in{opacity:1}' +
      '.vt{display:flex;align-items:center;justify-content:space-between;padding:max(10px,env(safe-area-inset-top)) 12px 8px;color:#fff;font-size:13px;font-weight:600;flex:0 0 auto}' +
      '.vt .ttl{flex:1 1 auto;min-width:0;padding-right:8px}' +
      '.vt .nm{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.25}' +
      '.vt .c{font-size:12px;font-weight:600;opacity:.85}' +
      '.vt .acts{display:flex;gap:6px;flex:0 0 auto}' +
      '.vt .x{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.14);border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}' +
      '.vt .x:active{background:rgba(255,255,255,.28)}' +
      '.vt .x svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round}' +
      '.vt .zl{font-size:11px;font-weight:500;opacity:.7}' +
      '.vs{flex:1 1 auto;position:relative;overflow:hidden;min-height:0}' +
      '.vtrack{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}' +
      '.vtrack::-webkit-scrollbar{display:none}' +
      '.vtrack.lock{overflow:hidden}' +
      '.vsl{flex:0 0 100%;width:100%;height:100%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}' +
      '.vsl img{max-width:100%;max-height:100%;object-fit:contain;display:block;transform-origin:0 0;will-change:transform;user-select:none;-webkit-user-drag:none;cursor:zoom-in}' +
      '.vsl img.z{cursor:grab}' +
      '.vsl .sp{position:absolute;width:28px;height:28px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:ysp .8s linear infinite}' +
      '@keyframes ysp{to{transform:rotate(360deg)}}' +
      '.vb{flex:0 0 auto;padding:8px 10px max(10px,env(safe-area-inset-bottom));display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;scroll-behavior:smooth}' +
      '.vb::-webkit-scrollbar{display:none}' +
      '.vb .th{flex:0 0 auto;width:auto;height:64px;aspect-ratio:var(--thr,2/3);border-radius:6px;opacity:.5;border-color:transparent}.vb .th.on{opacity:1;border-color:#fff}' +
      '.varr{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.14);border:0;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:2}' +
      '.varr svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
      '.varr.l{left:12px}.varr.r{right:12px}' +
      '@media(hover:hover){.varr{display:flex}}' +
      '.tip{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(255,255,255,.14);color:#fff;font-size:11.5px;padding:5px 11px;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap}' +
      '.tip.in{opacity:1}';
  }

  var ICO = {
    zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>',
    l: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
    r: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>'
  };

  /* ── Sayfa galerisi ── */
  function render() {
    var g = document.createElement('div'); g.className = 'g';
    var stage = document.createElement('div'); stage.className = 'stage';
    var track = document.createElement('div'); track.className = 'track';
    if (R.swipe_main === false) track.style.overflowX = 'hidden';
    var vids = [];
    images.forEach(function (im, i) {
      var sl = document.createElement('div'); sl.className = 'sl';
      if (im.video) {
        var vd = makeVideo(im, false);
        sl.appendChild(vd);
        var pl = document.createElement('div'); pl.className = 'pl'; pl.innerHTML = ICO.play; sl.appendChild(pl);
        sl.classList.add('paused');
        vd.addEventListener('play', function () { sl.classList.remove('paused'); });
        vd.addEventListener('pause', function () { sl.classList.add('paused'); });
        vids.push({ idx: i, el: vd, auto: im.autoplay !== false });
        bindVideo(vd, 'gallery');
        track.appendChild(sl);
        return;
      }
      var img = document.createElement('img');
      img.src = original(im.full); img.alt = im.alt || ''; img.draggable = false;
      if (i >= (+R.preload || 2)) img.loading = 'lazy';
      img.decoding = 'async';
      if (i === 0) img.addEventListener('load', function () { if (img.naturalWidth && img.naturalHeight) host.style.setProperty('--thr', img.naturalWidth + '/' + img.naturalHeight); });
      sl.appendChild(img); track.appendChild(sl);
    });
    stage.appendChild(track);
    var ind = null, cnt = null;
    if (images.length > 1 && (T.indicator === 'dots' || T.indicator === 'both')) {
      ind = document.createElement('div'); ind.className = 'ind';
      images.forEach(function (_, i) { var d = document.createElement('span'); d.className = 'dot' + (i === 0 ? ' on' : ''); ind.appendChild(d); });
      stage.appendChild(ind);
    }
    if (images.length > 1 && (T.indicator === 'counter' || T.indicator === 'both')) {
      cnt = document.createElement('div'); cnt.className = 'cnt'; cnt.textContent = '1 / ' + images.length; stage.appendChild(cnt);
    }
    if (T.zoom_hint !== false && R.viewer_enabled !== false) { var h = document.createElement('div'); h.className = 'hint'; h.innerHTML = ICO.zoom; stage.appendChild(h); }
    if (images.length > 1 && R.indicator_arrows !== false) {
      var al = document.createElement('button'); al.className = 'arr l'; al.type = 'button'; al.setAttribute('aria-label', 'Önceki'); al.innerHTML = ICO.l;
      var ar = document.createElement('button'); ar.className = 'arr r'; ar.type = 'button'; ar.setAttribute('aria-label', 'Sonraki'); ar.innerHTML = ICO.r;
      al.onclick = function (e) { e.stopPropagation(); go(cur - 1, 'arrow'); };
      ar.onclick = function (e) { e.stopPropagation(); go(cur + 1, 'arrow'); };
      stage.appendChild(al); stage.appendChild(ar);
    }
    g.appendChild(stage);

    var thumbs = null;
    if (R.thumbs_on_page !== false && images.length > 1) {
      thumbs = document.createElement('div'); thumbs.className = 'thumbs';
      images.forEach(function (im, i) {
        var t = document.createElement('div'); t.className = 'th' + (i === 0 ? ' on' : '');
        var img = document.createElement('img'); img.src = cdn(im.mid, 200); img.alt = ''; img.loading = i > 8 ? 'lazy' : 'eager'; img.draggable = false;
        t.appendChild(img);
        if (im.video) { var tp = document.createElement('span'); tp.className = 'pl'; tp.innerHTML = ICO.play; t.appendChild(tp); }
        t.addEventListener('click', function () { go(i, 'thumb'); });
        thumbs.appendChild(t);
      });
      g.appendChild(thumbs);
    }

    /* aktif kare takibi (scroll-snap) */
    /* Gösterge (nokta/sayaç/thumb) kaydırma SIRASINDA anında güncellenir: parmak %30 ilerleyince bir sonraki kare aktif
       sayılır (snap'in bitmesi beklenmez). Olay kaydı yine kaydırma bitince bir kez gönderilir. */
    var st = null, lastX = 0, lastSent = 0;
    track.addEventListener('scroll', function () {
      var w = Math.max(1, track.clientWidth), x = track.scrollLeft, dir = x >= lastX ? 1 : -1; lastX = x;
      var frac = x / w, i = dir > 0 ? Math.floor(frac + 0.7) : Math.ceil(frac - 0.7);
      if (i < 0) i = 0; if (i > images.length - 1) i = images.length - 1;
      if (i !== cur) setActive(i);
      clearTimeout(st);
      st = setTimeout(function () { var f = Math.round(track.scrollLeft / w); if (f !== cur) setActive(f); if (cur !== lastSent) { lastSent = cur; send('swipe', { value: 'swipe' }); } }, 120);
    }, { passive: true });

    /* dokunma = tam ekran (kaydırma hareketiyle karışmasın: 10px eşik) */
    var sx = 0, sy = 0, moved = false;
    track.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; moved = false; });
    track.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) moved = true; });
    track.addEventListener('click', function (e) {
      if (moved) return; e.preventDefault();
      if (images[cur] && images[cur].video) {
        var vx = vids.filter(function (x) { return x.idx === cur; })[0];
        if (vx) { if (vx.el.paused) { vx.auto = true; var pr = vx.el.play(); if (pr && pr.catch) pr.catch(function () {}); } else { vx.auto = false; vx.el.pause(); } }
        return;
      }
      if (R.viewer_enabled !== false) openViewer(cur);
    });

    function setActive(i) {
      cur = i;
      if (vids.length) playOnly(vids, i);
      if (ind) qsa('.dot', ind).forEach(function (d, k) { d.classList.toggle('on', k === i); });
      if (cnt) cnt.textContent = (i + 1) + ' / ' + images.length;
      if (thumbs) {
        qsa('.th', thumbs).forEach(function (t, k) { t.classList.toggle('on', k === i); });
        var el = thumbs.children[i]; if (el) { var left = el.offsetLeft - (thumbs.clientWidth - el.offsetWidth) / 2; thumbs.scrollTo({ left: left, behavior: 'smooth' }); }
      }
    }
    /* Küçük resim/ok ile gidiş: scroll-snap kapatılıp kaydırılır, kullanıcı parmakla kaydırmaya başlayınca geri açılır.
       iOS Safari snap'li kapta kodla yapılan (smooth) kaydırmayı geri sektirebiliyor. */
    function snapOn() { if (track.style.scrollSnapType) track.style.scrollSnapType = ''; }
    track.addEventListener('touchstart', snapOn, { passive: true });
    track.addEventListener('pointerdown', snapOn);
    track.addEventListener('wheel', snapOn, { passive: true });
    function go(i, src) {
      if (i < 0) i = images.length - 1; if (i >= images.length) i = 0;
      track.style.scrollSnapType = 'none';
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      setActive(i);
      setTimeout(function () { var w = Math.max(1, track.clientWidth); if (Math.abs(track.scrollLeft - i * w) > 2 && track.style.scrollSnapType === 'none') track.scrollLeft = i * w; }, 700);
      if (src === 'thumb') send('thumb'); else send('swipe', { value: src });
    }
    /* Yunbi uygulama sekmesi (#yunbi-apppromo .tab, ekran kenarına sabit) küçük resim şeridinin ucunu örtüp dokunuşu
       yutuyordu → şeride o kenardan sekme genişliği kadar boşluk. Sekme geç gelebilir / kapatılabilir: 15 sn izlenir. */
    if (thumbs) {
      var tabT0 = Date.now();
      (function tabInset() {
        var l = 0, rr = 0;
        try {
          var ah = document.getElementById('yunbi-apppromo'), tb = ah && ah.shadowRoot && ah.shadowRoot.querySelector('.tab');
          if (tb && !tb.classList.contains('hide') && getComputedStyle(tb).display !== 'none') {
            var q = tb.getBoundingClientRect();
            if (q.width > 0 && q.width < 90) { if (q.left < 4) l = Math.ceil(q.right) + 6; else if (q.right > window.innerWidth - 4) rr = Math.ceil(window.innerWidth - q.left) + 6; }
          }
        } catch (e) {}
        thumbs.style.paddingLeft = Math.max(2, l) + 'px'; thumbs.style.paddingRight = Math.max(2, rr) + 'px';
        if (Date.now() - tabT0 < 15000) setTimeout(tabInset, 1000);
        else if (!g._tabWatch) { g._tabWatch = 1; document.addEventListener('click', function () { setTimeout(tabInset, 400); }, true); }
      })();
    }
    /* İlk görünüşte küçük resimler alttaki sabit "Sepete Ekle" çubuğunun (Ticimax #divSatinAl) altında kalıyordu
       (iPhone 13: şerit 595–687, çubuk 614'te) → mobilde ana görsel, şerit çubuğun üstünde tam görünecek kadar kısaltılır
       (foto oranı korunur, contain). R.fit_viewport=false kapatır. */
    function fitStage() {
      if (R.fit_viewport === false || !isMobileWidth() || !thumbs || !host.isConnected) return;
      try {
        var limit = window.innerHeight;
        var bars = qsa(R.bottom_bar_selector || '#divSatinAl, .mobilSepetBtn, .fixedAddToCart');
        for (var k = 0; k < bars.length; k++) {
          var cs = getComputedStyle(bars[k]); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
          var bq = bars[k].getBoundingClientRect(); if (bq.height > 10 && bq.top > window.innerHeight * 0.5 && bq.top < limit) limit = bq.top;
        }
        stage.style.height = ''; stage.style.aspectRatio = '';
        var sq = stage.getBoundingClientRect(), stTop = sq.top + window.pageYOffset;
        var avail = Math.floor(limit - stTop - thumbs.offsetHeight - 6);
        if (avail < sq.height && avail >= Math.min(260, sq.height)) { stage.style.aspectRatio = 'auto'; stage.style.height = avail + 'px'; dbg('ana görsel kısaltıldı', Math.round(sq.height), '→', avail); }
      } catch (e) {}
    }
    [0, 800, 2500].forEach(function (ms) { setTimeout(fitStage, ms); });
    var fitRz = null, fitW = window.innerWidth; // yalnız genişlik değişince (iOS adres çubuğu yüksekliği oynatır → zıplamasın)
    window.addEventListener('resize', function () { if (window.innerWidth === fitW) return; fitW = window.innerWidth; clearTimeout(fitRz); fitRz = setTimeout(fitStage, 250); });
    g._go = go; g._set = setActive; g._track = track;
    return g;
  }

  /* ── Tam ekran görüntüleyici: pinch/çift dokunuş/tekerlek yakınlaştırma + gezdirme + kaydırma ── */
  function openViewer(start) {
    if (viewer) return;
    zoomSent = false;
    var maxZ = +R.max_zoom || 4, dblZ = +R.double_tap_zoom || 2.5;
    var v = document.createElement('div'); v.className = 'v'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Ürün görselleri');
    var top = document.createElement('div'); top.className = 'vt';
    var cntEl = document.createElement('div'); cntEl.className = 'ttl';
    var pname = R.show_title !== false ? productName() : '';
    cntEl.innerHTML = (pname ? '<div class="nm"></div>' : '') + '<div><span class="c">' + (start + 1) + ' / ' + images.length + '</span> <span class="zl"></span></div>';
    if (pname) qs('.nm', cntEl).textContent = pname;
    var acts = document.createElement('div'); acts.className = 'acts';
    if (R.share_button !== false && (navigator.share || navigator.clipboard)) {
      var sh = document.createElement('button'); sh.className = 'x'; sh.type = 'button'; sh.setAttribute('aria-label', 'Paylaş'); sh.innerHTML = ICO.share;
      sh.onclick = function () { share(pname); };
      acts.appendChild(sh);
    }
    if (R.download_button !== false) {
      var dlb = document.createElement('button'); dlb.className = 'x'; dlb.type = 'button'; dlb.setAttribute('aria-label', 'İndir'); dlb.innerHTML = ICO.dl;
      dlb.onclick = function () { if (slides[vcur].video) return; download(slides[vcur].src, pname); };
      acts.appendChild(dlb);
    }
    var x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.setAttribute('aria-label', 'Kapat'); x.innerHTML = ICO.x;
    acts.appendChild(x);
    top.appendChild(cntEl); top.appendChild(acts);
    var vs = document.createElement('div'); vs.className = 'vs';
    var vt = document.createElement('div'); vt.className = 'vtrack';
    var slides = [];
    images.forEach(function (im, i) {
      var sl = document.createElement('div'); sl.className = 'vsl';
      var sp = document.createElement('div'); sp.className = 'sp'; sl.appendChild(sp);
      if (im.video) {
        var vd = makeVideo(im, true); vd.controls = true;
        vd.onloadeddata = function () { sp.remove(); };
        sl.appendChild(vd); vt.appendChild(sl);
        slides.push({ el: sl, img: vd, src: im.video, video: true, loaded: false, s: 1, tx: 0, ty: 0 });
        return;
      }
      var img = document.createElement('img'); img.alt = im.alt || ''; img.draggable = false; img.decoding = 'async';
      img.onload = function () { sp.remove(); };
      sl.appendChild(img); vt.appendChild(sl);
      slides.push({ el: sl, img: img, src: original(im.full), loaded: false, s: 1, tx: 0, ty: 0 });
    });
    vs.appendChild(vt);
    var tip = document.createElement('div'); tip.className = 'tip'; tip.textContent = R.zoom_enabled === false ? (images.length > 1 ? 'Diğer görseller için yana kaydırın' : '') : isTouch() ? 'Yakınlaştırmak için iki parmakla açın veya çift dokunun' : 'Yakınlaştırmak için tıklayın veya tekerleği kullanın'; vs.appendChild(tip);
    if (images.length > 1) {
      var al = document.createElement('button'); al.className = 'varr l'; al.type = 'button'; al.innerHTML = ICO.l; al.onclick = function () { goV(vcur - 1); };
      var ar = document.createElement('button'); ar.className = 'varr r'; ar.type = 'button'; ar.innerHTML = ICO.r; ar.onclick = function () { goV(vcur + 1); };
      vs.appendChild(al); vs.appendChild(ar);
    }
    v.appendChild(top); v.appendChild(vs);
    var vb = null;
    if (R.thumbs_in_viewer !== false && images.length > 1) {
      vb = document.createElement('div'); vb.className = 'vb';
      images.forEach(function (im, i) {
        var t = document.createElement('div'); t.className = 'th' + (i === start ? ' on' : '');
        var img = document.createElement('img'); img.src = cdn(im.mid, 200); img.alt = ''; img.draggable = false; t.appendChild(img);
        t.addEventListener('click', function () { goV(i); send('thumb', { value: 'viewer' }); });
        vb.appendChild(t);
      });
      v.appendChild(vb);
    }
    root.appendChild(v);
    viewer = v;

    var vcur = start;
    var prevOverflow = document.documentElement.style.overflow, prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';

    function load(i) { var s = slides[i]; if (s && !s.loaded) { s.loaded = true; s.img.src = s.src; } }
    function apply(s) {
      s.img.style.transform = 'translate(' + s.tx + 'px,' + s.ty + 'px) scale(' + s.s + ')';
      s.img.classList.toggle('z', s.s > 1.01);
      vt.classList.toggle('lock', s.s > 1.01);
      var zl = qs('.zl', cntEl); if (zl) zl.textContent = s.s > 1.01 ? Math.round(s.s * 100) + '%' : '';
    }
    /* görselin ekrandaki gerçek kutusu (contain) — sınırları buna göre kısıtla */
    function box(s) {
      var r = s.el.getBoundingClientRect(), nw = s.img.naturalWidth || 1, nh = s.img.naturalHeight || 1;
      var k = Math.min(r.width / nw, r.height / nh); var w = nw * k, h = nh * k;
      return { w: w, h: h, x: (r.width - w) / 2, y: (r.height - h) / 2, cw: r.width, ch: r.height };
    }
    function clamp(s) {
      var b = box(s);
      var sw = b.w * s.s, sh = b.h * s.s;
      var minX = b.cw - b.x - sw, maxX = -b.x; // translate = img üst-sol köşesi konumu (origin 0 0), img konteynerde b.x'ten başlar
      var minY = b.ch - b.y - sh, maxY = -b.y;
      if (sw <= b.cw) s.tx = (b.cw - sw) / 2 - b.x; else s.tx = Math.min(maxX, Math.max(minX, s.tx));
      if (sh <= b.ch) s.ty = (b.ch - sh) / 2 - b.y; else s.ty = Math.min(maxY, Math.max(minY, s.ty));
    }
    function zoomTo(s, ns, cx, cy) {
      if (R.zoom_enabled === false || s.video) return;
      ns = Math.max(1, Math.min(maxZ, ns));
      var b = box(s), r = s.el.getBoundingClientRect();
      // odak noktası (cx,cy) ekran koordinatı → img yerel koordinatı
      var lx = (cx - r.left - b.x - s.tx) / s.s, ly = (cy - r.top - b.y - s.ty) / s.s;
      s.s = ns;
      s.tx = cx - r.left - b.x - lx * ns; s.ty = cy - r.top - b.y - ly * ns;
      if (ns <= 1.001) { s.s = 1; s.tx = 0; s.ty = 0; }
      clamp(s); apply(s);
      if (ns > 1.01 && !zoomSent) { zoomSent = true; send('zoom', { index: vcur, value: String(Math.round(ns * 10) / 10) }); }
    }
    function reset(s) { s.s = 1; s.tx = 0; s.ty = 0; apply(s); }
    function setV(i, silent) {
      if (i < 0) i = images.length - 1; if (i >= images.length) i = 0;
      if (vcur !== i) reset(slides[vcur]);
      vcur = i; load(i); load(i + 1); load(i - 1);
      slides.forEach(function (x, k) { if (!x.video) return; if (k === i) { var pr = x.img.play(); if (pr && pr.catch) pr.catch(function () {}); } else if (!x.img.paused) x.img.pause(); });
      var c = qs('.c', cntEl); if (c) c.textContent = (i + 1) + ' / ' + images.length;
      if (vb) { qsa('.th', vb).forEach(function (t, k) { t.classList.toggle('on', k === i); }); var el = vb.children[i]; if (el) vb.scrollTo({ left: el.offsetLeft - (vb.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' }); }
      if (!silent) { cur = i; if (host._g) host._g._go(i, 'viewer'); }
    }
    function goV(i) { if (i < 0) i = images.length - 1; if (i >= images.length) i = 0; vt.scrollTo({ left: i * vt.clientWidth, behavior: 'smooth' }); setV(i); }

    /* ── pointer tabanlı jestler ── */
    var pts = {}, pinch = null, drag = null, lastTap = 0, tapTimer = null;
    function cnt2() { return Object.keys(pts).length; }
    function mid2() { var k = Object.keys(pts); return { x: (pts[k[0]].x + pts[k[1]].x) / 2, y: (pts[k[0]].y + pts[k[1]].y) / 2, d: Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y) }; }
    vs.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.varr')) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var s = slides[vcur];
      if (cnt2() === 2) { var m = mid2(); pinch = { d0: m.d, s0: s.s, x: m.x, y: m.y }; drag = null; try { vs.setPointerCapture(e.pointerId); } catch (er) {} }
      else if (cnt2() === 1) {
        drag = { x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty, moved: false, t: Date.now() };
        if (s.s > 1.01) { try { vs.setPointerCapture(e.pointerId); } catch (er) {} }
      }
    });
    vs.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var s = slides[vcur];
      if (pinch && cnt2() === 2) { var m = mid2(); zoomTo(s, pinch.s0 * (m.d / Math.max(1, pinch.d0)), m.x, m.y); e.preventDefault(); return; }
      if (drag && cnt2() === 1) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
        if (s.s > 1.01) { s.tx = drag.tx + dx; s.ty = drag.ty + dy; clamp(s); apply(s); e.preventDefault(); }
      }
    });
    function up(e) {
      var wasPinch = !!pinch, d = drag;
      delete pts[e.pointerId];
      if (cnt2() < 2) pinch = null;
      if (cnt2() === 0) {
        drag = null;
        var s = slides[vcur];
        if (wasPinch) { if (s.s < 1.05) reset(s); return; }
        if (d && !d.moved && Date.now() - d.t < 350) {
          var now = Date.now();
          if (now - lastTap < 320) { clearTimeout(tapTimer); lastTap = 0; zoomTo(s, s.s > 1.01 ? 1 : dblZ, e.clientX, e.clientY); }
          else { lastTap = now; tapTimer = setTimeout(function () { /* tek dokunuş: masaüstünde yakınlaştır/geri al */ if (!isTouch()) zoomTo(s, s.s > 1.01 ? 1 : dblZ, e.clientX, e.clientY); }, 330); }
        }
      }
    }
    vs.addEventListener('pointerup', up); vs.addEventListener('pointercancel', up);
    vs.addEventListener('wheel', function (e) { e.preventDefault(); var s = slides[vcur]; zoomTo(s, s.s * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY); }, { passive: false });
    var vLastX = 0, vSt = null;
    vt.addEventListener('scroll', function () {
      if (slides[vcur].s > 1.01) return;
      var w = Math.max(1, vt.clientWidth), x = vt.scrollLeft, dir = x >= vLastX ? 1 : -1; vLastX = x;
      var frac = x / w, i = dir > 0 ? Math.floor(frac + 0.7) : Math.ceil(frac - 0.7);
      if (i < 0) i = 0; if (i > images.length - 1) i = images.length - 1;
      if (i !== vcur) { setV(i); clearTimeout(vSt); vSt = setTimeout(function () { send('swipe', { value: 'viewer' }); }, 150); }
    }, { passive: true });
    /* Safari pinch = gesture olayları; sayfa yakınlaşmasın */
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { v.addEventListener(n, function (e) { e.preventDefault(); }); });

    function toast(msg) { tip.textContent = msg; tip.classList.add('in'); clearTimeout(tip._t); tip._t = setTimeout(function () { tip.classList.remove('in'); }, 2000); }
    function share(name) {
      var url = location.href.split('#')[0], title = name || document.title;
      send('share', { index: vcur });
      if (navigator.share) { navigator.share({ title: title, text: title, url: url }).catch(function () {}); return; }
      try { navigator.clipboard.writeText(url).then(function () { toast('Bağlantı kopyalandı'); }, function () { toast('Kopyalanamadı'); }); } catch (e) { toast('Kopyalanamadı'); }
    }
    function download(src, name) {
      send('download', { index: vcur });
      var tr = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' };
      var slug = (name || 'urun').replace(/[çğıöşüÇĞİÖŞÜ]/g, function (c) { return tr[c]; }).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'urun';
      var fname = slug + '-' + (vcur + 1) + '.jpg';
      fetch(src, { mode: 'cors' }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (bl) {
        var u = URL.createObjectURL(bl), a = document.createElement('a'); a.href = u; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000); toast('Görsel indiriliyor');
      }).catch(function () { var a = document.createElement('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener'; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); });
    }
    function close() {
      if (!viewer) return;
      var vv = viewer; viewer = null;
      vv.classList.remove('in');
      document.documentElement.style.overflow = prevOverflow; document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop);
      if (pushed && history.state && history.state.yunbiGallery) { pushed = false; history.back(); }
      slides.forEach(function (x) { if (x.video && !x.img.paused) x.img.pause(); });
      setTimeout(function () { vv.remove(); }, 200);
      send('close', { index: vcur });
    }
    function onKey(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') goV(vcur + 1); else if (e.key === 'ArrowLeft') goV(vcur - 1); }
    function onPop() { pushed = false; close(); }
    var pushed = false;
    try { history.pushState({ yunbiGallery: 1 }, ''); pushed = true; window.addEventListener('popstate', onPop); } catch (e) {}
    window.addEventListener('keydown', onKey);
    x.onclick = close;

    load(start); load(start + 1); load(start - 1);
    requestAnimationFrame(function () { vt.scrollLeft = start * vt.clientWidth; v.classList.add('in'); setV(start, true); tip.classList.add('in'); setTimeout(function () { tip.classList.remove('in'); }, 2200); });
    send('open', { index: start });
  }

  /* ── Yerleştirme ── */
  function hideNative() {
    var sels = (R.hide_selector || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!sels.length) return;
    var st = document.getElementById('yunbi-gallery-hide');
    if (!st) { st = document.createElement('style'); st.id = 'yunbi-gallery-hide'; document.head.appendChild(st); }
    st.textContent = sels.map(function (s) { return s + '{display:none!important}'; }).join('');
  }
  function unhideNative() { var st = document.getElementById('yunbi-gallery-hide'); if (st) st.remove(); }

  function mountPoint() {
    var list = (R.mount_selector || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < list.length; i++) {
      var m = list[i].match(/^(before|after|replace|append):(.+)$/), mode = m ? m[1] : 'before', sel = m ? m[2] : list[i];
      var el = qs(sel);
      if (el) return { el: el, mode: mode };
    }
    return null;
  }

  function build() {
    var imgs = collect();
    if (imgs.length < 1) { dbg('kaynak görsel yok'); return false; }
    var mp = mountPoint();
    if (!mp) { dbg('mount hedefi yok'); return false; }
    images = withVideo(imgs); cur = 0;
    if (!host) {
      host = document.createElement('div'); host.id = 'yunbi-gallery';
      // Fotoğraf oranı modu: galeri çizilmeden önce temanın slider kutusu ne orandaysa onunla başla (yükseklik sıçramaz)
      try { var nb = sourceEl && sourceEl.getBoundingClientRect(); if (nb && nb.width > 50 && nb.height > 50) host.style.setProperty('--thr', Math.round(nb.width) + '/' + Math.round(nb.height)); } catch (e) {}
      host.style.cssText = 'display:block;width:100%;max-width:100%;clear:both;position:relative';
      root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    } else { while (root.firstChild) root.removeChild(root.firstChild); }
    var st = document.createElement('style'); st.textContent = css(); root.appendChild(st);
    var g = render(); root.appendChild(g); host._g = g;
    if (!host.isConnected) {
      if (mp.mode === 'after') mp.el.parentNode.insertBefore(host, mp.el.nextSibling);
      else if (mp.mode === 'append') mp.el.appendChild(host);
      else if (mp.mode === 'replace') { mp.el.parentNode.insertBefore(host, mp.el); }
      else mp.el.parentNode.insertBefore(host, mp.el);
    }
    clearTimeout(earlyTimer);
    hideNative();
    dbg('galeri kuruldu', images.length, 'görsel');
    send('view');
    return true;
  }

  /* Kaynak slider değişirse (renk/varyant seçimi, ajax yenileme) galeriyi tazele */
  function watch() {
    try {
      var target = sourceEl && sourceEl.parentElement ? sourceEl.parentElement : document.body;
      new MutationObserver(function () {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(function () {
          var n = withVideo(collect());
          var same = n.length === images.length && n.every(function (x, i) { return baseKey(x.full) === baseKey(images[i].full); });
          if (!same && n.length) { dbg('kaynak değişti → yeniden kur'); if (viewer) return; build(); }
        }, 250);
      }).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data-src'] });
    } catch (e) {}
  }

  function allowed() {
    if (!isProductPage()) return false;
    var d = R.devices || 'mobile';
    if (d === 'mobile' && !isMobileWidth()) return false;
    if (d === 'desktop' && isMobileWidth()) return false;
    var hp = (R.hide_paths || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < hp.length; i++) if (location.pathname.toLowerCase().indexOf(hp[i].toLowerCase()) === 0) return false;
    return true;
  }

  function init() {
    if (isProductPage()) videoTrack();
    if (isProductPage() && !isMobileWidth()) desktopVideo();
    if (!allowed()) { dbg('bu sayfada/cihazda kapalı'); return; }
    var tries = 0;
    (function attempt() {
      if (build()) { watch(); return; }
      if (++tries < 25) setTimeout(attempt, tries < 5 ? 150 : 400); // tema slider'ı geç çizilebilir
    })();
    var lastMode = isMobileWidth();
    window.addEventListener('resize', function () {
      var now = isMobileWidth();
      if (now === lastMode) return;
      lastMode = now;
      if (!allowed()) { if (host) { host.style.display = 'none'; unhideNative(); } }
      else { if (host) { host.style.display = 'block'; hideNative(); } else build(); }
    });
  }

  /* demo override (yalnız hub origin) */
  function demoOverride(c) {
    if (!IS_HUB) return c;
    try { var t = script.getAttribute('data-theme'); if (t) c.theme = Object.assign({}, c.theme, JSON.parse(t)); } catch (e) {}
    try { var r = script.getAttribute('data-rules'); if (r) c.rules = Object.assign({}, c.rules, JSON.parse(r)); } catch (e) {}
    return c;
  }

  /* ── Açılış: tema slider'ının bir an görünüp sonra galerinin gelmesini (flash) önlemek için
     (1) config localStorage'da 10 dk önbelleklenir → tekrar ziyaretlerde ağ beklemeden kurulur,
     (2) script çalışır çalışmaz tema slider'ı gizlenir; galeri 4 sn içinde kurulamazsa geri açılır. ── */
  var CK = 'yunbi_gallery_cfg_' + TENANT, CACHE_TTL = 600000;
  function readCache() { try { var v = JSON.parse(localStorage.getItem(CK) || 'null'); return v && v.t && Date.now() - v.t < CACHE_TTL ? v.c : null; } catch (e) { return null; } }
  function writeCache(c) { try { localStorage.setItem(CK, JSON.stringify({ t: Date.now(), c: c })); } catch (e) {} }
  var earlyHidden = false, earlyTimer = null;
  function earlyHide(rules) {
    if (IS_HUB || earlyHidden) return;
    var mw = (rules && rules.max_width) || 991, dev = (rules && rules.devices) || 'mobile';
    if (dev === 'mobile' && window.innerWidth > mw) return;
    if (dev === 'desktop' && window.innerWidth <= mw) return;
    // <head>'de çalışıyorsak gövde henüz yok: ürün sayfası olup olmadığı bilinemez → gizle, DOM hazır olunca ürün sayfası değilse hemen geri aç
    var loading = document.readyState === 'loading';
    if (!loading && !isProductPage()) return;
    if (loading) document.addEventListener('DOMContentLoaded', function () { if (!isProductPage()) { clearTimeout(earlyTimer); unhideNative(); } });
    earlyHidden = true;
    var sels = ((rules && rules.hide_selector) || '#divMobileImageList, .Images.imageZoomPreview, .leftImage .owl-dots').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var st = document.createElement('style'); st.id = 'yunbi-gallery-hide'; st.textContent = sels.map(function (x) { return x + '{visibility:hidden!important}'; }).join('');
    (document.head || document.documentElement).appendChild(st);
    earlyTimer = setTimeout(function () { if (!host) { unhideNative(); dbg('galeri kurulamadı → tema slider geri açıldı'); } }, 4000);
  }
  function start(c) {
    cfg = demoOverride(c); T = cfg.theme || {}; R = cfg.rules || {};
    if (vBucket() === 'B') hideThemeVideo(); // tema video kutusu bir an bile görünmesin
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
  var cached = readCache();
  if (cached && cached.enabled) { earlyHide(cached.rules); dbg('config önbellekten'); start(cached); }
  else if (!cached) earlyHide(null);
  fetch(API + '/config', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) {
      if (!c) return;
      writeCache(c);
      if (cached) return; // bu sayfa önbellekle kuruldu; taze config bir sonraki sayfada geçerli
      if (!c.enabled) { dbg('kapalı'); unhideNative(); return; }
      start(c);
    })
    .catch(function (e) { dbg('config hatası', e); if (!cached) unhideNative(); });
})();
