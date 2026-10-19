/*!
 * Yunbi İptal/İade — gömme (embed) loader
 *
 * Tenant mağazasında (ör. tonnyblack.com.tr/iade) bir "Özel Sayfa" içine
 * TEK satırla iade akışını gömer. iframe'i kendisi oluşturur, içerideki
 * uygulamadan gelen yükseklik mesajlarıyla otomatik resize eder (iç scrollbar yok).
 *
 * Kullanım (Ticimax özel sayfasına yapıştır):
 *   <div id="yunbi-iade"></div>
 *   <script src="https://eticaretq.com/iade/embed.js"
 *           data-slug="tonnyblack" data-target="yunbi-iade"></script>
 *
 * data-slug   : tenant slug'ı (varsayılan: tonnyblack)
 * data-target : iframe'in basılacağı element id'si (varsayılan: yunbi-iade)
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName('script');
    script = all[all.length - 1];
  }

  // embed.js nereden yüklendiyse uygulamanın origin'i odur (hub.yunbi.ai)
  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch (e) {
    origin = 'https://eticaretq.com';
  }

  var slug = script.getAttribute('data-slug') || '';
  if (!slug) { return; }
  var targetId = script.getAttribute('data-target') || 'yunbi-iade';

  var mount = document.getElementById(targetId);
  if (!mount) {
    // Hedef yoksa script'in hemen ardına bir konteyner ekle
    mount = document.createElement('div');
    if (script.parentNode) script.parentNode.insertBefore(mount, script.nextSibling);
  }

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/iade/' + encodeURIComponent(slug) + '?embed=1';
  iframe.title = 'İptal / İade Talebi';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('allowtransparency', 'true');
  // İade kodunu kopyala butonu: cross-origin iframe'de Clipboard API bu izni ister.
  // (Uygulamada ayrıca execCommand fallback'i var — eski/cache'li embed'lerde de çalışır.)
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.style.overflow = 'hidden';
  iframe.style.minHeight = '520px';
  iframe.style.background = 'transparent';

  mount.innerHTML = '';
  mount.appendChild(iframe);

  // İçerideki uygulama yüksekliğini bildirir → iframe'i ona göre büyüt/küçült
  window.addEventListener('message', function (ev) {
    if (ev.origin !== origin) return;
    var d = ev.data;
    if (d && d.type === 'yunbi-iade:height' && typeof d.height === 'number') {
      iframe.style.height = d.height + 'px';
    }
  });
})();
