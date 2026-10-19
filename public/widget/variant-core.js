/*!
 * Yunbi "Beden Seçimi" (CRO) ÇEKİRDEK — ürün detay sayfasında beden/numara seçimini ve renk şeridini yönetir. Bağımsız (no deps).
 *
 * Doğrudan gömülmez: temadaki kalıcı yükleyici (widget/variant.js?v=4) bu dosyayı ?b=<sürüm> ile yükler;
 * sürüm (dosya değişiklik zamanı) /w/{slug}/variant/config'ten gelir → güncellemede temaya dokunmak gerekmez.
 *
 * Ne yapar (Ticimax ürün detay):
 *   1) Varsayılan seçimi kaldırır: tema sayfa açılınca stoktaki ilk bedeni kendiliğinden seçer; bu kapatılır,
 *      müşteri bedeni kendisi seçer (yanlış numarayla sipariş azalır). Renk satırı seçili kalır.
 *   2) Adresteki parametreyle seçer: ...?beden=38 → 38 numara seçili açılır (reklam / ürün feed'i linkleri).
 *      Beden stokta yoksa ya da bulunamazsa hiçbir şey seçilmez.
 *   3) Renk seçenekleri (v2): Trendyol tarzı küçük görsel şeridi — aktif renk çerçeveli, popüler renkler önde
 *      + "Popüler" etiketi, stoksuz renk soluk / sonda / gizli, "Renk: Lacivert" başlığı.
 *   4) Az kalan numara (v2): eşiğin altındaki numaralara "Son 2" rozeti.
 *
 * Nasıl: Ticimax'ın kendi anahtarları (urunDetay_varyasyonOtoSecili / urunDetay_varyasyonSecili) ve kendi
 * işlevleri (kutuya tıklama, ekSecenekListesiOlustur) kullanılır; seçim durumu temanın iç durumuyla tutarlı
 * kalır (seçim yokken sepete ekleme temanın "seçim yapın" uyarısını verir). Müşteri bir bedene dokunduktan
 * sonra betik bir daha karışmaz. Ayarlar panelden (CRO › Beden Seçimi); API düşerse sessizce hiçbir şey yapmaz.
 * Script etiketi <head> içinde ya da tema scriptlerinden ÖNCE durursa seçim hiç yanıp sönmeden gelir.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var TENANT = script.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiVariantLoaded) return; // aynı sayfada ikinci kopya (eski + yeni sürüm) çalışmaz
  window.__yunbiVariantLoaded = true;

  var BASE = new URL(script.src).origin;
  var API = BASE + '/w/' + encodeURIComponent(TENANT) + '/variant/config';
  var KEY = 'yunbi_variant_cfg_' + TENANT;
  var DEBUG = /[?&]yunbi_debug=1/.test(location.search);
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[yunbi-variant]'].concat([].slice.call(arguments))); }

  var cfg = null;        // {enabled, deselect, param}
  var touched = false;   // müşteri beden alanına dokundu → artık karışma
  var selectedByParam = false;
  var ROOT = '#divUrunEkSecenek';

  function readCache() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.c ? v.c : null; } catch (e) { return null; }
  }
  function writeCache(c) {
    try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), c: c })); } catch (e) { /* yok say */ }
  }

  function isProductPage() {
    return !!(window.productDetailModel || document.querySelector(ROOT));
  }

  /** Adresteki beden değeri (?beden=38); panelde parametre adı değiştirilebilir. */
  function wanted() {
    try {
      var p = new URLSearchParams(location.search);
      var v = p.get((cfg && cfg.param) || 'beden');
      return v ? String(v).trim() : '';
    } catch (e) { return ''; }
  }

  function variantTypeCount() {
    try {
      var seen = {}, n = 0, list = (window.productDetailModel && window.productDetailModel.productVariantData) || [];
      for (var i = 0; i < list.length; i++) { if (!seen[list[i].tipID]) { seen[list[i].tipID] = 1; n++; } }
      return n;
    } catch (e) { return 0; }
  }

  /**
   * Temanın otomatik seçim anahtarları. Tema scriptlerinden ÖNCE çalışırsa beden hiç seçilmeden gelir;
   * sonra çalışırsa da gerekli: beden satırı yeniden çizildiğinde ilk beden yine seçilmesin.
   * Tek varyasyon türü (yalnız beden) olan üründe ilk satırın seçimi de kapatılır.
   */
  function setFlags() {
    if (!cfg || !cfg.enabled || !cfg.deselect) return;
    window.urunDetay_varyasyonOtoSecili = false;
    if (variantTypeCount() <= 1) window.urunDetay_varyasyonSecili = false;
  }

  function lines() {
    return [].slice.call(document.querySelectorAll(ROOT + ' div.eksecenekLine'));
  }

  /** Beden satırı: başlığında beden/numara geçen satır, yoksa son satır (renk önce, beden sonra çizilir). */
  function sizeLine(ls) {
    for (var i = ls.length - 1; i >= 0; i--) {
      var lab = ls[i].querySelector('.left_line');
      if (lab && /beden|numara|size/i.test(lab.textContent || '')) return ls[i];
    }
    return ls[ls.length - 1];
  }

  /** Kutunun kendi metni (stoksuz kutuda "gelince haber ver" düğmesi alt öğe olarak durur). */
  function boxText(el) {
    var s = '';
    for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeType === 3) s += el.childNodes[i].nodeValue; }
    return (s || el.textContent || '').trim();
  }
  function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }

  /** Varsayılan (otomatik) beden seçimini kaldırır. true = iş bitti / gerek yok, false = satırlar henüz yok. */
  function deselect() {
    var ls = lines();
    if (!ls.length) return false;
    var line = sizeLine(ls);
    var sel = line.querySelector('select');
    var hasBox = !!line.querySelector('.size_box.selected');
    var hasSel = !!(sel && sel.value && sel.value !== '-1' && sel.selectedIndex > 0);
    if (!hasBox && !hasSel) return true;

    setFlags();
    var idx = ls.indexOf(line);
    if (idx > 0 && typeof window.ekSecenekListesiOlustur === 'function') {
      // Önceki satırdan (renk) sonrasını tema kendi işleviyle yeniden çizer → beden satırı seçimsiz gelir
      window.ekSecenekListesiOlustur(ls[idx - 1]);
    } else {
      [].forEach.call(line.querySelectorAll('.size_box.selected'), function (b) { b.classList.remove('selected'); });
      if (sel) { sel.selectedIndex = 0; }
      var h = document.getElementById('hddnUrunID');
      if (h) h.value = 0; // temanın "seçim yapılmadı" durumu: sepete eklemede uyarı verir
    }
    dbg('varsayılan seçim kaldırıldı');
    return true;
  }

  /** Adresteki bedeni seçer: 'ok' | 'nostock' | 'notfound' | 'wait' */
  function selectSize(val) {
    var ls = lines();
    if (!ls.length) return 'wait';
    var line = sizeLine(ls), want = norm(val), i;
    var boxes = line.querySelectorAll('.size_box');
    for (i = 0; i < boxes.length; i++) {
      if (norm(boxText(boxes[i])) !== want) continue;
      if (boxes[i].classList.contains('nostok') || parseInt(boxes[i].getAttribute('data-stock') || '1', 10) <= 0) return 'nostock';
      if (!boxes[i].classList.contains('selected')) boxes[i].click(); // temanın kendi tıklama işleyicisi çalışır
      return 'ok';
    }
    var sel = line.querySelector('select');
    if (sel) {
      for (i = 0; i < sel.options.length; i++) {
        if (norm(sel.options[i].text) !== want) continue;
        if (sel.options[i].getAttribute('noStock') !== null) return 'nostock';
        if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        return 'ok';
      }
    }
    return boxes.length || sel ? 'notfound' : 'wait';
  }

  /** Tek adım: true = yapılacak iş kalmadı. */
  function act() {
    if (!cfg || !cfg.enabled || touched) return true;
    if (!isProductPage()) return true;
    var val = wanted();
    if (val) {
      var r = selectSize(val);
      dbg('adres bedeni', val, '→', r);
      if (r === 'wait') return false;
      if (r === 'ok') { selectedByParam = true; return true; }
      // bulunamadı / stokta yok → seçimsiz bırak (ayar açıksa)
    }
    if (cfg.deselect && !selectedByParam) return deselect();
    return true;
  }

  /**
   * Tema ürün detayı iki kez kurar (script yüklenirken + sayfa hazır olunca) ve her seferinde ilk satırı
   * yeniden seçer; bu yüzden işlem sayfa hazır olduktan SONRA ve birkaç kez (aynı sonuca varan) çalıştırılır.
   */
  function schedule() {
    var tries = 0;
    var tick = function () {
      if (touched) return;
      var done = false;
      try { done = act(); } catch (e) { dbg('hata', e); done = true; }
      if (!done && ++tries < 60) setTimeout(tick, 100);
    };
    var later = function () { setTimeout(tick, 30); setTimeout(tick, 400); setTimeout(tick, 1200); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else later();
    window.addEventListener('load', function () { setTimeout(tick, 50); });
  }

  // Müşteri beden alanına dokunduysa bir daha karışma
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (e.isTrusted && e.target && e.target.closest && e.target.closest(ROOT)) touched = true;
    }, { capture: true, passive: true }); // passive: sayfa genelindeki dokunma dinleyicisi kaydırmayı/galeri geçişini bekletmesin (iOS)
  });

  /* ───────────── Renk seçenekleri + az kalan numara (v2) ─────────────
   * Renk seçenekleri: temanın "Renk Seçenekleri" bloğundaki diğer renk ürünlerini (her renk ayrı ürün kartı)
   * okur, kendi küçük görsel şeridini çizer (shadow DOM): aktif renk çerçeveli, popüler renkler önde +
   * "Popüler" etiketi, stoksuz renk soluk / sonda / gizli. Tema bloğu DOM'da kalır, yalnız gizlenir.
   * Az kalan numara: sayfadaki ürünün eşiğin altındaki numaralarına "Son 2" rozeti (stok mağaza verisinden).
   * Sıra / popülerlik / stok sunucudan gelir (/w/{slug}/variant/data); satış ve stok adedi dışarı verilmez. */
  var ui = null, uiData = null, uiFetchedFor = '', colorHost = null, lowObs = null, lowTimer = null, lastColors = null;

  function curId() {
    try { return String((window.productDetailModel && window.productDetailModel.productId) || ''); } catch (e) { return ''; }
  }

  function colorContainer() {
    var sel = (ui && ui.colors && ui.colors.selector) || '#productDetailRelated';
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function readColorItems(box) {
    var out = [], seen = {};
    [].forEach.call(box.querySelectorAll('a[href]'), function (a) {
      var img = a.querySelector('img');
      if (!img) return;
      var href = a.getAttribute('href') || '';
      var id = a.getAttribute('data-id') || ((href.match(/-(\d+)(?:[?#/]|$)/) || [])[1]) || '';
      if (!id || seen[id]) return;
      seen[id] = 1;
      // Tema görselleri geç yükler: src önce "yükleniyor" gif'i / boş görsel olur (4 Eki: şeritte dönen simge) → gerçek adres data-* özniteliğinde
      var lazy = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy') || '';
      var cur = img.currentSrc || img.getAttribute('src') || '';
      var ph = !cur || cur.indexOf('data:') === 0 || /loading|loader|placeholder|blank|spinner|lazy|\.gif(\?|$)/i.test(cur);
      var src = ph ? (lazy || cur) : cur;
      out.push({ id: String(id), href: a.href, img: src, title: a.getAttribute('title') || img.getAttribute('alt') || '' });
    });
    return out;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function themeFont() {
    var el = document.querySelector(ROOT + ' .size_box') || document.querySelector('.ProductName, .productName, h1') || document.body;
    try { return getComputedStyle(el).fontFamily || 'inherit'; } catch (e) { return 'inherit'; }
  }

  function colorCss(c) {
    var w = Math.max(44, Math.min(110, +c.thumb_width || 64)), r = Math.max(0, Math.min(24, +c.radius || 10));
    // original: fotoğrafın kendi oranı (yükseklik serbest, kırpma yok); square: kare; portrait: 3:4 dikey kutu
    var orig = c.aspect === 'original', h = c.aspect === 'square' ? w : Math.round(w * 1.34);
    var acc = /^#[0-9a-f]{6}$/i.test(c.accent || '') ? c.accent : '#f27a1a';
    return ':host{all:initial;display:block;font-family:inherit}*{box-sizing:border-box}' +
      '.w{font-family:inherit;margin:0 0 12px;padding-top:12px;border-top:1px solid #eee;color:#333}' +
      '@media (min-width:769px){.w{border-top:0}}' + // masaüstünde çizgi yok, boşluk kalır
      '.w,.w *{font-family:inherit;letter-spacing:inherit}' +
      '.lb{font-size:15px;margin:0 0 8px;line-height:1.3;display:flex;justify-content:space-between;align-items:baseline;gap:8px}.lb b{font-weight:700}.lb .c{font-size:13px;color:#888;white-space:nowrap}' +
      '.lw{position:relative}' +
      '.l{display:flex;flex-wrap:wrap;gap:10px;padding-top:9px}' +
      '.rt{display:flex;align-items:center;gap:8px}.ars{display:none;gap:6px}.ars.v{display:inline-flex}' +
      '.ar{width:28px;height:28px;border-radius:50%;border:1px solid #ddd;background:#fff;font:20px/24px Arial,sans-serif;color:#333;cursor:pointer;padding:0;opacity:.35}' +
      '.ar.v{opacity:1}' +
      // Mobil: yana kaydırmalı; ekrana 4,4 görsel sığar (sonuncusu yarım görünür → kaydırılabildiği anlaşılır) + sağ kenarda solma
      '@media (max-width:640px){.l{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:2px;' +
        '-webkit-mask-image:linear-gradient(90deg,#000 82%,transparent);mask-image:linear-gradient(90deg,#000 82%,transparent)}.l.e{-webkit-mask-image:none;mask-image:none}.l::-webkit-scrollbar{display:none}' +
        '.i{flex:0 0 calc((100% - 40px) / 4.4) !important;width:auto !important}.f{width:100% !important;' + (orig ? '' : 'height:auto !important;aspect-ratio:' + (c.aspect === 'square' ? '1/1' : '3/4') + ';') + '}' +
        '.m{flex:0 0 calc((100% - 40px) / 4.4) !important;width:auto !important;height:auto !important;aspect-ratio:3/4}}' +
      '.i{position:relative;flex:0 0 auto;width:' + w + 'px;text-decoration:none;color:inherit;display:block}' +
      '.f{display:block;position:relative;width:' + w + 'px;' + (orig ? '' : 'height:' + h + 'px;') + 'border:1px solid #e3e3e3;border-radius:' + r + 'px;overflow:hidden;background:#f6f6f6;transition:border-color .15s}' +
      '.i:hover .f{border-color:#bdbdbd}' +
      (orig ? '.l{align-items:flex-start}.f img{width:100%;height:auto;display:block}.l.r .f{height:auto!important}.l.r .f img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' : '.f img{width:100%;height:100%;object-fit:cover;display:block}') +
      '.i.a .f{border:2px solid ' + acc + '}' +
      '.b{position:absolute;top:-9px;left:50%;transform:translateX(-50%);z-index:2;font-size:11px;font-weight:700;line-height:16px;padding:0 6px;border-radius:6px;white-space:nowrap;color:' + acc + ';background:#fff;border:1px solid ' + acc + '40;box-shadow:0 1px 2px rgba(0,0,0,.04)}' +
      '.i.o .f{opacity:.45}.i.o .f:after{content:"";position:absolute;left:-10%;top:50%;width:120%;height:1px;background:#999;transform:rotate(-55deg)}' +
      '.n{display:block;font-size:11px;line-height:1.25;color:#666;margin-top:4px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.i.a .n{color:#222;font-weight:600}' +
      '.m{flex:0 0 auto;width:' + w + 'px;height:' + (orig ? w : h) + 'px;border:1px dashed #cfcfcf;border-radius:' + r + 'px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#555;background:#fff;cursor:pointer}';
  }

  function renderColors() {
    var c = ui && ui.colors;
    if (!c || !c.enabled || !uiData) return;
    var box = colorContainer();
    if (!box) { dbg('renk bloğu bulunamadı'); return; }
    var items = readColorItems(box), cid = curId(), byId = {}, i;
    for (i = 0; i < items.length; i++) byId[items[i].id] = items[i];
    if (cid && !byId[cid] && uiData.current && uiData.current.image) {
      var cu = { id: cid, href: location.href.split('?')[0], img: uiData.current.image, title: '' };
      items.unshift(cu); byId[cid] = cu;
    }
    if (items.length < 2) { dbg('tek renk, şerit çizilmedi'); return; }

    var oos = {}, pop = {};
    (uiData.oos || []).forEach(function (x) { oos[x] = 1; });
    (uiData.popular || []).forEach(function (x) { pop[x] = 1; });
    // Sıra: sunucunun sırası (popüler önde) → sayfada olup sunucuda olmayanlar sonda
    var order = [], used = {};
    (c.sort === 'popular' ? (uiData.order || []) : []).forEach(function (x) { if (byId[x] && !used[x]) { order.push(byId[x]); used[x] = 1; } });
    items.forEach(function (it) { if (!used[it.id]) { order.push(it); used[it.id] = 1; } });
    if (c.out_of_stock === 'hide') order = order.filter(function (it) { return !oos[it.id] || it.id === cid; });
    if (c.out_of_stock === 'end') order = order.filter(function (it) { return !oos[it.id]; }).concat(order.filter(function (it) { return oos[it.id]; }));
    if (c.popular_first !== false) order = order.filter(function (it) { return pop[it.id]; }).concat(order.filter(function (it) { return !pop[it.id]; }));
    if (c.active_first) order = order.filter(function (it) { return it.id === cid; }).concat(order.filter(function (it) { return it.id !== cid; }));
    lastColors = { order: order, cid: cid, oos: oos, pop: pop };

    var names = uiData.color || {};
    var maxV = +c.max_visible || 0;
    var html = '<div class="w">';
    var arrows = c.arrows !== false ? '<span class="ars"><button class="ar al" type="button" aria-label="Önceki renkler">&#8249;</button><button class="ar ac" type="button" aria-label="Sonraki renkler">&#8250;</button></span>' : '';
    var count = c.count_text ? '<span class="c">' + esc(String(c.count_text).replace('{n}', order.length)) + '</span>' : '';
    if (c.show_label) html += '<div class="lb"><span><b>' + esc(c.label_text || 'Renk') + ':</b> ' + esc(names[cid] || '') + '</span><span class="rt">' + count + arrows + '</span></div>';
    else if (count || arrows) html += '<div class="lb"><span></span><span class="rt">' + count + arrows + '</span></div>';
    html += '<div class="lw"><div class="l">';
    order.forEach(function (it, k) {
      var nm = names[it.id] || '';
      var cls = 'i' + (it.id === cid ? ' a' : '') + (oos[it.id] ? ' o' : '');
      var hide = maxV > 0 && k >= maxV && it.id !== cid;
      html += '<a class="' + cls + '" href="' + esc(it.href) + '" title="' + esc(nm || it.title) + (oos[it.id] ? ' (tükendi)' : '') + '"' + (hide ? ' data-x="1" style="display:none"' : '') + (it.id === cid ? ' aria-current="true"' : '') + '>';
      if (pop[it.id]) html += '<span class="b">' + esc(c.badge_text || 'Popüler') + '</span>';
      html += '<span class="f"><img src="' + esc(it.img) + '" alt="' + esc(nm || it.title) + '" loading="lazy"></span>';
      if (c.show_names) html += '<span class="n">' + esc(nm) + '</span>';
      html += '</a>';
    });
    var hidden = maxV > 0 ? order.filter(function (it, k) { return k >= maxV && it.id !== cid; }).length : 0;
    if (hidden > 0) html += '<span class="m" role="button" tabindex="0">+' + hidden + '</span>';
    html += '</div></div></div>';

    if (!colorHost || !colorHost.isConnected) {
      var old = document.getElementById('yunbi-variant-colors');
      if (old) old.remove();
      colorHost = document.createElement('div');
      colorHost.id = 'yunbi-variant-colors';
      colorHost.style.cssText = 'display:block;width:100%;max-width:100%;flex:0 0 100%;clear:both;padding-top:14px';  // üstteki 'BÜYÜK İNDİRİM' etiketi yüzen (float) blokta: clear:both olan öğede margin-top yutulur → padding + çizgi içeride // flex/float ebeveynde tam satır
      // Yazı tipi temanın kendisinden (beden kutusu / ürün adı) — shadow DOM sıfırlamasına karşı
      box.parentNode.insertBefore(colorHost, box);
      colorHost.attachShadow({ mode: 'open' });
    }
    colorHost.style.fontFamily = themeFont();
    colorHost.shadowRoot.innerHTML = '<style>' + colorCss(c) + '</style>' + html;
    // Kaydırma sonuna gelince sağ kenardaki solma kalkar
    var list = colorHost.shadowRoot.querySelector('.l');
    var arL = colorHost.shadowRoot.querySelector('.al'), arR = colorHost.shadowRoot.querySelector('.ac');
    var edge = function () {
      if (!list) return;
      var scrollable = list.scrollWidth > list.clientWidth + 4, atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 4;
      list.classList.toggle('e', atEnd);
      if (arR) arR.classList.toggle('v', scrollable && !atEnd);
      if (arL) arL.classList.toggle('v', scrollable && list.scrollLeft > 4);
      var grp = colorHost.shadowRoot.querySelector('.ars');
      if (grp) grp.classList.toggle('v', scrollable); // kaydırılacak renk yoksa oklar hiç görünmez
    };
    if (c.aspect === 'original' && list) {
      // Ortanca fotoğraf oranı tüm kutulara uygulanır, aykırı fotoğraf kutuyu doldurur (4 Eki: seçili renk kutusu kısa görünüyordu)
      var imgs = [].slice.call(colorHost.shadowRoot.querySelectorAll('.f img'));
      var fixRatio = function () {
        var rs = imgs.map(function (im) { return im.naturalWidth ? im.naturalHeight / im.naturalWidth : 0; }).filter(Boolean).sort(function (x, y) { return x - y; });
        if (!rs.length) return;
        var med = rs[Math.floor(rs.length / 2)];
        [].forEach.call(colorHost.shadowRoot.querySelectorAll('.f'), function (f) { f.style.aspectRatio = '1 / ' + med.toFixed(3); });
        list.classList.add('r');
      };
      imgs.forEach(function (im) { if (!im.complete) im.addEventListener('load', fixRatio); });
      fixRatio();
    }
    if (list) { list.addEventListener('scroll', edge, { passive: true }); setTimeout(edge, 50); setTimeout(edge, 600); window.addEventListener('resize', edge); }
    if (arR) arR.addEventListener('click', function () { list.scrollBy({ left: list.clientWidth * 0.8, behavior: 'smooth' }); });
    if (arL) arL.addEventListener('click', function () { list.scrollBy({ left: -list.clientWidth * 0.8, behavior: 'smooth' }); });
    [].forEach.call(colorHost.shadowRoot.querySelectorAll('a.i'), function (a, k) {
      a.addEventListener('click', function () { track('color_click', a.title || ''); });
      var pre = function () { var it = order[k]; if (it && it.id !== cid) prefetchData(it.id, items.map(function (x) { return x.id; })); };
      a.addEventListener('touchstart', pre, { passive: true });
      a.addEventListener('mousedown', pre);
    });
    var more = colorHost.shadowRoot.querySelector('.m');
    if (more) more.addEventListener('click', function () {
      [].forEach.call(colorHost.shadowRoot.querySelectorAll('[data-x]'), function (a) { a.style.display = ''; });
      more.remove();
    });
    box.style.display = 'none';
    box.setAttribute('data-yunbi-hidden', '1');
    dbg('renk şeridi çizildi', order.length, 'renk');
  }

  function unrenderColors() {
    if (colorHost) { colorHost.remove(); colorHost = null; }
    var box = document.querySelector('[data-yunbi-hidden="1"]');
    if (box) { box.style.display = ''; box.removeAttribute('data-yunbi-hidden'); }
  }

  function lowStyle(l) {
    var col = /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color : '#d93025';
    var st = document.getElementById('yunbi-variant-low-css');
    if (!st) { st = document.createElement('style'); st.id = 'yunbi-variant-low-css'; (document.head || document.documentElement).appendChild(st); }
    st.textContent = ROOT + ' .size_box.yunbi-has-low{position:relative;overflow:visible}' +
      ROOT + ' .yunbi-low{position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);z-index:2;font-size:9.5px;font-weight:700;line-height:13px;padding:0 4px;border-radius:6px;white-space:nowrap;pointer-events:none;' +
      'color:' + col + ';background:#fff;border:1px solid ' + col + '55}';
  }

  function applyLow() {
    var l = ui && ui.low_stock;
    if (!l || !l.enabled || !uiData) return;
    var low = uiData.low || {}, tpl = String(l.text || 'Son {n}');
    var ls = lines();
    if (!ls.length) return;
    var line = sizeLine(ls);
    [].forEach.call(line.querySelectorAll('.size_box'), function (b) {
      var n = low[boxText(b)];
      var has = b.querySelector('.yunbi-low');
      if (!n || b.classList.contains('nostok')) { if (has) { has.remove(); b.classList.remove('yunbi-has-low'); } return; }
      var txt = tpl.replace('{n}', n);
      if (has) { if (has.textContent !== txt) has.textContent = txt; return; }
      var s = document.createElement('span');
      s.className = 'yunbi-low'; s.textContent = txt;
      b.classList.add('yunbi-has-low'); b.appendChild(s);
    });
  }

  function watchLow() {
    var l = ui && ui.low_stock;
    if (!l || !l.enabled) return;
    lowStyle(l);
    applyLow();
    var root = document.querySelector(ROOT);
    if (!root || lowObs || !window.MutationObserver) return;
    // Renk / beden satırı tema tarafından yeniden çizilince rozetler yeniden eklenir
    lowObs = new MutationObserver(function () { clearTimeout(lowTimer); lowTimer = setTimeout(applyLow, 40); });
    lowObs.observe(root, { childList: true, subtree: true });
  }

  /* ───────────── Ölçüm + A/B ───────────── */
  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'x' + Math.random().toString(36).slice(2, 10); }
  })();
  var tracked = {};

  /** A/B kovası: A = mobil seçim paneli açık, B = kapalı. Ziyaretçiye sabit (oturum kimliğinden). */
  // Grubu elle sabitleme (mağaza sahibi/test): ?yunbi_ab=A veya ?yunbi_ab=B bu tarayıcıda kalıcı, ?yunbi_ab=off kaldırır
  var FORCED = (function () {
    try {
      var m = /[?&]yunbi_ab=(A|B|off)\b/i.exec(location.search), k = 'yunbi_variant_ab_force';
      if (m) { if (m[1].toLowerCase() === 'off') localStorage.removeItem(k); else localStorage.setItem(k, m[1].toUpperCase()); }
      return localStorage.getItem(k) || '';
    } catch (e) { return ''; }
  })();
  function bucket() {
    var ab = ui && ui.ab;
    if (!ab || !ab.enabled) return 'A';
    if (FORCED === 'A' || FORCED === 'B') return FORCED;
    var h = 0, k = SID + '|variant-sheet';
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return (Math.abs(h) % 100) < (+ab.share || 50) ? 'A' : 'B';
  }
  function isMobile() {
    var bp = (ui && ui.sheet && +ui.sheet.breakpoint) || 768;
    try { return window.matchMedia('(max-width:' + bp + 'px)').matches; } catch (e) { return window.innerWidth <= bp; }
  }
  function track(type, v, once) {
    if (once) { if (tracked[type]) return; tracked[type] = 1; }
    try {
      var body = JSON.stringify({ type: type, pid: +curId() || 0, v: v == null ? '' : String(v).slice(0, 120), b: bucket(), dev: isMobile() ? 'm' : 'd', sid: SID, test: (TEST || DEBUG) ? 1 : 0 });
      var u = BASE + '/w/' + encodeURIComponent(TENANT) + '/variant/event';
      if (navigator.sendBeacon) navigator.sendBeacon(u, new Blob([body], { type: 'text/plain' }));
      else fetch(u, { method: 'POST', body: body, keepalive: true, credentials: 'omit' });
    } catch (e) { /* sessiz */ }
  }

  /* ───────────── Mobil seçim paneli (Trendyol uygulaması gibi) ─────────────
   * Sayfada beden ızgarası yerine "Beden: Seçiniz ⌄" satırı; satıra ya da numara seçmeden "Sepete Ekle"ye
   * basınca alttan panel açılır: görsel, ad, fiyat, kargo, renkler, "Beden (Seçili: 38)" ızgarası, kalıp
   * tavsiyesi, stoksuz numarada "Gelince Haber Ver" + o numarası stokta benzer ürünler, Sepete Ekle / Şimdi Al.
   * Temanın kendi işlevleri kullanılır: numara seçimi temanın kutusuna tıklanarak, sepete ekleme
   * sepeteEkleUrunDetay() ile; "seçim yapın" uyarısı (varyasyonUyari) panel açılışına çevrilir. */
  var sheetHost = null, rowHost = null, sheetSel = '', sheetOpen = false, hooked = false, sheetObs = null, simReq = 0, popSelf = false, openedAt = 0;
  /** Mobilde tek dokunuş iki tıklama olarak gelebiliyor (temanın dokunma kütüphanesi + tarayıcının kendi tıklaması;
   *  4 Eki kaydı: aynı saniyede 2 renk tıklaması). İkinci tıklama yeni açılan panelin karartmasına düşüp paneli
   *  kapatıyordu ('bedene tıklıyorum açılmıyor'). Her eylem 500 ms içinde bir kez çalışır; açılıştan sonra 500 ms
   *  kapatma yok sayılır. */
  function oneTap(fn) { var last = 0; return function (e) { var n = Date.now(); if (n - last < 500) return; last = n; return fn.call(this, e); }; }
  function canClose() { return Date.now() - openedAt > 500; }

  function sheetActive() {
    return !!(ui && ui.sheet && ui.sheet.enabled && bucket() === 'A' && isMobile() && isProductPage() && lines().length);
  }
  function sizeBoxes() {
    var ls = lines();
    return ls.length ? [].slice.call(sizeLine(ls).querySelectorAll('.size_box')) : [];
  }
  function themeSelected() {
    var b = sizeBoxes().filter(function (x) { return x.classList.contains('selected'); })[0];
    return b ? boxText(b) : '';
  }
  function boxFor(t) {
    return sizeBoxes().filter(function (x) { return boxText(x) === t; })[0] || null;
  }
  function isOos(b) { return !b || b.classList.contains('nostok') || parseInt(b.getAttribute('data-stock') || '1', 10) <= 0; }
  function accent() { var a = ui && ui.colors && ui.colors.accent; return /^#[0-9a-f]{6}$/i.test(a || '') ? a : '#f27a1a'; }
  function txt(sel) { var e = document.querySelector(sel); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  /**
   * Hafif "numara seçin" uyarısı — temanın uyarısı (urunsecoverlay: tüm sayfayı %50 siyahla örten sabit katman)
   * yerine. O katman açıkken kaydırınca tarayıcı arkadaki büyük ürün fotoğraflarını üst üste binmiş gibi çiziyordu
   * (3 Eki şikâyeti) ve varsayılan seçim kaldırıldığı için sık çıkıyordu. Burada: numara satırına kaydır, satırı
   * kısa salla, altında kırmızı "Lütfen numara seçin" yazısı. Temanın "seçince otomatik sepete ekle" davranışı korunur.
   */
  function lightAlert() {
    var ls = lines();
    if (!ls.length) return false;
    var line = sizeLine(ls);
    var st = document.getElementById('yunbi-variant-alert-css');
    if (!st) {
      st = document.createElement('style'); st.id = 'yunbi-variant-alert-css';
      st.textContent = ROOT + ' .eksecenekLine.yunbi-need{animation:yunbi-need .45s}' +
        '@keyframes yunbi-need{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}' +
        '.yunbi-need-msg{color:#d93025;font-size:13px;font-weight:600;margin:6px 0 2px}';
      (document.head || document.documentElement).appendChild(st);
    }
    var target = rowHost && rowHost.isConnected ? rowHost : line;
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* yok say */ }
    line.classList.remove('yunbi-need'); void line.offsetWidth; line.classList.add('yunbi-need');
    var msg = document.getElementById('yunbi-need-msg');
    if (!msg) { msg = document.createElement('div'); msg.id = 'yunbi-need-msg'; msg.className = 'yunbi-need-msg'; }
    msg.textContent = 'Lütfen numara seçin';
    var root = document.querySelector(ROOT);
    if (root && msg.parentNode !== root.parentNode) root.parentNode.insertBefore(msg, root.nextSibling);
    clearTimeout(lightAlert.t);
    lightAlert.t = setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); line.classList.remove('yunbi-need'); }, 3500);
    // seçim yapılınca yazı hemen kalksın
    var off = function (e) { if (e.target && e.target.closest && e.target.closest(ROOT + ' .size_box')) { if (msg.parentNode) msg.parentNode.removeChild(msg); document.removeEventListener('click', off, true); } };
    document.addEventListener('click', off, true);
    track('alert', '', false);
    return true;
  }

  function hookTheme() {
    if (hooked) return;
    hooked = true;
    var warn = window.varyasyonUyari;
    if (typeof warn === 'function') {
      window.varyasyonUyari = function () {
        if (sheetActive()) {
          openSheet('cart');
          // tema uyarıdan SONRA "seçilince otomatik sepete ekle"yi açar; panelde kullanıcı kendisi ekler
          setTimeout(function () { try { window.otomatikSepeteEkle = false; } catch (e) { /* yok say */ } }, 0);
          return;
        }
        if (!(ui && ui.page && ui.page.light_alert === false) && lightAlert()) return;
        return warn.apply(this, arguments);
      };
    }
    var add = window.sepeteEkleUrunDetay;
    if (typeof add === 'function') {
      window.sepeteEkleUrunDetay = function () {
        var h = document.getElementById('hddnUrunID');
        if (h && +h.value > 0) track('add_cart', themeSelected());
        return add.apply(this, arguments);
      };
    }
    // Panelin geçmiş kaydı temaya ulaşmaz: temanın onpopstate'i (quickViewV2) durum varsa ürün detayını AJAX ile
    // yeniden yüklüyor, adreste '?' varsa n.path[0] ile çöküyordu (4 Eki). Yakalama aşamasında durdurulur.
    var mine = function (e) {
      if (popSelf) { popSelf = false; return true; }
      if (sheetOpen) { closeSheet(true); return true; }
      return false;
    };
    // Başka bir betik temanın işleyicisini olaydan bağımsız da çağırabiliyor → 400 ms'lik kilit de konur
    var skipUntil = 0;
    var guard = function (e) { if ((e && e.yunbiSkip) || Date.now() < skipUntil) return true; if (mine(e)) { skipUntil = Date.now() + 400; if (e) e.yunbiSkip = true; return true; } return false; };
    window.addEventListener('popstate', function (e) { if (guard(e)) e.stopImmediatePropagation(); }, true);
    var op = window.onpopstate;
    if (typeof op === 'function') window.onpopstate = function (e) { if (guard(e)) return; return op.apply(this, arguments); };
  }

  /* Sayfadaki satır: tema beden ızgarası gizlenir, yerine "Beden: Seçiniz ⌄" */
  var rowHtml = '';
  /**
   * Sayfa satırı. DİKKAT: tema kutusunun sınıfı değişince gözlemci tetiklenir; burada DOM'a yalnız GEREKİRSE
   * dokunulur (sınıf zaten doğruysa yazılmaz, satır içeriği aynıysa yeniden çizilmez) — yoksa kendi
   * değişikliğimiz gözlemciyi yeniden tetikler ve satır her 60 ms'de yeniden çizilir (3 Eki hatası:
   * dokunuş yeni çizilen satıra denk gelmiyor, panel açılmıyordu).
   */
  function applyPageRow() {
    var root = document.querySelector(ROOT);
    var on = sheetActive() && ui.sheet.page_row;
    var st = document.getElementById('yunbi-variant-sheet-css');
    if (!st) { st = document.createElement('style'); st.id = 'yunbi-variant-sheet-css'; st.textContent = ROOT + ' .eksecenekLine.yunbi-sz-hide{display:none!important}'; (document.head || document.documentElement).appendChild(st); }
    var ls = lines(), target = on && ls.length ? sizeLine(ls) : null;
    ls.forEach(function (l) {
      var want = l === target;
      if (l.classList.contains('yunbi-sz-hide') !== want) l.classList.toggle('yunbi-sz-hide', want);
    });
    if (!target || !root) { if (rowHost) { rowHost.remove(); rowHost = null; rowHtml = ''; } return; }
    if (!rowHost) {
      rowHost = document.createElement('div');
      rowHost.id = 'yunbi-variant-row';
      rowHost.style.cssText = 'display:block;width:100%;clear:both;margin:0 0 12px;padding-top:12px;border-top:1px solid #eee;cursor:pointer';
      rowHost.attachShadow({ mode: 'open' });
      rowHost.addEventListener('click', oneTap(function () { if (!sheetOpen) openSheet('row'); }));
      rowHtml = '';
    }
    if (rowHost.nextSibling !== root) root.parentNode.insertBefore(rowHost, root);
    var sel = themeSelected(), fit = uiData && uiData.fit;
    var html = '<style>:host{all:initial;display:block;font-family:inherit}*{box-sizing:border-box;font-family:inherit}' +
      '.r{display:flex;align-items:center;gap:14px;cursor:pointer}.t{font-size:16px;font-weight:700;color:#222;min-width:58px}' +
      '.s{flex:1;display:flex;justify-content:space-between;align-items:center;height:46px;padding:0 14px;border:1px solid #ddd;border-radius:8px;background:#f7f7f7;font-size:15px;color:' + (sel ? '#222' : '#888') + '}' +
      '.s svg{width:16px;height:16px;flex:0 0 auto}.ft{margin-top:7px;font-size:12px;color:#777;display:flex;gap:6px;align-items:center}.ft i{font-style:normal;color:' + accent() + '}</style>' +
      '<div class="r" role="button" tabindex="0"><span class="t">' + esc(ui.sheet.title_text || 'Beden') + '</span><span class="s">' + esc(sel || 'Seçiniz') +
      '<svg viewBox="0 0 16 16" fill="none" stroke="#444" stroke-width="1.6"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg></span></div>' +
      (fit && fit.text ? '<div class="ft"><i>&#9432;</i>' + esc(fit.text) + '</div>' : '');
    if (html !== rowHtml) {
      rowHtml = html;
      rowHost.style.fontFamily = themeFont();
      rowHost.shadowRoot.innerHTML = html;
      window.__yunbiRowRenders = (window.__yunbiRowRenders || 0) + 1;
    }
    if (fit && fit.text) track('fit_shown', fit.key, true);
  }

  function sheetCss() {
    var a = accent();
    return ':host{all:initial;font-family:inherit}*{box-sizing:border-box;font-family:inherit}' +
      '.ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483600;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s,visibility 0s .25s}' +
      '.sh{position:fixed;left:0;right:0;bottom:0;z-index:2147483601;background:#fff;border-radius:16px 16px 0 0;max-height:88vh;display:flex;flex-direction:column;overflow:visible;' +
        'transform:translateY(100%);transition:transform .25s ease,visibility 0s .25s;padding:16px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.18);color:#222}' +
      // kapalıyken katman ve panel dokunuş yutmasın (4 Eki: kapatınca görünmez katman tüm sayfayı kilitliyordu)
      '.sh{visibility:hidden;pointer-events:none}.on .ov,.on .sh{visibility:visible;pointer-events:auto;transition-delay:0s}.on .ov{opacity:1}.on .sh{transform:none}' +
      '.hd{display:flex;gap:12px;align-items:flex-start;padding-right:28px;position:relative;margin:0 16px 4px;flex:0 0 auto}' +
      // başlık ve butonlar sabit, arası kayar (uzun panelde × ve Sepete Ekle hep görünür)
      '.bd{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 16px 6px}' +
      '.im{width:118px;flex:0 0 118px;border:1px solid #eee;border-radius:8px;overflow:hidden;background:#f6f6f6}.im img{width:100%;height:auto;display:block}' +
      '.nm{font-size:14px;line-height:1.35;color:#333;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.pr{margin-top:8px;display:flex;flex-direction:column;gap:3px}.pr b{font-size:24px;line-height:1.15;color:' + a + '}.pr s{font-size:14px;color:#999}' +
      '.po{display:flex;align-items:center;gap:6px}.pc{background:' + a + ';color:#fff;font-size:12px;font-weight:700;line-height:18px;padding:0 6px;border-radius:4px}' +
      '.pl{margin-top:6px;font-size:12px;font-weight:800;letter-spacing:.3px;color:' + a + ';text-transform:uppercase}' +
      '.sp{margin-top:4px;font-size:12.5px;color:#1a8f3c}' +
      '.x{position:absolute;right:-4px;top:-4px;width:32px;height:32px;border:0;background:none;font:26px/30px Arial,sans-serif;color:#555;cursor:pointer}' +
      '.ct{margin:16px 0 8px;font-size:15px;font-weight:700}.ct span{font-weight:400;color:#888}' +
      '.cs{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.cs::-webkit-scrollbar{display:none}' +
      '.cs a{flex:0 0 56px;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden;background:#f6f6f6;position:relative}.cs a.a{border:2px solid ' + a + '}.cs a.o{opacity:.45}.cs img{width:100%;display:block}' +
      '.gr{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}' +
      '.z{position:relative;height:44px;border:1px solid #bbb;border-radius:6px;background:#fff;font-size:15px;color:#222;cursor:pointer;padding:0}' +
      '.z.o{border-style:dashed;border-color:#ccc;color:#aaa}.z.s{border:1.5px solid ' + a + ';background:' + a + '1a;color:' + a + ';font-weight:700}.z.o.s{border-style:dashed}' +
      '.tip{margin-top:12px;padding:11px 12px;border-radius:10px;background:' + a + '14;color:' + a + ';font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center;justify-content:center;text-align:center}.tip i{font-style:normal;font-size:15px}.tip[data-act]{cursor:pointer}' +
      '.si{scroll-margin-top:12px}.b1.g{background:#9e9e9e;color:#fff;border:0}' +
      '.z .lo{position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);font-size:9.5px;font-weight:700;line-height:13px;padding:0 4px;border-radius:6px;white-space:nowrap;background:#fff;color:#d93025;border:1px solid #d9302555}' +
      '.z .bl{position:absolute;right:-7px;top:-7px;width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid #ccc;display:flex;align-items:center;justify-content:center}' +
      '.fb{position:absolute;left:14px;right:14px;top:-12px;transform:translateY(-100%);background:#fff;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.2);padding:12px 14px 12px 60px;min-height:52px;display:flex;align-items:center;font-size:13.5px;line-height:1.35;color:#222}' +
      '.fb i{position:absolute;left:8px;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;background:' + a + ';display:flex;align-items:center;justify-content:center}.fb svg{width:24px;height:24px}' +
      '.ft{margin-top:14px;padding:10px 12px;border-radius:10px;background:' + a + '14;color:#333;font-size:13px;display:flex;gap:8px;align-items:center}.ft i{font-style:normal;color:' + a + '}' +
      '.hint{margin-top:12px;font-size:13px;color:#d93025;min-height:0}' +
      '.si{margin-top:14px}.si h4{margin:0 0 8px;font-size:14px}.sl{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none}.sl::-webkit-scrollbar{display:none}' +
      '.sc{flex:0 0 112px;text-decoration:none;color:#333;font-size:12px;line-height:1.3}.sc span{display:block}.sc .ti{border:1px solid #eee;border-radius:8px;overflow:hidden;background:#f6f6f6;margin-bottom:4px}.sc img{width:100%;display:block}' +
      '.sc .nn{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.sc b{color:' + a + '}' +
      '.bt{display:flex;gap:10px;flex:0 0 auto;background:#fff;padding:10px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #f0f0f0}' +
      '.b1,.b2{flex:1;height:48px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer}' +
      '.b1{background:#fff;color:' + a + ';border:1.5px solid ' + a + '}.b2{background:' + a + ';color:#fff;border:0}.b2.g{background:#9e9e9e}' +
      '.shake{animation:sh .35s}@keyframes sh{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}';
  }

  function priceInfo() {
    var sale = txt('#indirimliFiyat .spanFiyat'), list = txt('#fiyat .spanFiyat');
    if (!sale) return { now: list, old: '', pct: 0 };
    var old = list && list !== sale ? list : '';
    var num = function (t) { var m = String(t).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'); return parseFloat(m) || 0; };
    var o = num(old), n = num(sale), pct = o > 0 && n > 0 && n < o ? Math.round((1 - n / o) * 100) : 0;
    return { now: sale, old: old, pct: pct };
  }
  /** Ürün sayfasında fiyatın yakınındaki kampanya etiketi (ör. "BÜYÜK İNDİRİM") — panelde de gösterilir. */
  function promoLabel() {
    var pe = document.querySelector('#indirimliFiyat') || document.querySelector('#fiyat');
    if (!pe) return '';
    var py = pe.getBoundingClientRect().top, best = '', bd = 1e9;
    [].forEach.call(document.querySelectorAll('body *'), function (e) {
      if (e.children.length || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(e.nodeName)) return;
      var t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 30 || !/[İi]ND[İI]R[İI]M|indirim/i.test(t) || /%|₺|TL|sepette/i.test(t)) return;
      if (e.closest('[id^="yunbi"]') || !e.offsetParent) return;
      var d = Math.abs(e.getBoundingClientRect().top - py);
      if (d < 260 && d < bd) { bd = d; best = t; }
    });
    return best;
  }
  function shipText() {
    var h = document.getElementById('yunbi-shipping-badge');
    if (!h) return '';
    // shadow DOM'daki <style> metni dahil edilmez — yalnız görünen yazı
    var root = h.shadowRoot || h, t = '';
    (function walk(n) { [].forEach.call(n.childNodes, function (c) { if (c.nodeType === 3) t += c.nodeValue + ' '; else if (c.nodeType === 1 && !/^(STYLE|SCRIPT|TEMPLATE)$/.test(c.nodeName) && getComputedStyle(c).display !== 'none') walk(c); }); })(root);
    return t.replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  function renderSheet() {
    if (!sheetHost) return;
    var boxes = sizeBoxes(), low = (uiData && uiData.low) || {}, fit = uiData && uiData.fit, s = ui.sheet;
    var img = (document.getElementById('imgUrunResim') || {}).src || ((document.querySelector('meta[property="og:image"]') || {}).content) || '';
    var name = (window.productDetailModel && window.productDetailModel.productName) || txt('.ProductName');
    var pr = priceInfo(), ship = shipText(), promo = promoLabel();
    var selBox = sheetSel ? boxFor(sheetSel) : null, selOos = sheetSel && isOos(selBox);
    var h = '<div class="ov"></div><div class="sh" role="dialog" aria-modal="true">' +
      (fit && fit.text ? '<div class="fb"><i><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.5a2 2 0 1 1 2-2c0 1-1 1.5-2 2.2v1.3L21 15a1.2 1.2 0 0 1-.7 2.2H3.7A1.2 1.2 0 0 1 3 15l9-6"/></svg></i>' + esc(fit.text) + '</div>' : '') +
      '<div class="hd">' +
      (img ? '<div class="im"><img src="' + esc(img) + '" alt=""></div>' : '') +
      '<div><div class="nm">' + esc(name) + '</div>' + (promo ? '<div class="pl">' + esc(promo) + '</div>' : '') +
      // indirimsiz fiyat üstte (üstü çizili + %indirim), indirimli fiyat altta büyük
      '<div class="pr">' + (pr.old ? '<span class="po"><s>' + esc(pr.old) + '</s>' + (pr.pct >= 5 ? '<span class="pc">%' + pr.pct + '</span>' : '') + '</span>' : '') + (pr.now ? '<b>' + esc(pr.now) + '</b>' : '') + '</div>' +
      (ship ? '<div class="sp">' + esc(ship) + '</div>' : '') + '</div><button class="x" type="button" aria-label="Kapat">&times;</button></div><div class="bd">';
    // Renkler panelde gösterilmez (4 Eki kullanıcı kararı: renk sayfada seçilir, panelde yalnız numara — Trendyol gibi;
    // panelden renk değiştirmek müşteriyi başka sayfaya atıyordu)
    h += '<div class="ct">' + esc(s.title_text || 'Beden') + (sheetSel ? ' <span>(Seçili: ' + esc(sheetSel) + ')</span>' : '') + '</div><div class="gr">';
    boxes.forEach(function (b) {
      var t = boxText(b), o = isOos(b), n = low[t];
      h += '<button type="button" class="z' + (o ? ' o' : '') + (t === sheetSel ? ' s' : '') + '" data-v="' + esc(t) + '">' + esc(t) +
        (o && s.notify ? '<span class="bl"><svg viewBox="0 0 16 16" width="10" height="10" fill="#999"><path d="M8 15a1.8 1.8 0 0 0 1.8-1.6H6.2A1.8 1.8 0 0 0 8 15zm5-3.5-1.2-1.4V7a3.8 3.8 0 0 0-3-3.7V2.6a.8.8 0 0 0-1.6 0v.7a3.8 3.8 0 0 0-3 3.7v3.1L3 11.5v.7h10z"/></svg></span>' : '') + (!o && n ? '<span class="lo">' + esc(String((ui.low_stock && ui.low_stock.text) || 'Son {n}').replace('{n}', n)) + '</span>' : '') + '</button>';
    });
    h += '</div>';
    h += '<div class="hint"></div>';
    // Trendyol: stoksuz numara varken ipucu, stoksuz seçilince "Bedenine uygun benzer ürünleri keşfet!"
    var anyOos = boxes.some(isOos);
    if (s.similar && selOos) h += '<div class="tip" data-act="similar"><i>&#8981;</i>Bu numarada benzer ürünleri keşfet!</div>';
    else if (s.similar && anyOos) h += '<div class="tip"><i>&#8981;</i>Numaran tükendiyse dokunup benzerlerini görebilirsin.</div>';
    h += '</div>'; // .bd
    var hasNow = typeof window.hemenAl === 'function' && document.getElementById('btnHemenAl');
    if (selOos) {
      var canNotify = s.notify && selBox && selBox.querySelector('.btnnostok');
      h += '<div class="bt">' + (canNotify ? '<button class="b1" data-act="notify" type="button">Gelince Haber Ver</button>' : '<button class="b1 g" type="button" disabled>Tükendi</button>') +
        (s.similar ? '<button class="b2" data-act="similar" type="button">Benzer Ürünler</button>' : '<button class="b2 g" type="button" disabled>Tükendi</button>') + '</div>';
    } else {
      h += '<div class="bt">' + (hasNow ? '<button class="b1" data-act="now" type="button">Şimdi Al</button>' : '') + '<button class="b2" data-act="cart" type="button">Sepete Ekle</button></div>';
    }
    h += '</div>';
    sheetHost.shadowRoot.innerHTML = '<style>' + sheetCss() + '</style><div class="wrap' + (sheetOpen ? ' on' : '') + '">' + h + '</div>';
    bindSheet();
    if (fit && fit.text) track('fit_shown', fit.key, true);
    if (selOos && s.similar) loadSimilar(sheetSel);
  }

  function bindSheet() {
    var R = sheetHost.shadowRoot;
    R.querySelector('.ov').addEventListener('click', function () { if (canClose()) closeSheet(); });
    R.querySelector('.x').addEventListener('click', function () { if (canClose()) closeSheet(); });
    [].forEach.call(R.querySelectorAll('.z'), function (z) {
      z.addEventListener('click', function () {
        var t = z.getAttribute('data-v'), b = boxFor(t);
        sheetSel = t;
        if (isOos(b)) { track('oos_select', t); }
        else {
          track('size_select', t);
          try { window.otomatikSepeteEkle = false; } catch (e) { /* yok say */ }
          if (b && !b.classList.contains('selected')) b.click(); // temanın kendi seçimi (hddnUrunID dolar)
        }
        renderSheet();
      });
    });
    [].forEach.call(R.querySelectorAll('.cs a'), function (a) {
      a.addEventListener('click', oneTap(function () {
        track('color_click', a.title || '');
        var u = a.getAttribute('data-href') || '';
        if (!u) return;
        var keep = ui.sheet.keep_size_on_color && sheetSel && !isOos(boxFor(sheetSel));
        var q = (keep ? (cfg.param || 'beden') + '=' + encodeURIComponent(sheetSel) + '&' : '') + 'yunbi_sheet=1' + (TEST ? '&yunbi_variant_test=1' : '');
        location.href = u.split('#')[0] + (u.indexOf('?') >= 0 ? '&' : '?') + q;
      }));
    });
    var act = function (sel, fn) { var e = R.querySelector(sel); if (e) e.addEventListener('click', oneTap(fn)); };
    var need = function () {
      var b = sheetSel ? boxFor(sheetSel) : null;
      if (!b || isOos(b)) {
        var hint = R.querySelector('.hint'), gr = R.querySelector('.gr');
        if (hint) hint.textContent = 'Lütfen numara seçin.';
        if (gr) { gr.classList.remove('shake'); void gr.offsetWidth; gr.classList.add('shake'); }
        return null;
      }
      try { window.otomatikSepeteEkle = false; } catch (e) { /* yok say */ }
      if (!b.classList.contains('selected')) b.click();
      return b;
    };
    act('[data-act="cart"]', function () { if (!need()) return; closeSheet(); setTimeout(function () { window.sepeteEkleUrunDetay(); }, 30); });
    // Şimdi Al: temanın hemenAl'ı doğrudan ödeme adımına (/checkout?step=payment) atıyordu (4 Eki şikâyeti) → sepete ekle + sepet sayfası
    act('[data-act="now"]', function () {
      if (!need()) return;
      closeSheet();
      setTimeout(function () {
        var cart = (window.siteSettings && siteSettings.aktifSepetUrl) || '/checkout';
        try { window.hemenAlClicked = true; } catch (e) { /* yok say */ } // tema sepet açılır penceresini göstermesin
        window.sepeteEkleUrunDetay(function () { try { window.hemenAlClicked = false; } catch (e) { /* yok say */ } location.href = cart; });
      }, 30);
    });
    act('[data-act="notify"]', function () {
      var b = boxFor(sheetSel), n = b && b.querySelector('.btnnostok');
      track('notify', sheetSel);
      closeSheet();
      if (n) setTimeout(function () { n.click(); }, 30); // temanın "Gelince Haber Ver" akışı
    });
    [].forEach.call(R.querySelectorAll('[data-act="similar"]'), function (e) {
      e.addEventListener('click', oneTap(function () { if (e.getAttribute('data-act') === 'similar') goSimilar(); }));
    });
  }

  /** Stoksuz numara: o numarada stoklu ürün var mı + ürünün kategorisinin o numara filtreli adresi (numara başına bir kez). */
  var simData = {};
  function loadSimilar(size) {
    if (simData[size]) { applySimilar(size); return; }
    var my = ++simReq;
    fetch(BASE + '/w/' + encodeURIComponent(TENANT) + '/variant/similar?pid=' + encodeURIComponent(curId()) + '&size=' + encodeURIComponent(size), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var u = d && d.category_url ? String(d.category_url) : '';
        if (u && u.charAt(0) === '/') u = location.origin + u;
        simData[size] = { url: (d && d.items && d.items.length) ? u : '' };
        if (my === simReq) applySimilar(size);
      }).catch(function () { /* sessiz */ });
  }
  function applySimilar(size) {
    if (!sheetHost || size !== sheetSel) return;
    var R = sheetHost.shadowRoot, d = simData[size];
    if (!d || d.url) return;
    // o numarada benzer ürün yok → ipucu kalkar, buton gri "Tükendi"
    var tp = R.querySelector('.tip[data-act]'), b2 = R.querySelector('.b2[data-act="similar"]');
    if (tp) tp.remove();
    if (b2) { b2.removeAttribute('data-act'); b2.className = 'b2 g'; b2.disabled = true; b2.textContent = 'Tükendi'; }
  }
  function goSimilar() {
    var size = sheetSel, d = simData[size];
    var go = function () { var x = simData[size]; if (x && x.url) { track('similar_click', size); location.href = x.url; } };
    if (d) go(); else { loadSimilar(size); var n = 0; (function w() { if (simData[size]) go(); else if (++n < 25) setTimeout(w, 120); })(); }
  }


  function openSheet(src) {
    if (!sheetActive()) return false;
    if (!sheetHost) {
      sheetHost = document.createElement('div');
      sheetHost.id = 'yunbi-variant-sheet';
      sheetHost.attachShadow({ mode: 'open' });
      document.body.appendChild(sheetHost);
    }
    sheetHost.style.fontFamily = themeFont();
    sheetSel = themeSelected() || sheetSel;
    sheetOpen = false;
    renderSheet();
    sheetOpen = true;
    openedAt = Date.now();
    var w = sheetHost.shadowRoot.querySelector('.wrap');
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (w) w.classList.add('on'); }); });
    document.documentElement.style.overflow = 'hidden';
    try { history.pushState({ yunbiSheet: 1 }, ''); } catch (e) { /* yok say */ }
    track('sheet_open', src || '');
    return true;
  }

  function closeSheet(fromPop) {
    if (!sheetOpen) return;
    sheetOpen = false;
    document.documentElement.style.overflow = '';
    var w = sheetHost && sheetHost.shadowRoot.querySelector('.wrap');
    if (w) w.classList.remove('on');
    if (!fromPop) { try { if (history.state && history.state.yunbiSheet) { popSelf = true; history.back(); } } catch (e) { /* yok say */ } }
    applyPageRow();
  }

  function setupSheet() {
    if (!(ui && ui.sheet && ui.sheet.enabled)) {
      if (sheetOpen) closeSheet(true);
      applyPageRow(); // gizlenmiş beden satırını geri açar, sayfa satırını kaldırır
      return;
    }
    hookTheme();
    applyPageRow();
    var root = document.querySelector(ROOT);
    if (root && !sheetObs && window.MutationObserver) {
      var t = null;
      // Tema renk/beden satırını yeniden çizince sayfa satırı güncellenir
      sheetObs = new MutationObserver(function (recs) {
        // yalnız temanın değişiklikleri (bizim yunbi-sz-hide sınıfı değil)
        var real = recs.some(function (r) { return r.type === 'childList' || (r.target.classList && r.target.classList.contains('size_box')); });
        if (real) { clearTimeout(t); t = setTimeout(applyPageRow, 60); }
      });
      sheetObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    // Renk değiştirip gelindiyse panel yeniden açılır (?yunbi_sheet=1)
    if (/[?&]yunbi_sheet=1/.test(location.search)) {
      try { history.replaceState(history.state, '', location.href.replace(/([?&])yunbi_sheet=1(&|$)/, function (m, a, b) { return b ? a : ''; }).replace(/[?&]$/, '')); } catch (e) { /* yok say */ }
      var tries = 0;
      (function tryOpen() { if (sheetOpen) return; if (sheetActive()) { openSheet('color'); return; } if (++tries < 15) setTimeout(tryOpen, 200); })();
    }
  }

  /* Ürün verisi önbelleği (sessionStorage, 5 dk): renk değişiminde yeni sayfa veriyi beklemeden çizer */
  function dataKey(pid, ids) { return 'yunbi_vdata_' + TENANT + '_' + pid + '_' + ids.slice().sort().join(','); }
  function readData(pid, ids) {
    try { var v = JSON.parse(sessionStorage.getItem(dataKey(pid, ids)) || 'null'); return v && Date.now() - v.t < 300000 ? v.d : null; } catch (e) { return null; }
  }
  function saveData(pid, ids, d) { try { sessionStorage.setItem(dataKey(pid, ids), JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* yok say */ } }
  function fetchData(pid, ids) {
    return fetch(BASE + '/w/' + encodeURIComponent(TENANT) + '/variant/data?ids=' + encodeURIComponent(ids.join(',')) + '&pid=' + encodeURIComponent(pid), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) saveData(pid, ids, d); return d; });
  }
  var prefetched = {};
  function prefetchData(pid, ids) {
    if (prefetched[pid] || readData(pid, ids)) return;
    prefetched[pid] = 1;
    fetchData(pid, ids).catch(function () { /* sessiz */ });
  }
  /** Erken gizleme (tema başındaki küçük betik) bitti: tema blokları bizimkilerle değişti ya da değişmeyecek. */
  function ready() { try { document.documentElement.classList.add('yv-ready'); } catch (e) { /* yok say */ } }

  function runUi() {
    if (!ui || !isProductPage()) return;
    var want = (ui.colors && ui.colors.enabled) || (ui.low_stock && ui.low_stock.enabled) || (ui.sheet && ui.sheet.enabled);
    if (!want) { unrenderColors(); try { setupSheet(); } catch (e) { /* yok say */ } ready(); return; }
    var box = colorContainer(), ids = box ? readColorItems(box).map(function (x) { return x.id; }) : [];
    var pid = curId();
    if (!pid) return;
    var key = ids.join(',') + '|' + pid + '|' + JSON.stringify(ui);
    var go = function () {
      try { hookTheme(); } catch (e) { dbg('kanca hata', e); }
      try { renderColors(); watchLow(); } catch (e) { dbg('ui hata', e); }
      try { setupSheet(); } catch (e) { dbg('panel hata', e); }
      track('view', sheetActive() ? 'sheet' : '', true);
      ready();
    };
    if (uiData && uiFetchedFor === key) { go(); return; }
    var cached = readData(pid, ids);
    if (cached) { uiData = cached; uiFetchedFor = key; dbg('veri (önbellek)'); go(); }
    fetchData(pid, ids)
      .then(function (d) {
        if (!d) { ready(); return; }
        var same = cached && JSON.stringify(cached) === JSON.stringify(d);
        uiData = d; uiFetchedFor = key; dbg('veri', d);
        if (!same) go();
      })
      .catch(function () { ready(); });
  }

  function scheduleUi() {
    var tick = function () { runUi(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 60); }); else setTimeout(tick, 60);
    // Tema görselleri geç yükleyebilir (lazy) → sayfa tam yüklenince bir kez daha (görsel adresleri tazelenir)
    window.addEventListener('load', function () { setTimeout(tick, 300); });
  }

  // Deneme: adreste yunbi_variant_test=1 varsa panelde kapalı olsa bile YALNIZ o sayfa açılışında çalışır
  var TEST = /[?&]yunbi_variant_test=1/.test(location.search);

  /* Ürün sayfası düzeni (tema dokunuşları): tema rozetlerini gizle, güven bandına üst boşluk — CSS sayfa
     başında eklenir (yanıp sönme olmaz). Rozetler: Kritik Stok, İndirimli Ürün, Kargo Bedava (Ticimax .ProductIcon). */
  function applyPageCss(p) {
    var st = document.getElementById('yunbi-variant-page-css');
    if (!st) { st = document.createElement('style'); st.id = 'yunbi-variant-page-css'; (document.head || document.documentElement).appendChild(st); }
    var css = '';
    if (p && p.hide_badges) css += '#divKritikStok,#divIndirimliUrun,#divKargoBedava,.ProductIcon .UindirimliUrun,.ProductIcon .UrunKargoBedava{display:none!important}';
    // padding (margin değil): bant 'clear:both' taşıyor; masaüstünde üstteki yüzen (float) butonlardan sonra margin
    // temizleme boşluğuna yutuluyor ve görünmüyordu — padding her iki görünümde aynı boşluğu verir
    if (p && +p.trust_margin > 0) css += '#yunbi-announce-trust{padding-top:' + Math.min(60, +p.trust_margin) + 'px!important;box-sizing:border-box!important}';
    if (p && p.hide_extra && !/[{}<>;]/.test(p.hide_extra)) css += p.hide_extra + '{display:none!important}';
    st.textContent = css;
  }

  /**
   * Masaüstü fotoğraf görüntüleyicisi (tema: fancybox v2) açıkken fare tekerleği / dokunmatik yüzey kaydırması.
   * Sorun (4 Eki): görüntüleyici açıkken kaydırma arkadaki sayfayı kaydırıyordu; görüntüleyici sabit kalıp sayfa
   * altından akınca tarayıcı fotoğrafları üst üste binmiş, kararmış gibi çiziyordu (oklar sorunsuz). Çözüm: görüntüleyici
   * açıkken sayfa kaydırması engellenir; tekerlek yerine bir sonraki / önceki fotoğrafa geçilir (450 ms'de en fazla bir geçiş).
   */
  var lbHooked = false, lbLast = 0, lbAcc = 0;
  function hookLightbox() {
    if (lbHooked) return;
    lbHooked = true;
    var open = function () { return !!document.querySelector('.fancybox-overlay, .fancybox-wrap'); };
    window.addEventListener('wheel', function (e) {
      if (!(ui && ui.page && ui.page.lightbox_wheel !== false) || !open()) return;
      e.preventDefault();
      var fb = window.jQuery && window.jQuery.fancybox;
      if (!fb || typeof fb.next !== 'function') return;
      lbAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      var now = Date.now();
      if (Math.abs(lbAcc) < 40 || now - lbLast < 450) return;
      lbLast = now;
      if (lbAcc > 0) fb.next(); else fb.prev();
      lbAcc = 0;
    }, { passive: false, capture: true });
    window.addEventListener('touchmove', function (e) {
      if (ui && ui.page && ui.page.lightbox_wheel !== false && open()) e.preventDefault();
    }, { passive: false, capture: true });
  }

  function start(c, fromCache) {
    cfg = { enabled: !!c.enabled || TEST, deselect: TEST ? true : !!c.deselect, param: String(c.param || 'beden') };
    dbg('ayar', cfg, fromCache ? '(önbellek)' : '(sunucu)');
    if (!cfg.enabled) { ui = null; unrenderColors(); return; }
    var newUi = c.ui || null;
    try { applyPageCss(newUi && newUi.page); hookLightbox(); } catch (e) { /* yok say */ }
    // Deneme modunda seçim paneli de açılır (yalnız bu sayfa açılışı; müşterileri etkilemez)
    if (TEST && newUi && newUi.sheet) { newUi = JSON.parse(JSON.stringify(newUi)); newUi.sheet.enabled = true; if (newUi.ab) newUi.ab.enabled = false; }
    var uiChanged = JSON.stringify(newUi) !== JSON.stringify(ui);
    ui = newUi;
    setFlags();
    schedule();
    if (uiChanged) scheduleUi();
  }

  // Önbellekteki ayarla HEMEN başla (tema scriptlerinden önce davranabilmek için), tazesini arkadan al
  var cached = readCache();
  if (cached) start(cached, true);
  try {
    fetch(API, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c) return;
      writeCache(c);
      if (!cached || JSON.stringify(cached) !== JSON.stringify(c)) start(c, false);
    }).catch(function () { /* sessiz */ });
  } catch (e) { /* sessiz */ }
})();
