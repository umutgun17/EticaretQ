/* Yunbi "Gelince Haber Ver" v2 — temaya TEK satır eklenir:
   <script src="https://hub.yunbi.ai/widget/stock-alert.js?v=2" data-tenant="SLUG" async></script>
   Panelden girilen CSS seçicisindeki butona tıklama yakalanır, mini form açılır,
   ürün sayfadan otomatik tespit edilir (JSON-LD sku/barkod → URL yolu).
   İsteğe bağlı gelişmiş kullanım: data-yunbi-stock-alert formu / YunbiStockAlert.subscribe(). */
(function () {
  var s = document.currentScript, tenant = s && s.getAttribute('data-tenant');
  if (!tenant) return;
  var base = 'https://hub.yunbi.ai/w/' + tenant + '/stock-alert';

  function post(productId, data) {
    return fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ product_id: String(productId) }, data || {}))
    }).then(function (r) { return r.json(); });
  }
  window.YunbiStockAlert = { subscribe: post };

  // ── Ürünü sayfadan tespit et ──
  function pageHints() {
    var h = { sku: '', barcode: '', path: location.pathname };
    var el = document.querySelector('[data-yunbi-product-id]');
    if (el) h.pid = el.getAttribute('data-yunbi-product-id');
    var lds = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < lds.length; i++) {
      try {
        var d = JSON.parse(lds[i].textContent);
        var arr = Array.isArray(d) ? d : (d['@graph'] || [d]);
        for (var j = 0; j < arr.length; j++) {
          var p = arr[j];
          if (p && (p['@type'] === 'Product' || (Array.isArray(p['@type']) && p['@type'].indexOf('Product') > -1))) {
            h.sku = h.sku || p.sku || '';
            h.barcode = h.barcode || p.gtin13 || p.gtin || p.mpn || '';
            var of = Array.isArray(p.offers) ? p.offers[0] : p.offers;
            if (of) { h.sku = h.sku || of.sku || ''; }
          }
        }
      } catch (e) {}
    }
    return h;
  }

  function resolveProduct(cb) {
    var h = pageHints();
    if (h.pid) return cb(h.pid, '');
    var qs = 'sku=' + encodeURIComponent(h.sku) + '&barcode=' + encodeURIComponent(h.barcode) + '&path=' + encodeURIComponent(h.path);
    fetch(base + '/resolve?' + qs).then(function (r) { return r.json(); })
      .then(function (r) { cb(r.product_id, r.name || ''); })
      .catch(function () { cb(null, ''); });
  }

  // ── Mini form ──
  function openModal(productId, productName) {
    var old = document.getElementById('yunbi-sa-overlay');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'yunbi-sa-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:14px;max-width:360px;width:100%;padding:20px;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.25)">' +
      '<div style="font-weight:700;font-size:15px;color:#111;margin-bottom:4px">Gelince Haber Ver</div>' +
      '<div style="font-size:12px;color:#666;margin-bottom:12px">' + (productName ? productName + ' — ' : '') + 'Ürün stoğa girdiğinde size haber verelim.</div>' +
      '<input id="yunbi-sa-email" type="email" placeholder="E-posta adresiniz" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:8px">' +
      '<input id="yunbi-sa-phone" type="tel" placeholder="Telefon (isteğe bağlı, SMS için)" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:12px">' +
      '<div id="yunbi-sa-msg" style="font-size:12px;color:#b91c1c;margin-bottom:8px;display:none"></div>' +
      '<button id="yunbi-sa-go" style="width:100%;padding:11px;background:#111;color:#fff;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Haber Ver</button>' +
      '<button id="yunbi-sa-x" style="width:100%;padding:8px;background:none;color:#888;border:0;font-size:12px;cursor:pointer;margin-top:4px">Vazgeç</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.getElementById('yunbi-sa-x').onclick = function () { ov.remove(); };
    document.getElementById('yunbi-sa-go').onclick = function () {
      var email = document.getElementById('yunbi-sa-email').value.trim();
      var phone = document.getElementById('yunbi-sa-phone').value.trim();
      var msg = document.getElementById('yunbi-sa-msg');
      if (!email && !phone) { msg.textContent = 'E-posta veya telefon girin.'; msg.style.display = 'block'; return; }
      if (!productId) { msg.textContent = 'Ürün tespit edilemedi.'; msg.style.display = 'block'; return; }
      post(productId, { email: email, phone: phone }).then(function (r) {
        ov.firstChild.innerHTML = '<div style="text-align:center;padding:16px 4px"><div style="font-size:30px">✅</div>' +
          '<div style="font-weight:600;font-size:14px;color:#111;margin-top:8px">' + (r.message || 'Kaydedildi!') + '</div>' +
          '<button onclick="document.getElementById(\'yunbi-sa-overlay\').remove()" style="margin-top:14px;padding:9px 22px;background:#111;color:#fff;border:0;border-radius:8px;font-size:13px;cursor:pointer">Tamam</button></div>';
      });
    };
  }

  // ── Panelden gelen seçiciyle tema butonunu override et ──
  fetch(base + '/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg.enabled || !cfg.selector) return;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest(cfg.selector);
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      resolveProduct(function (pid, name) { openModal(pid, name); });
    }, true);
  }).catch(function () {});

  // Gelişmiş: kendi formunu kuranlar için (v1 uyumluluğu)
  document.addEventListener('submit', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-yunbi-stock-alert]');
    if (!el) return;
    e.preventDefault();
    var q = function (n) { var i = el.querySelector('[name=' + n + ']'); return i ? i.value : ''; };
    post(el.getAttribute('data-yunbi-stock-alert'), { email: q('email'), phone: q('phone'), name: q('name'), variant: q('variant') })
      .then(function (r) { alert(r.message || 'Kaydedildi.'); });
  }, true);
})();
