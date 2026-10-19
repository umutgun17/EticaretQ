/*!
 * Yunbi "Beden Seçimi" (CRO) — KALICI YÜKLEYİCİ. Temaya bir kez eklenir, bir daha değiştirilmez:
 *
 *   <script src="https://eticaretq.com/widget/variant.js?v=4" data-tenant="tonnyblack"></script>
 *
 * Asıl kod widget/variant-core.js'tedir ve sürüm numarasıyla (?b=…) yüklenir; sürüm sunucudaki ayar ucundan
 * (/w/{slug}/variant/config → build) okunur. Böylece CDN önbelleği yüzünden temadaki ?v= numarasını her
 * güncellemede artırmak gerekmez. Son bilinen sürüm tarayıcıda tutulur → çekirdek beklemeden hemen yüklenir.
 */
(function () {
  'use strict';
  var s = document.currentScript;
  if (!s) return;
  var T = s.getAttribute('data-tenant');
  if (!T || window.__yunbiVariantBoot) return;
  window.__yunbiVariantBoot = true;
  var BASE = new URL(s.src).origin, KEY = 'yunbi_variant_build_' + T, loaded = false;

  function load(build) {
    if (loaded) return;
    loaded = true;
    var n = document.createElement('script');
    n.src = BASE + '/widget/variant-core.js?b=' + encodeURIComponent(build || '0');
    n.setAttribute('data-tenant', T);
    (document.head || document.documentElement).appendChild(n);
  }

  var known = '';
  try { known = localStorage.getItem(KEY) || ''; } catch (e) { /* yok say */ }
  if (known) load(known);
  try {
    fetch(BASE + '/w/' + encodeURIComponent(T) + '/variant/config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        var b = c && c.build ? String(c.build) : '';
        if (b) { try { localStorage.setItem(KEY, b); } catch (e) { /* yok say */ } }
        load(b || known); // ilk ziyaret: sürüm gelince yükle; sonraki ziyaretlerde yeni sürüm bir sonraki sayfada devreye girer
      })
      .catch(function () { load(known); });
  } catch (e) { load(known); }
})();
