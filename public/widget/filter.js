(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi Akıllı Filtre — kategori sayfası filtre + ürün listesi widget'ı (CRO).
     Mağazanın (Ticimax) kendi filtre bloğunu ve ürün listesini gizler, yerine
     Yunbi verisiyle çalışan filtre paneli + ürün ızgarası koyar.

     Kurulum (tema, tüm sayfalarda):
       <script src="https://eticaretq.com/widget/filter.js?v=5" data-tenant="tonnyblack"></script>
     v5: Ticimax ?filtre=td-135|455 (native teknik detay filtresi) Yunbi kapsamı olur: facet sayıları/beden aralığı/id listesi aynı kümede; çip ile kaldırılır.
     v4: ?kapsam=/kadin (kampanya kategorisi + segment kesişimi, menüden gelir) + etiket/marka/arama sayfalarında temaya dokunmaz.
     Yalnız kategori sayfalarında devreye girer (config.category_paths eşleşmesi).
     Demo/önizleme öznitelikleri: data-path, data-template, data-theme (JSON), data-mount, data-debug.
     Şablonlar: sidebar (sol sütun) | topbar (üst çubuk açılır kutular) | drawer (butonla açılan panel)
     Modlar  : native  → mağazanın KENDİ ürün listesi kalır; Yunbi filtre paneli eşleşen ürün id'lerini
                         Ticimax'a verir (filterModel.filter.StrProductIds + getProducts(), URL'de ukids=)
               takeover → filtre + ürün listesini Yunbi çizer (Ticimax globalleri yoksa / demo)
     v2 (11 Eyl): native modda araç çubuğu demodaki gibi TAM (sayaç + çipler + Filtrele + sıralama + ızgara);
       sıralama Yunbi seçicisinden Ticimax sortingClick()'e gider, sayaç Ticimax'ın (netTotalItems) — tema
       sıralama/sayaç/alt kategori nav'ı (.brandlistselection/.Uadet/.katlink) gizlenir. Mobilde tek Filtrele
       butonu, çekmece tam ekran; webde genişlik theme.drawer_width (vars. 460px).
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiFilterLoaded) return;
  window.__yunbiFilterLoaded = true;
  // v2 ızgara vekili temanın gizlediği görünüm modlarını (tekli/3'lü) localStorage'a yazmıştı; tema tarafından
  // set edilmemiş kayıt (yunbi_grid işareti yok) kaldırılır → liste varsayılan düzene döner
  try { if (localStorage.getItem('productListingType') != null && !localStorage.getItem('yunbi_grid')) localStorage.removeItem('productListingType'); } catch (e) { }

  var API = SCRIPT.src.replace(/\/widget\/filter\.js.*$/, '/w/' + TENANT + '/filter');
  var FORCE_PATH = SCRIPT.getAttribute('data-path') || '';
  var FORCE_TPL = (SCRIPT.getAttribute('data-template') || '').toLowerCase();
  var FORCE_MOUNT = SCRIPT.getAttribute('data-mount') || '';
  var FORCE_THEME = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { FORCE_THEME = null; }
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiFilter]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  /* ── URL parametre adları (Türkçe, paylaşılabilir) ── */
  var PARAM = { color: 'renk', size: 'beden', brand: 'marka', category: 'kat', price: 'fiyat', discount: 'indirim', new: 'yeni', rating: 'puan', sort: 'sirala', page: 'sayfa', scope: 'kapsam' };
  var SPEC_PREFIX = 'oz_';

  var FORCE_MODE = (SCRIPT.getAttribute('data-mode') || '').toLowerCase();
  var cfg = null, category = null, catPath = '', host = null, root = null, root2 = null, root3 = null, mountedEl = null, MODE = 'takeover';
  var state = { filters: emptyFilters(), sort: '', page: 1, scope: '', native: '' }; // native: Ticimax ?filtre= (sunucu tarafı filtre; Yunbi de aynı kısıtı uygular) // scope: ?kapsam=/kadin → liste bu kategoriyle kesişir (kaldırılana dek kalır)
  var data = { products: [], facets: [], total: 0, has_more: false, sorts: [], applied: [], scope: null };
  var ui = { panelOpen: false, open: {}, showMore: {}, search: {}, popover: null, loading: false, viewed: false };
  var reqSeq = 0;

  function emptyFilters() { return { color: [], size: [], brand: [], category: [], spec: {}, price_min: null, price_max: null, discount: false, new: false, rating: null }; }

  /* ═══ yardımcılar ═══ */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = Number(n) || 0; var s = n.toFixed(2).replace('.', ','); s = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return s.replace(/,00$/, '') + ' TL'; }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  /* Widget iki shadow root'a bölünebilir (native: panel + araç çubuğu); id'ler ikisinde de aranır */
  function q1(sel) { var rs = [root, root2, root3], r = null; for (var i = 0; i < rs.length && !r; i++) if (rs[i]) r = qs(sel, rs[i]); return r; }
  function on(el, ev, sel, fn) { el.addEventListener(ev, function (e) { var t = e.target && e.target.closest ? e.target.closest(sel) : null; if (t && el.contains(t)) fn(e, t); }); }
  function activeCount() {
    var f = state.filters, n = f.color.length + f.size.length + f.brand.length + f.category.length;
    Object.keys(f.spec).forEach(function (k) { n += f.spec[k].length; });
    if (f.price_min != null || f.price_max != null) n++;
    if (f.discount) n++; if (f.new) n++; if (f.rating != null) n++;
    return n;
  }
  function isDesktop() { return window.innerWidth >= 900; }

  /* ═══ URL durumu ═══ */
  function readUrl() {
    var p = new URLSearchParams(location.search), f = emptyFilters();
    var list = function (k) { var v = p.get(k); return v ? v.split(',').map(decodeURIComponent).filter(Boolean) : []; };
    f.color = list(PARAM.color); f.size = list(PARAM.size); f.brand = list(PARAM.brand); f.category = list(PARAM.category);
    var pr = p.get(PARAM.price); if (pr) { var m = pr.split('-'); f.price_min = m[0] !== '' ? Number(m[0]) : null; f.price_max = m[1] !== undefined && m[1] !== '' ? Number(m[1]) : null; }
    f.discount = p.get(PARAM.discount) === '1'; f.new = p.get(PARAM.new) === '1';
    f.rating = p.get(PARAM.rating) ? Number(p.get(PARAM.rating)) : null;
    p.forEach(function (v, k) { if (k.indexOf(SPEC_PREFIX) === 0 && v) f.spec[k.slice(SPEC_PREFIX.length)] = v.split(',').map(decodeURIComponent).filter(Boolean); });
    state.filters = f;
    state.sort = p.get(PARAM.sort) || '';
    state.page = Math.max(1, parseInt(p.get(PARAM.page), 10) || 1);
    state.scope = (p.get(PARAM.scope) || '').trim();
    state.native = (p.get('filtre') || '').trim();
  }
  function writeUrl(push) {
    var p = new URLSearchParams(location.search), f = state.filters;
    var keys = [PARAM.color, PARAM.size, PARAM.brand, PARAM.category, PARAM.price, PARAM.discount, PARAM.new, PARAM.rating, PARAM.sort, PARAM.page, PARAM.scope];
    [].slice.call(p.keys()).forEach(function (k) { if (k.indexOf(SPEC_PREFIX) === 0) keys.push(k); });
    keys.forEach(function (k) { p.delete(k); });
    var setList = function (k, arr) { if (arr.length) p.set(k, arr.map(encodeURIComponent).join(',')); };
    setList(PARAM.color, f.color); setList(PARAM.size, f.size); setList(PARAM.brand, f.brand); setList(PARAM.category, f.category);
    if (f.price_min != null || f.price_max != null) p.set(PARAM.price, (f.price_min != null ? f.price_min : '') + '-' + (f.price_max != null ? f.price_max : ''));
    if (f.discount) p.set(PARAM.discount, '1'); if (f.new) p.set(PARAM.new, '1'); if (f.rating != null) p.set(PARAM.rating, String(f.rating));
    Object.keys(f.spec).forEach(function (k) { setList(SPEC_PREFIX + k, f.spec[k]); });
    if (state.sort && MODE !== 'native') p.set(PARAM.sort, state.sort);
    if (state.page > 1 && MODE !== 'native') p.set(PARAM.page, String(state.page));
    if (state.scope) p.set(PARAM.scope, state.scope); // Ticimax setFilterUrl düşürse de kapsam kalsın
    if ((p.get('ukids') || '').length > 600) p.delete('ukids'); // uzun ukids → sayfa isteği IIS'te 404; Yunbi parametreleri listeyi yeniden kurar
    // Virgüller ham kalsın: Ticimax ukids=1,2,3 değerini decode etmeden okur (%2C bozar)
    var q = p.toString().replace(/%2C/gi, ','), url = location.pathname + (q ? '?' + q : '') + location.hash;
    try { (push ? history.pushState : history.replaceState).call(history, { yf: 1 }, '', url); } catch (e) { }
  }
  window.addEventListener('popstate', function () { if (!root) return; readUrl(); fetchList(false); });

  /* ═══ API ═══ */
  function apiUrl(path, params) {
    var p = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null || v === '' || v === false) return;
      if (Array.isArray(v)) v.forEach(function (x) { p.append(k + '[]', x); });
      else if (typeof v === 'object') Object.keys(v).forEach(function (sk) { v[sk].forEach(function (x) { p.append(k + '[' + sk + '][]', x); }); });
      else p.append(k, v === true ? '1' : v);
    });
    return API + path + (p.toString() ? '?' + p.toString() : '');
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, category: catPath }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }

  function listParams() {
    var f = state.filters;
    var params = { path: catPath, scope: state.scope, native: state.native, color: f.color, size: f.size, brand: f.brand, category: f.category, spec: f.spec, price_min: f.price_min, price_max: f.price_max, discount: f.discount, new: f.new, rating: f.rating, sort: state.sort, page: state.page };
    if (MODE === 'native') { params.ids_only = true; params.page = 1; params.sort = nb.reqSort = ticimaxSortKey(); }
    return params;
  }
  function fetchList(append, preloaded) {
    var seq = ++reqSeq;
    ui.loading = true; renderToolbar(); if (!append && MODE !== 'native') renderGridLoading();
    return (preloaded ? Promise.resolve(preloaded) : getJSON(apiUrl('/list', listParams()))).then(function (d) {
      if (seq !== reqSeq) return;
      ui.loading = false;
      category = d.category || category;
      data.scope = d.scope || null;
      data.total = d.total; data.has_more = d.has_more; data.sorts = d.sorts || data.sorts; data.applied = d.applied || []; data.facets = d.facets || [];
      if (MODE === 'native') { nativeApply(d.ids || [], append === 'init'); renderAll(); if (!ui.viewed) { ui.viewed = true; track('view'); } return; }
      data.products = append ? data.products.concat(d.products || []) : (d.products || []);
      if (!state.sort) state.sort = d.sort;
      renderAll();
      if (!ui.viewed) { ui.viewed = true; track('view'); }
    }).catch(function (e) {
      if (seq !== reqSeq) return;
      ui.loading = false; dbg('list error', e);
      renderError();
    });
  }

  /* ═══ native mod: Ticimax listesine ürün id'lerini ver ═══
     Ticimax'ın kendi setFilter() akışını taklit eder: filterModel güncellenir, sonsuz kaydırma
     sayaçları sıfırlanır, setFilterUrl URL'ye ukids= yazar, getProducts() listeyi yeniden çizer. */
  function nativeApply(ids, initial) {
    var fm = window.filterModel;
    if (!fm || !fm.filter || typeof window.getProducts !== 'function') { dbg('native: Ticimax globalleri yok'); return; }
    var want = (activeCount() || state.scope) ? (ids.length ? ids.join(',') : '0') : '';
    nb.ids = want ? { str: want, list: ids, sort: nb.reqSort } : null;
    var cur = new URLSearchParams(location.search).get('ukids') || '';
    if (initial && !want) return; // Yunbi filtresi yok: Ticimax'ın kendi durumuna (ukids dâhil) dokunma
    // Ticimax initFilter() bu alanı sayfa globali strProductIds'ten yeniden yazar (URL'den ham/encoded gelebilir);
    // facet sayımı baseFilter'ı kullanır → üçünü de hizala
    fm.filter.StrProductIds = want;
    try { window.strProductIds = want; } catch (e) { }
    try { if (window.baseFilter) window.baseFilter.StrProductIds = want; } catch (e) { }
    if (initial && want === cur) return; // sunucu zaten bu id'lerle çizdi, yeniden çekme
    if (fm.paging) fm.paging.PageNumber = 1;
    try { window.lastLoadedUpperPageNumber = 1; window.lastLoadedLowerPageNumber = 1; window.scrollGetProductNotRun = true; } catch (e) { }
    try {
      var ss = window.siteSettings;
      if (ss && (ss.sayfalamaSecenek == 2 || ss.sayfalamaSecenek == 3)) { var l = document.getElementById('ProductPageProductList'); if (l) l.innerHTML = ''; }
    } catch (e) { }
    try { if (typeof window.setFilterUrl === 'function') window.setFilterUrl(fm, (window.extraFilterObject && window.extraFilterObject.Sortings) || []); } catch (e) { dbg('setFilterUrl', e); }
    writeUrl(false); // Yunbi parametreleri (renk=, beden=…) ukids= yanında kalsın
    try { history.replaceState({ type: 1, path: location.href, yf: 1 }, '', location.href); } catch (e) { }
    try { window.getProducts(); } catch (e) { dbg('getProducts', e); }
    try { if (typeof window.selectFilter === 'function') window.selectFilter(); } catch (e) { }
    if (!initial) { var top = document.getElementById('ProductPageProductList'); if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  /* Ticimax setFilterUrl() URL'yi kendi modelinden sıfırdan kurar (ukids= dâhil) ve Yunbi
     parametrelerini (renk=, beden=…) düşürür. Sarmalayıp her çağrıdan sonra kendi parametrelerimizi
     geri yazarız; popstate'te Ticimax state.path'e gittiği için state'i de tam URL ile tazeleriz. */
  function hookTicimaxUrl() {
    if (typeof window.setFilterUrl !== 'function' || window.setFilterUrl.__yf) return;
    var orig = window.setFilterUrl;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { writeUrl(false); history.replaceState({ type: 1, path: location.href, yf: 1 }, '', location.href); } catch (e) { }
      return r;
    };
    wrapped.__yf = true;
    window.setFilterUrl = wrapped;
  }

  /* ═══ native: sıralama + sayaç + ızgara Ticimax'a köprü ═══
     Tema sıralama kutusu (.brandlistselection) ve sayacı (.Uadet) gizlenir; Yunbi araç çubuğu tek kaynak olur.
     Sıralama: Ticimax'ın kendi listesi (extraFilterObject.Sortings, async yüklenir) Yunbi anahtarlarına eşlenir,
     seçim sortingClick(id) ile Ticimax'a gider (getProducts + setFilterUrl → hook Yunbi parametrelerini korur).
     Sayaç: Ticimax'ın gördüğü liste sayısı (netTotalItems / .FiltrelemeUrunAdet) — Yunbi kataloğuyla ±fark olmasın.
     Meşguliyet: ticimaxApi.product.getProductList sarmalanır; istek boyunca sayaç "…" gösterir. */
  var nb = { busy: false, t: null, ot: null, polls: 0, ids: null, reqSort: '', per: 0 };
  var SORT_MAP = { 'KATEGORISIRA|ASC': 'recommended', 'EKLEMETARIHI|DESC': 'newest', 'SATISADEDI|DESC': 'bestseller', 'URUNFIYATIORJINAL|ASC': 'price_asc', 'URUNFIYATIORJINAL|DESC': 'price_desc' };
  function nativeTotal() {
    var v = window.netTotalItems;
    if (v == null || v === '') { var sp = qs('.FiltrelemeUrunAdet span'); var m = sp && /(\d[\d.]*)/.exec(sp.textContent || ''); v = m ? m[1].replace(/\./g, '') : null; }
    if (v == null) return data.total;
    v = Number(v); return isFinite(v) ? v : data.total;
  }
  function nativeSortList() {
    var xs = window.extraFilterObject && window.extraFilterObject.Sortings;
    if (!xs || !xs.length) return null;
    var selVal = null;
    xs.forEach(function (s) { if (s.selected && !s.isStokFilter && s.value && selVal == null) selVal = String(s.value).toUpperCase(); });
    var seen = {}, out = [];
    xs.forEach(function (s) {
      if (s.isStokFilter || s.id == 1000 || !s.value) return;
      if (/se[çc]iniz/i.test(s.name || '')) return; // "Sıralama Seçiniz" yer tutucusu (değeri Önerilen ile aynı)
      var val = String(s.value).toUpperCase(), key = SORT_MAP[val] || ('t' + s.id);
      if (seen[key]) return; seen[key] = 1;
      var lbl = (data.sorts || []).filter(function (x) { return x.key === key; })[0];
      out.push({ id: s.id, key: key, label: lbl ? lbl.label : s.name, on: selVal != null && val === selVal });
    });
    if (out.length && !out.some(function (o) { return o.on; })) out[0].on = true;
    return out;
  }
  function nativeSort(key) {
    var list = nativeSortList() || [], e = list.filter(function (o) { return o.key === key; })[0];
    if (!e || typeof window.sortingClick !== 'function') return;
    track('sort', { value: key });
    try { window.sortingClick(e.id); } catch (x) { dbg('sortingClick', x); }
    var top = document.getElementById('ProductPageProductList'); if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function pollSortings() { // Ticimax sıralama listesi createSortingBlock() ile sonradan gelir
    if (nativeSortList() || nb.polls++ > 40) { renderToolbar(); return; }
    setTimeout(pollSortings, 300);
  }
  /* ═══ uzun id listesi: Ticimax GetProductList GET isteğidir, FilterJson URL'ye yazılır; IIS ~2.048
     karakterden uzun sorguda 404 döner (≈200+ id). Büyük kategoride (Fırsat 1.780 ürün) filtre/sıralama
     bu yüzden boş kalıyordu. Liste uzunsa Ticimax'a yalnız istenen sayfanın id'leri gider (sayfa 1),
     cevaptaki toplam/sayfa alanları tam listeye göre düzeltilir → sonsuz kaydırma + sayaç doğru çalışır.
     Sıralama: id'ler Yunbi'den Ticimax'ın seçili sıralamasıyla gelir; sayfa içi sırayı Ticimax yine uygular. */
  var URL_MAX = 1800;
  function ticimaxSortKey(paging) {
    var pg = paging || (window.filterModel && window.filterModel.paging) || {};
    var k = (String(pg.OrderBy || '') + '|' + String(pg.OrderDirection || '')).toUpperCase();
    return SORT_MAP[k] || 'recommended';
  }
  function parseReq(d) {
    if (MODE !== 'native' || !nb.ids || !d || typeof d.FilterJson !== 'string') return null;
    try { var f = JSON.parse(d.FilterJson), p = JSON.parse(d.PagingJson || '{}'); } catch (e) { return null; }
    if (!f || f.StrProductIds !== nb.ids.str) return null;
    var len = 0; try { len = (window.jQuery ? window.jQuery.param(d) : '').length; } catch (e) { }
    if (!len) Object.keys(d).forEach(function (k) { len += k.length + 2 + encodeURIComponent(String(d[k])).length; });
    if (len + 60 < URL_MAX) return null;
    return { f: f, p: p };
  }
  function needResort(d) {
    var q = parseReq(d); if (!q) return '';
    var key = ticimaxSortKey(q.p);
    return key !== nb.ids.sort ? key : '';
  }
  function slicePage(d) {
    var q = parseReq(d); if (!q) return null;
    var list = nb.ids.list, per = q.p.PageItemCount > 0 ? q.p.PageItemCount : (nb.per || 24), no = Math.max(1, q.p.PageNumber || 1);
    var part = list.slice((no - 1) * per, no * per);
    q.f.StrProductIds = part.length ? part.join(',') : '0';
    q.p.PageNumber = 1; q.p.PageItemCount = per;
    var nd = {}; Object.keys(d).forEach(function (k) { nd[k] = d[k]; });
    nd.FilterJson = JSON.stringify(q.f); nd.PagingJson = JSON.stringify(q.p);
    dbg('uzun id listesi dilimlendi', list.length, 'sayfa', no, 'x', per);
    return { data: nd, total: list.length, no: no, per: per };
  }
  function hookTicimaxList() {
    try {
      var api = window.ticimaxApi && window.ticimaxApi.product;
      if (!api || typeof api.getProductList !== 'function' || api.getProductList.__yf) return;
      var orig = api.getProductList;
      var w = function () {
        var args = [].slice.call(arguments), cb = args[1], self = this, pg = null;
        nb.busy = true; renderToolbar();
        clearTimeout(nb.t); nb.t = setTimeout(function () { nb.busy = false; renderToolbar(); }, 8000);
        args[1] = function (res) {
          var r;
          try {
            if (res && !res.isError) {
              if (pg) { res.totalProductCount = pg.total; res.currentPage = pg.no; res.productCountPerPage = pg.per; res.nextProductCount = Math.max(0, pg.total - pg.no * pg.per); }
              else if (res.productCountPerPage > 0) nb.per = res.productCountPerPage;
            }
            r = typeof cb === 'function' ? cb.apply(this, arguments) : undefined;
          }
          finally { clearTimeout(nb.t); nb.busy = false; renderToolbar(); setTimeout(renderToolbar, 400); }
          return r;
        };
        var send = function () { var p = slicePage(args[0]); if (p) { args[0] = p.data; pg = p; } return orig.apply(self, args); };
        // Sıralama değiştiyse dilimler yeni sırayla kesilmeli → id'leri o sırayla bir kez yeniden al
        var want = needResort(args[0]);
        if (!want) return send();
        var prm = listParams(); prm.sort = want;
        getJSON(apiUrl('/list', prm)).then(function (d) { if (nb.ids && d && d.ids && d.ids.length === nb.ids.list.length) { nb.ids.list = d.ids; nb.ids.sort = want; } }).catch(function () { }).then(send);
      };
      w.__yf = true; api.getProductList = w;
    } catch (e) { dbg('hookTicimaxList', e); }
  }
  function watchTicimaxBar() { // renderExtraFiltre() sıralama/sayaç bloğunu yeniden çizer → seçili sıralamayı ve sayacı eşitle
    var el = qs('.brandlistselection'); if (!el) return;
    try { new MutationObserver(function () { clearTimeout(nb.ot); nb.ot = setTimeout(renderToolbar, 80); }).observe(el, { childList: true, subtree: true, characterData: true }); } catch (e) { }
  }
  function gridHTML() {
    var btns = nb.gridBtns || []; if (!btns.length) return '';
    var cur = null; try { cur = localStorage.getItem('productListingType'); } catch (e) { }
    var ic = function (cls) {
      if (/hrz/.test(cls)) return '<svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/></svg>';
      var n = /sort_(\d)/.exec(cls); n = n ? Number(n[1]) : 3; var w = (14 - (n - 1) * 2) / n, h = '';
      for (var i = 0; i < n; i++) { var x = 1 + i * (w + 2); h += '<rect x="' + x.toFixed(2) + '" y="1" width="' + w.toFixed(2) + '" height="6" rx="1"/><rect x="' + x.toFixed(2) + '" y="9" width="' + w.toFixed(2) + '" height="6" rx="1"/>'; }
      return '<svg viewBox="0 0 16 16">' + h + '</svg>';
    };
    return '<span class="gsw">' + btns.map(function (b) {
      var t = b.getAttribute('data-type') || '';
      var on = (cur != null && String(cur) === String(t)) || b.classList.contains('selected') || b.classList.contains('active');
      return '<button type="button" data-grid="' + esc(t) + '" class="' + (on ? 'on' : '') + '" title="Görünüm">' + ic(b.className) + '</button>';
    }).join('') + '</span>';
  }

  /* ═══ tema & stil ═══ */
  function themeVars(t) {
    var preset = t.preset || 'minimal';
    var v = {
      accent: t.accent || '#111827', radius: (t.radius != null ? t.radius : 10) + 'px',
      chipR: t.chip === 'square' ? '6px' : '999px', swR: t.swatch === 'square' ? '6px' : '50%',
      font: t.font && t.font !== 'inherit' ? t.font : 'inherit',
      bg: '#ffffff', ink: '#111827', muted: '#6b7280', line: '#e5e7eb', fill: '#f5f5f7', chipBg: '#ffffff', chipOn: t.accent || '#111827', chipOnInk: '#ffffff', headW: '700'
    };
    if (preset === 'soft') { v.line = '#eceef3'; v.fill = '#f6f7fb'; v.chipBg = '#f3f4f8'; v.headW = '600'; }
    if (preset === 'bold') { v.line = '#111827'; v.fill = '#fafafa'; v.chipBg = '#ffffff'; v.headW = '800'; }
    return v;
  }
  function css(t) {
    var v = themeVars(t), bold = (t.preset === 'bold');
    return [
      ':host{all:initial;display:block;font-family:' + v.font + ';color:' + v.ink + ';--a:' + v.accent + ';--r:' + v.radius + ';--cr:' + v.chipR + ';--sr:' + v.swR + ';--dw:' + (parseInt(t.drawer_width, 10) || 560) + 'px;--line:' + v.line + ';--fill:' + v.fill + ';--muted:' + v.muted + ';--chip:' + v.chipBg + ';--on:' + v.chipOn + ';--onink:' + v.chipOnInk + ';--hw:' + v.headW + ';line-height:1.4;font-size:14px;-webkit-font-smoothing:antialiased}',
      '*,*:before,*:after{box-sizing:border-box}button{font:inherit;cursor:pointer}a{color:inherit;text-decoration:none}input{font:inherit}',
      '.yf{display:grid;gap:24px;width:100%}.yf.sidebar{grid-template-columns:250px minmax(0,1fr)}.yf.topbar,.yf.drawer{grid-template-columns:minmax(0,1fr)}',
      '@media(max-width:899px){.yf.sidebar{grid-template-columns:minmax(0,1fr)}}',
      /* toolbar */
      '.tb{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:0 0 14px;border-bottom:1px solid var(--line);margin-bottom:16px}.tb .ch,.tb .act{display:contents}',
      '@media(max-width:899px){.tb{gap:10px 8px}.tb .cnt{flex:1 1 100%;margin-right:0;order:1}.tb .act{display:flex;gap:8px;flex:1 1 100%;order:2}.tb .act .fbtn,.tb .act .sort{flex:1 1 0;min-width:0;height:44px;padding:0 12px;justify-content:center;font-size:14px;font-weight:600;line-height:1}.tb .act .sort{position:relative;gap:6px}.tb .act .sort select{width:auto;max-width:calc(100% - 34px);min-width:0;font-weight:600;text-align:center;text-align-last:center;-webkit-appearance:none;appearance:none;padding:0 14px 0 0;background:transparent}.tb .act .sort .sv{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.2;pointer-events:none}.tb .ch{display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:1 1 100%;order:3}.tb .ch:empty{display:none}}',
      '.sort .sv{display:none}@media(max-width:899px){.sort .sv{display:block}}',
      '.tb .cnt{font-weight:700;font-size:15px;color:var(--ink);margin-right:auto;white-space:nowrap}.tb .cnt small{color:var(--muted);font-weight:500;font-size:13px}',
      '.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--chip);border-radius:var(--cr);padding:7px 11px 7px 13px;font-size:13px;line-height:1;color:var(--ink)}',
      '.chip b{font-weight:400;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:0 2px}.chip b:hover{color:#dc2626}',
      '.clr{background:none;border:0;color:var(--muted);font-size:12.5px;text-decoration:underline;padding:4px}.clr:hover{color:var(--ink)}',
      '.sort{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:var(--cr);padding:0 14px;height:42px;font-size:14px;font-weight:600;background:var(--chip);color:var(--ink)}',
      '.sort select{border:0;background:transparent;font:inherit;color:inherit;outline:none;max-width:240px;cursor:pointer}',
      '.fbtn{display:inline-flex;align-items:center;gap:8px;border:1px solid ' + (bold ? 'var(--a)' : 'var(--line)') + ';border-radius:var(--cr);padding:0 18px;height:42px;font-size:14px;font-weight:600;background:var(--chip);color:var(--ink)}.fbtn:hover,.sort:hover{border-color:var(--a)}',
      '.fbtn .n{background:var(--a);color:#fff;border-radius:999px;font-size:11px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}',
      /* tek Filtrele butonu: drawer şablonunda her zaman, diğer şablonlarda yalnız mobil (panel gizliyken) */
      '.fbtn{display:none}.yf.drawer .fbtn{display:inline-flex}@media(max-width:899px){.fbtn{display:inline-flex}}',
      /* native: Ticimax ızgara (2/3/4 sütun, liste) düğmelerinin vekili — yalnız masaüstü */
      '.gsw{display:none;gap:4px}.gsw button{width:42px;height:42px;border:1px solid var(--line);border-radius:8px;background:var(--chip);display:inline-flex;align-items:center;justify-content:center;color:var(--muted);padding:0}.gsw button.on{border-color:var(--a);color:var(--a)}.gsw svg{width:15px;height:15px;fill:currentColor}@media(min-width:900px){.yf.native .gsw{display:inline-flex}}',
      /* topbar dropdowns */
      '.top{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;position:relative}@media(max-width:899px){.top{display:none}}',
      '.top .tbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--chip);border-radius:var(--cr);padding:8px 12px;font-size:13px;font-weight:500;color:var(--ink)}',
      '.top .tbtn.on{border-color:var(--a);box-shadow:inset 0 0 0 1px var(--a)}.top .tbtn .n{background:var(--a);color:#fff;border-radius:999px;font-size:11px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}',
      '.top .tbtn svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.2}',
      '.pop{position:absolute;top:calc(100% + 6px);left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px rgba(0,0,0,.12);min-width:260px;max-width:360px;padding:12px 14px;max-height:380px;overflow:auto}',
      '.pop .fh{display:none}',
      /* facet panel */
      '.pan{display:block}.yf.topbar .pan,.yf.drawer .pan{display:none}@media(max-width:899px){.yf.sidebar .pan{display:none}}',
      '.f{border-bottom:1px solid var(--line);padding:12px 0}.f:first-child{padding-top:0}',
      '.fh{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:0;padding:2px 0;font-weight:var(--hw);font-size:14px;color:var(--ink);text-align:left;text-transform:' + (bold ? 'uppercase' : 'none') + ';letter-spacing:' + (bold ? '.04em' : '0') + '}',
      '.fh svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;transition:transform .15s}.f.closed .fh svg{transform:rotate(-90deg)}.f.closed .fb{display:none}',
      '.fh .sel{font-size:11px;font-weight:600;color:var(--a);margin-left:auto;margin-right:8px}',
      '.fb{padding-top:10px}',
      '.opt{display:flex;align-items:center;gap:9px;padding:5px 0;cursor:pointer;font-size:13.5px;color:var(--ink)}.opt:hover{color:var(--a)}',
      '.opt .cb{width:16px;height:16px;border:1.5px solid #c9cdd4;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex:none;background:#fff}',
      '.opt.on .cb{background:var(--a);border-color:var(--a)}.opt .cb svg{width:11px;height:11px;stroke:#fff;fill:none;stroke-width:3}',
      '.opt .c{margin-left:auto;color:var(--muted);font-size:12px}.opt.dis{opacity:.45;pointer-events:none}',
      '.more{background:none;border:0;color:var(--a);font-size:12.5px;font-weight:600;padding:6px 0 0}',
      '.fs{width:100%;border:1px solid var(--line);border-radius:var(--cr);padding:7px 10px;font-size:13px;margin-bottom:6px;background:var(--fill);outline:none}.fs:focus{border-color:var(--a)}',
      /* renk */
      '.sw{display:flex;flex-wrap:wrap;gap:8px}',
      '.swi{display:flex;flex-direction:column;align-items:center;gap:3px;width:52px;cursor:pointer;font-size:10.5px;color:var(--muted);text-align:center}',
      '.swi i{width:28px;height:28px;border-radius:var(--sr);border:1px solid rgba(0,0,0,.12);display:block;box-shadow:inset 0 0 0 2px #fff;position:relative}',
      '.swi.on i{outline:2px solid var(--a);outline-offset:2px}.swi.on{color:var(--ink);font-weight:600}.swi i.no{background:repeating-linear-gradient(45deg,#e5e7eb 0 4px,#fff 4px 8px)}',
      '.swi span{max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      /* beden */
      '.sz{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:6px}',
      '.szi{border:1px solid var(--line);border-radius:' + (t.chip === 'square' ? '6px' : '8px') + ';padding:7px 2px;text-align:center;font-size:12.5px;cursor:pointer;background:var(--chip);color:var(--ink);position:relative}',
      '.szi.on{background:var(--on);color:var(--onink);border-color:var(--on)}.szi small{display:block;font-size:9.5px;color:var(--muted);line-height:1;margin-top:2px}.szi.on small{color:rgba(255,255,255,.75)}',
      /* fiyat */
      '.pr{display:flex;flex-direction:column;gap:10px}.pr .in{display:flex;align-items:center;gap:6px}',
      '.pr input[type=number]{width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:13px;outline:none;background:#fff;-moz-appearance:textfield}.pr input::-webkit-outer-spin-button,.pr input::-webkit-inner-spin-button{-webkit-appearance:none}',
      '.pr input:focus{border-color:var(--a)}.pr .go{border:1px solid var(--a);background:var(--a);color:#fff;border-radius:8px;padding:7px 11px;font-size:12.5px;font-weight:600}',
      '.rng{position:relative;height:26px}.rng input[type=range]{position:absolute;left:0;right:0;top:0;width:100%;height:26px;margin:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none}',
      '.rng input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid var(--a);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer}',
      '.rng input[type=range]::-moz-range-thumb{pointer-events:auto;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid var(--a);cursor:pointer}',
      '.rng .tr{position:absolute;left:0;right:0;top:11px;height:4px;background:var(--line);border-radius:2px}.rng .tr i{position:absolute;top:0;bottom:0;background:var(--a);border-radius:2px}',
      '.bk{display:flex;flex-wrap:wrap;gap:6px}.bk .b{border:1px solid var(--line);border-radius:var(--cr);padding:5px 10px;font-size:12px;background:var(--chip);color:var(--ink);cursor:pointer}.bk .b.on{background:var(--on);color:var(--onink);border-color:var(--on)}.bk .b em{font-style:normal;color:var(--muted);margin-left:4px}.bk .b.on em{color:rgba(255,255,255,.75)}',
      /* puan */
      '.st{color:#f59e0b;letter-spacing:1px;font-size:13px}',
      /* grid */
      '.gr{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px 14px}@media(max-width:899px){.gr{grid-template-columns:repeat(2,1fr);gap:14px 10px}}',
      '.cd{display:flex;flex-direction:column;border-radius:var(--r);overflow:hidden;background:#fff;border:1px solid transparent;transition:box-shadow .15s,transform .15s}.cd:hover{box-shadow:0 8px 24px rgba(0,0,0,.09);transform:translateY(-2px);border-color:var(--line)}',
      '.im{position:relative;aspect-ratio:3/4;background:var(--fill);overflow:hidden}.im img{width:100%;height:100%;object-fit:cover;display:block;transition:opacity .2s}.im img.b{position:absolute;inset:0;opacity:0}.cd:hover .im img.b{opacity:1}',
      '.im .bd{position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:4px}.im .bd span{background:#dc2626;color:#fff;font-size:11px;font-weight:700;border-radius:6px;padding:3px 7px;line-height:1}.im .bd span.nw{background:var(--a)}',
      '.im .oos{position:absolute;inset:auto 0 0 0;background:rgba(17,24,39,.75);color:#fff;font-size:11px;text-align:center;padding:5px}',
      '.cb2{padding:10px 8px 12px;display:flex;flex-direction:column;gap:5px}.nm{font-size:13px;line-height:1.35;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:35px}',
      '.pw{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}.pw .p{font-weight:700;font-size:14.5px}.pw .o{color:var(--muted);text-decoration:line-through;font-size:12px}.pw .d{color:#dc2626;font-size:12px;font-weight:700}',
      '.rt{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--muted)}.rt .st{font-size:11px}',
      '.cs{display:flex;align-items:center;gap:4px;min-height:14px}.cs i{width:12px;height:12px;border-radius:var(--sr);border:1px solid rgba(0,0,0,.15);display:block}.cs i.no{background:repeating-linear-gradient(45deg,#e5e7eb 0 3px,#fff 3px 6px)}.cs small{font-size:10.5px;color:var(--muted);margin-left:2px}',
      '.szl{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ld{display:flex;justify-content:center;padding:26px 0 10px}.ld button{border:1px solid var(--a);background:#fff;color:var(--a);border-radius:var(--cr);padding:10px 22px;font-weight:600;font-size:13.5px}.ld button:hover{background:var(--a);color:#fff}',
      '.sk{aspect-ratio:3/4;background:linear-gradient(90deg,var(--fill) 25%,#eceef2 37%,var(--fill) 63%);background-size:400% 100%;animation:yfs 1.2s infinite;border-radius:var(--r)}@keyframes yfs{0%{background-position:100% 0}100%{background-position:0 0}}',
      '.empty{text-align:center;padding:40px 10px;color:var(--muted)}.empty b{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}.empty button{margin-top:12px;border:1px solid var(--a);background:var(--a);color:#fff;border-radius:var(--cr);padding:9px 18px;font-weight:600}',
      /* mobil/drawer panel */
      '.ov{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:2147483000;display:none}.ov.on{display:block}',
      '.dw{position:fixed;z-index:2147483001;background:#fff;display:flex;flex-direction:column;transform:translateX(-105%);transition:transform .22s ease;top:0;bottom:0;left:0;width:min(var(--dw),92vw);box-shadow:0 0 40px rgba(0,0,0,.2)}',
      /* mobil: tam ekran, sağdan kayar; alt buton şeridi safe-area'ya saygılı */
      '.dw.on{transform:none}@media(max-width:899px){.dw{left:0;right:0;top:0;bottom:0;width:auto;max-height:none;border-radius:0;transform:translateX(-105%)}.dw.on{transform:none}.dw .ft{padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}}',
      '.dw .hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);font-weight:700;font-size:15px}.dw .hd button{background:none;border:0;font-size:22px;line-height:1;color:var(--muted)}',
      '.dw .bd2{overflow:auto;padding:4px 16px 16px;flex:1}.dw .ft{padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:8px;background:#fff}',
      '.dw .ft .ap{flex:1;background:var(--a);color:#fff;border:0;border-radius:var(--cr);padding:12px;font-weight:700;font-size:14px}.dw .ft .cl{border:1px solid var(--line);background:#fff;border-radius:var(--cr);padding:12px 14px;font-weight:600;color:var(--ink)}',
      /* native: panel ayrı host (sol sütun), araç çubuğu ayrı host (liste üstü); ızgara/sıralama Ticimax'ın */
      '.yf.native{display:block}.yf.native .gr,.yf.native #ld{display:none}.yf.native .pan{display:block}@media(max-width:899px){.yf.native .pan{display:none}}',
      '.yf.native.bar .tb{margin-bottom:10px}.yf.native.side .pan{padding-right:6px;max-height:calc(100vh - 24px);overflow:auto}',
      '.yf.dwhost{display:contents}',
      '.hidden{display:none!important}'
    ].join('');
  }

  /* ═══ montaj ═══ */
  function findMount(spec) {
    spec = spec || 'before:.ProductListContent';
    var m = spec.match(/^(before|after|into):(.+)$/), mode = m ? m[1] : 'before', sel = m ? m[2] : spec;
    var cands = qsa(sel.trim()).filter(function (el) { return el.offsetParent !== null || getComputedStyle(el).display !== 'none' || true; });
    var el = cands[0] || null;
    return el ? { el: el, mode: mode } : null;
  }
  function hideTheme(selectors) {
    if (!selectors) return;
    var list = selectors.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!list.length) return;
    var st = document.createElement('style');
    st.id = 'yunbi-filter-hide';
    // html body öneki: temanın kendi !important kurallarına karşı özgüllük
    st.textContent = list.map(function (x) { return 'html body ' + x; }).join(',') + '{display:none!important}';
    document.head.appendChild(st);
    // Inline !important, satır içi !important'ı bile ezer; tema sonradan eklerse gözlemci yakalar
    var apply = function () { list.forEach(function (sel) { qsa(sel).forEach(function (el) { el.style.setProperty('display', 'none', 'important'); }); }); };
    apply();
    try { new MutationObserver(apply).observe(document.body, { childList: true, subtree: true }); } catch (e) { }
  }
  function mount() {
    var sel = cfg.selectors || {};
    var tpl = cfg.template;
    if (MODE === 'native') {
      /* Ticimax'ta filtre bloğu çoğu temada listenin ÜSTÜNDE (top filter) ve liste tam genişlik.
         Sidebar şablonu için liste konteynerini bir flex satırına alıp soluna panel koyarız;
         araç çubuğu (sayı/çipler/mobil buton) listenin hemen üstünde ayrı bir host'tur. */
      var listEl = qs(sel.list || '.ProductListContent');
      if (!listEl) { dbg('native: ürün listesi konteyneri yok'); return false; }
      // Tema ızgara düğmelerini (2/3/4'lü, liste) kendisi gösteriyor mu? Gizliyorsa o modları desteklemiyor demektir → vekil çizilmez
      nb.gridBtns = qsa('.blockSelect .btnCatSorting').filter(function (b) { return getComputedStyle(b).display !== 'none' && b.getClientRects().length > 0; });
      hideTheme(sel.hide_native || '.filterBlock, .mobilFilterOpenBtn');
      if (sel.css_native) { // tema düzeltme CSS'i (panelden): gizlenen sıralama çubuğunun bıraktığı boşluk vb.
        try { var fx = document.createElement('style'); fx.id = 'yunbi-filter-themefix'; fx.textContent = String(sel.css_native).replace(/<\/style/gi, ''); document.head.appendChild(fx); } catch (e) { }
      }
      var lay = document.createElement('style');
      lay.id = 'yunbi-filter-layout';
      lay.textContent = '.yunbi-filter-row{display:flex;gap:26px;align-items:flex-start;width:100%;clear:both}.yunbi-filter-col{flex:1 1 0;min-width:0;width:100%}#yunbi-filter-panel{flex:0 0 250px;max-width:250px;position:sticky;top:12px}@media(max-width:899px){.yunbi-filter-row{display:block}#yunbi-filter-panel{display:none!important}}';
      document.head.appendChild(lay);
      var row = document.createElement('div'); row.className = 'yunbi-filter-row';
      var col = document.createElement('div'); col.className = 'yunbi-filter-col';
      listEl.parentNode.insertBefore(row, listEl);
      if (tpl === 'sidebar') {
        var pan = makeHost('yunbi-filter-panel', { el: row, mode: 'into' });
        root = pan.root;
        pan.wrap.className = 'yf native side sidebar';
        pan.wrap.innerHTML = '<aside class="pan" id="pan"></aside>';
        bind(pan.wrap);
      }
      row.appendChild(col);
      var bar = makeHost('yunbi-filter', { el: col, mode: 'into' });
      root2 = bar.root;
      if (!root) root = root2;
      bar.wrap.className = 'yf native bar ' + tpl;
      bar.wrap.innerHTML = '<div class="top" id="top"></div><div class="tb" id="tb"></div>';
      bind(bar.wrap);
      col.appendChild(listEl);
      mountedEl = listEl;
      mountDrawer();
      hookTicimaxList(); watchTicimaxBar(); pollSortings();
      return true;
    }
    var target = FORCE_MOUNT ? findMount(FORCE_MOUNT) : null;
    if (!target) target = findMount('into:[data-yunbi-filter]');
    if (!target) target = findMount(sel.mount);
    if (!target) { dbg('mount hedefi yok'); return false; }
    if (!FORCE_MOUNT && !qs('[data-yunbi-filter]')) hideTheme(sel.hide);
    var h = makeHost('yunbi-filter', target);
    root = h.root;
    mountedEl = target.el;
    h.wrap.className = 'yf ' + tpl;
    h.wrap.innerHTML = '<aside class="pan" id="pan"></aside><div class="main"><div class="top" id="top"></div><div class="tb" id="tb"></div><div class="gr" id="gr"></div><div id="ld"></div></div>';
    bind(h.wrap);
    mountDrawer();
    return true;
  }
  /* Çekmece + karartma: temanın transform/z-index stacking context'ine takılmaması için doğrudan
     <body> altında ayrı bir host'ta yaşar (fixed konum ancak böyle sayfanın en üstüne çıkar). */
  function drawerHTML() { return ''; }
  function mountDrawer() {
    if (root3) return;
    var d = makeHost('yunbi-filter-drawer', { el: document.body, mode: 'into' });
    d.host.style.cssText = 'display:block;position:static;width:0;height:0;clear:none';
    root3 = d.root;
    d.wrap.className = 'yf dwhost';
    d.wrap.innerHTML = '<div class="ov" id="ov"></div><div class="dw" id="dw"><div class="hd"><span>Filtrele</span><button id="dwx" aria-label="Kapat">×</button></div><div class="bd2" id="dwb"></div><div class="ft"><button class="cl" id="dwc">Temizle</button><button class="ap" id="dwa">Ürünleri göster</button></div></div>';
    bind(d.wrap);
  }
  function makeHost(id, target) {
    var h = document.createElement('div');
    h.id = id;
    h.style.cssText = 'display:block;width:100%;clear:both;position:relative;z-index:1';
    if (target.mode === 'into') target.el.appendChild(h);
    else if (target.mode === 'after') target.el.parentNode.insertBefore(h, target.el.nextSibling);
    else target.el.parentNode.insertBefore(h, target.el);
    var r = h.attachShadow ? h.attachShadow({ mode: 'open' }) : h;
    var st = document.createElement('style');
    st.textContent = css(cfg.theme || {});
    r.appendChild(st);
    var wrap = document.createElement('div');
    r.appendChild(wrap);
    if (!host) host = h;
    return { host: h, root: r, wrap: wrap };
  }

  /* ═══ render ═══ */
  function renderAll() { renderPanel(); renderTop(); renderToolbar(); if (MODE !== 'native') renderGrid(); renderDrawer(); }
  function iconChev() { return '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'; }
  function iconCheck() { return '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>'; }
  function iconFilter() { return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>'; }

  function facetSelected(f) {
    var s = state.filters;
    if (f.type === 'color') return s.color; if (f.type === 'size') return s.size; if (f.type === 'brand') return s.brand;
    if (f.type === 'category') return s.category; if (f.type === 'spec') return s.spec[f.key.slice(5)] || [];
    if (f.type === 'flag') return (f.key === 'discount' ? s.discount : s.new) ? ['1'] : [];
    if (f.type === 'rating') return s.rating != null ? [String(s.rating)] : [];
    if (f.type === 'price') return (s.price_min != null || s.price_max != null) ? ['1'] : [];
    return [];
  }
  function facetHTML(f, ctx) {
    var sel = facetSelected(f), open = ui.open[f.key] != null ? ui.open[f.key] : !f.collapsed || sel.length > 0;
    var body = '';
    if (f.type === 'price') body = priceHTML(f, ctx);
    else if (f.type === 'color') body = colorHTML(f, sel);
    else if (f.type === 'size') body = sizeHTML(f, sel);
    else if (f.type === 'rating') body = ratingHTML(f, sel);
    else body = listHTML(f, sel);
    if (!body) return '';
    var selTxt = sel.length && f.type !== 'price' && f.type !== 'flag' ? '<span class="sel">' + sel.length + ' seçili</span>' : '';
    return '<div class="f' + (open ? '' : ' closed') + '" data-f="' + esc(f.key) + '"><button class="fh" data-toggle="' + esc(f.key) + '">' + esc(f.label) + selTxt + iconChev() + '</button><div class="fb">' + body + '</div></div>';
  }
  function listHTML(f, sel) {
    var vals = f.values || [];
    if (!vals.length) return '';
    var limit = (cfg.rules && cfg.rules.show_more_limit) || 8, showAll = ui.showMore[f.key], q = (ui.search[f.key] || '').toLowerCase();
    var searchable = vals.length > 12;
    var list = vals;
    if (q) list = vals.filter(function (v) { return String(v.label).toLowerCase().indexOf(q) >= 0; });
    // seçili değerler listenin başında kalır
    list = list.slice().sort(function (a, b) { var sa = sel.indexOf(a.value) >= 0 ? 0 : 1, sb = sel.indexOf(b.value) >= 0 ? 0 : 1; return sa - sb; });
    var shown = showAll || q ? list : list.slice(0, limit);
    var h = searchable ? '<input class="fs" data-fs="' + esc(f.key) + '" placeholder="' + esc(f.label) + ' ara…" value="' + esc(ui.search[f.key] || '') + '">' : '';
    h += shown.map(function (v) {
      var on = sel.indexOf(v.value) >= 0, dis = !on && v.count === 0;
      return '<label class="opt' + (on ? ' on' : '') + (dis ? ' dis' : '') + '" data-opt="1" data-facet="' + esc(f.key) + '" data-val="' + esc(v.value) + '"><span class="cb">' + iconCheck() + '</span><span>' + esc(v.label) + '</span>' + (cfg.rules.show_counts && v.count != null ? '<span class="c">' + v.count + '</span>' : '') + '</label>';
    }).join('');
    if (!showAll && !q && list.length > limit) h += '<button class="more" data-more="' + esc(f.key) + '">+ ' + (list.length - limit) + ' seçenek daha</button>';
    else if (showAll && list.length > limit) h += '<button class="more" data-less="' + esc(f.key) + '">Daha az göster</button>';
    return h;
  }
  function colorHTML(f, sel) {
    var vals = f.values || []; if (!vals.length) return '';
    var limit = 12, showAll = ui.showMore[f.key];
    var list = vals.slice().sort(function (a, b) { var sa = sel.indexOf(a.value) >= 0 ? 0 : 1, sb = sel.indexOf(b.value) >= 0 ? 0 : 1; return sa - sb || b.count - a.count; });
    var shown = showAll ? list : list.slice(0, limit);
    var h = '<div class="sw">' + shown.map(function (v) {
      var on = sel.indexOf(v.value) >= 0;
      var sw = v.hex ? '<i style="background:' + esc(v.hex) + '"></i>' : '<i class="no"></i>';
      return '<div class="swi' + (on ? ' on' : '') + '" data-opt="1" data-facet="' + esc(f.key) + '" data-val="' + esc(v.value) + '" title="' + esc(v.label) + ' (' + v.count + ')">' + sw + '<span>' + esc(v.label) + '</span></div>';
    }).join('') + '</div>';
    if (!showAll && list.length > limit) h += '<button class="more" data-more="' + esc(f.key) + '">+ ' + (list.length - limit) + ' renk daha</button>';
    return h;
  }
  function sizeHTML(f, sel) {
    var vals = f.values || []; if (!vals.length) return '';
    return '<div class="sz">' + vals.map(function (v) {
      var on = sel.indexOf(v.value) >= 0;
      return '<div class="szi' + (on ? ' on' : '') + '" data-opt="1" data-facet="' + esc(f.key) + '" data-val="' + esc(v.value) + '">' + esc(v.label) + (cfg.rules.show_counts ? '<small>' + v.count + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function ratingHTML(f, sel) {
    var vals = f.values || []; if (!vals.length) return '';
    return vals.map(function (v) {
      var on = sel.indexOf(v.value) >= 0, n = Math.round(Number(v.value));
      return '<label class="opt' + (on ? ' on' : '') + '" data-opt="1" data-facet="rating" data-val="' + esc(v.value) + '"><span class="cb">' + iconCheck() + '</span><span class="st">' + '★'.repeat(n) + '☆'.repeat(5 - n) + '</span><span>' + esc(v.label) + '</span>' + (cfg.rules.show_counts ? '<span class="c">' + v.count + '</span>' : '') + '</label>';
    }).join('');
  }
  function priceHTML(f, ctx) {
    var s = state.filters, mn = Number(f.min) || 0, mx = Number(f.max) || 0;
    if (mx <= mn) return '';
    var lo = s.price_min != null ? s.price_min : mn, hi = s.price_max != null ? s.price_max : mx;
    lo = Math.max(mn, Math.min(lo, mx)); hi = Math.max(mn, Math.min(hi, mx));
    var pct = function (v) { return ((v - mn) / (mx - mn) * 100).toFixed(2); };
    var h = '<div class="pr" data-pmin="' + mn + '" data-pmax="' + mx + '">' +
      '<div class="rng"><div class="tr"><i style="left:' + pct(lo) + '%;right:' + (100 - pct(hi)) + '%"></i></div>' +
      '<input type="range" class="rlo" min="' + mn + '" max="' + mx + '" value="' + lo + '" step="1"><input type="range" class="rhi" min="' + mn + '" max="' + mx + '" value="' + hi + '" step="1"></div>' +
      '<div class="in"><input type="number" class="pmin" placeholder="' + mn + '" value="' + (s.price_min != null ? s.price_min : '') + '" min="0"><span>–</span><input type="number" class="pmax" placeholder="' + mx + '" value="' + (s.price_max != null ? s.price_max : '') + '" min="0"><button class="go" data-pgo="1">Uygula</button></div>';
    if (cfg.rules.price_buckets && f.buckets && f.buckets.length > 1) {
      h += '<div class="bk">' + f.buckets.map(function (b) {
        var on = s.price_min === b.min && s.price_max === b.max;
        return '<span class="b' + (on ? ' on' : '') + '" data-bk="1" data-min="' + b.min + '" data-max="' + b.max + '">' + b.min + ' – ' + b.max + ' TL<em>' + b.count + '</em></span>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }
  function panelHTML(ctx) { return data.facets.map(function (f) { return facetHTML(f, ctx); }).join(''); }

  function renderPanel() { var el = q1('#pan'); if (el) el.innerHTML = panelHTML('side'); }
  function shownTotal() { // araç çubuğu + çekmece butonu aynı kaynağı gösterir (native: Ticimax'ın adedi)
    var native = MODE === 'native', total = native ? nativeTotal() : data.total;
    var busy = ui.loading || (native && nb.busy) || total == null;
    return { busy: busy, total: total };
  }
  function renderDrawerCount() { var a = q1('#dwa'); if (!a) return; var c = shownTotal(); a.textContent = c.busy ? '…' : c.total + ' ürünü göster'; }
  function renderDrawer() { var el = q1('#dwb'); if (el) el.innerHTML = panelHTML('drawer'); renderDrawerCount(); }
  function renderTop() {
    var el = q1('#top'); if (!el) return;
    if (cfg.template !== 'topbar') { el.innerHTML = ''; return; }
    el.innerHTML = data.facets.map(function (f) {
      var sel = facetSelected(f), on = ui.popover === f.key;
      return '<div style="position:relative"><button class="tbtn' + (sel.length ? ' on' : '') + '" data-pop="' + esc(f.key) + '">' + esc(f.label) + (sel.length ? '<span class="n">' + sel.length + '</span>' : '') + iconChev() + '</button>' +
        (on ? '<div class="pop">' + facetHTML(f, 'pop').replace(/class="f( closed)?"/, 'class="f"') + '</div>' : '') + '</div>';
    }).join('');
  }
  function renderToolbar() {
    var el = q1('#tb'); if (!el) return;
    var n = activeCount(), native = MODE === 'native';
    var chips = data.applied.map(function (c) { return '<span class="chip">' + esc(c.label) + '<b data-rm="1" data-facet="' + esc(c.facet) + '" data-val="' + esc(c.value) + '" title="Kaldır">×</b></span>'; }).join('');
    // Kapsam çipi (menüden gelen segment daraltması): kaldırınca kampanya sayfasının tamamı (tam yenileme — Ticimax listesi sıfırdan)
    if (data.scope && data.scope.name) chips = '<span class="chip">' + esc(data.scope.name) + '<b data-rmscope="1" title="Kaldır">×</b></span>' + chips;
    var c = shownTotal(), total = c.total, busy = c.busy;
    renderDrawerCount();
    var sorts;
    if (native) {
      var ns = nativeSortList();
      sorts = ns ? ns.map(function (o) { return '<option value="' + esc(o.key) + '"' + (o.on ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') : '';
    } else {
      sorts = (data.sorts || []).map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === state.sort ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
    }
    var sortIcon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>';
    el.innerHTML = '<span class="cnt">' + (busy ? '…' : total) + ' ürün' + (category && category.name ? ' <small>· ' + esc(category.name) + '</small>' : '') + '</span>' +
      '<div class="ch">' + chips + (n ? '<button class="clr" data-clear="1">Tümünü temizle</button>' : '') + '</div>' +
      '<div class="act"><button class="fbtn" data-open="1">' + iconFilter() + 'Filtrele' + (n ? '<span class="n">' + n + '</span>' : '') + '</button>' +
      (native ? gridHTML() : '') +
      (sorts ? '<label class="sort">' + sortIcon + '<select data-sort="1" aria-label="Sıralama">' + sorts + '</select><svg class="sv" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></label>' : '') + '</div>';
  }
  function cardHTML(p, i) {
    var imgs = (p.images && p.images.length ? p.images : (p.image ? [p.image] : [])).slice(0, 2);
    var im = imgs.length ? '<img src="' + esc(imgs[0]) + '" alt="' + esc(p.name) + '" loading="' + (i < 8 ? 'eager' : 'lazy') + '">' + (imgs[1] ? '<img class="b" src="' + esc(imgs[1]) + '" alt="" loading="lazy">' : '') : '';
    var bd = '';
    if (p.discount_pct) bd += '<span>%' + p.discount_pct + '</span>';
    if (p.is_new) bd += '<span class="nw">Yeni</span>';
    var price = p.discounted_price ? '<span class="p">' + money(p.discounted_price) + '</span><span class="o">' + money(p.price) + '</span>' : '<span class="p">' + money(p.price) + '</span>';
    var rt = p.rating ? '<div class="rt"><span class="st">★</span>' + String(p.rating).replace('.', ',') + '</div>' : '';
    var cs = (p.colors && p.colors.length > 1) ? '<div class="cs">' + p.colors.slice(0, 5).map(function (c) { return c.hex ? '<i style="background:' + esc(c.hex) + '" title="' + esc(c.name) + '"></i>' : '<i class="no" title="' + esc(c.name) + '"></i>'; }).join('') + (p.color_count > 5 ? '<small>+' + (p.color_count - 5) + '</small>' : '') + '</div>' : '';
    var sz = (p.sizes && p.sizes.length) ? '<div class="szl">' + (p.sizes.length > 6 ? esc(p.sizes[0]) + ' – ' + esc(p.sizes[p.sizes.length - 1]) + ' (' + p.sizes.length + ' beden)' : p.sizes.map(esc).join(' · ')) + '</div>' : '';
    return '<a class="cd" href="' + esc(p.url) + '" data-pid="' + esc(p.id) + '" data-i="' + i + '"><div class="im">' + im + (bd ? '<div class="bd">' + bd + '</div>' : '') + (p.in_stock ? '' : '<span class="oos">Tükendi</span>') + '</div>' +
      '<div class="cb2"><div class="nm">' + esc(p.name) + '</div><div class="pw">' + price + '</div>' + rt + cs + sz + '</div></a>';
  }
  function renderGrid() {
    var el = q1('#gr'), ld = q1('#ld'); if (!el) return;
    if (!data.products.length) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Bu filtrelerle ürün bulunamadı</b>Filtreleri gevşetip tekrar deneyin.' + (activeCount() ? '<br><button data-clear="1">Filtreleri temizle</button>' : '') + '</div>';
      ld.innerHTML = ''; return;
    }
    el.innerHTML = data.products.map(cardHTML).join('');
    ld.innerHTML = data.has_more ? '<div class="ld"><button data-more-products="1">Daha fazla ürün göster (' + (data.total - data.products.length) + ')</button></div>' : '';
  }
  function renderGridLoading() { var el = q1('#gr'); if (el) el.innerHTML = new Array(8).join('<div class="sk"></div>') + '<div class="sk"></div>'; }
  function renderError() { var el = q1('#gr'); if (el) el.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Ürünler yüklenemedi</b>Lütfen sayfayı yenileyin.</div>'; }

  /* ═══ etkileşim ═══ */
  function toggleValue(facetKey, val) {
    var f = state.filters, arrKey = { color: 'color', size: 'size', brand: 'brand', category: 'category' }[facetKey];
    var wasOn;
    if (arrKey) { var i = f[arrKey].indexOf(val); wasOn = i >= 0; if (wasOn) f[arrKey].splice(i, 1); else f[arrKey].push(val); }
    else if (facetKey === 'discount' || facetKey === 'new') { wasOn = f[facetKey]; f[facetKey] = !wasOn; }
    else if (facetKey === 'rating') { wasOn = String(f.rating) === String(val); f.rating = wasOn ? null : Number(val); }
    else if (facetKey.indexOf('spec:') === 0) { var k = facetKey.slice(5); f.spec[k] = f.spec[k] || []; var j = f.spec[k].indexOf(val); wasOn = j >= 0; if (wasOn) f.spec[k].splice(j, 1); else f.spec[k].push(val); if (!f.spec[k].length) delete f.spec[k]; }
    if (!wasOn) track('apply', { facet: facetKey, value: val });
    commit();
  }
  function removeChip(facetKey, val) {
    var f = state.filters;
    if (facetKey === 'price') { f.price_min = null; f.price_max = null; }
    else if (facetKey === 'discount' || facetKey === 'new') f[facetKey] = false;
    else if (facetKey === 'rating') f.rating = null;
    else if (facetKey.indexOf('spec:') === 0) { var k = facetKey.slice(5); if (f.spec[k]) { f.spec[k] = f.spec[k].filter(function (v) { return v !== val; }); if (!f.spec[k].length) delete f.spec[k]; } }
    else if (f[facetKey]) f[facetKey] = f[facetKey].filter(function (v) { return v !== val; });
    commit();
  }
  function clearAll() { state.filters = emptyFilters(); track('clear'); commit(); }
  function setPrice(min, max) {
    var f = state.filters;
    f.price_min = (min === '' || min == null || isNaN(min)) ? null : Number(min);
    f.price_max = (max === '' || max == null || isNaN(max)) ? null : Number(max);
    if (f.price_min != null && f.price_max != null && f.price_min > f.price_max) { var t = f.price_min; f.price_min = f.price_max; f.price_max = t; }
    track('apply', { facet: 'price', value: (f.price_min != null ? f.price_min : '') + '-' + (f.price_max != null ? f.price_max : '') });
    commit();
  }
  function commit() { state.page = 1; if (MODE !== 'native') writeUrl(true); fetchList(false); }

  function openDrawer() { ui.panelOpen = true; q1('#ov').classList.add('on'); q1('#dw').classList.add('on'); document.documentElement.style.overflow = 'hidden'; }
  function closeDrawer() { ui.panelOpen = false; q1('#ov').classList.remove('on'); q1('#dw').classList.remove('on'); document.documentElement.style.overflow = ''; }

  function bind(wrap) {
    on(wrap, 'click', '[data-opt]', function (e, t) { e.preventDefault(); toggleValue(t.getAttribute('data-facet'), t.getAttribute('data-val')); });
    on(wrap, 'click', '[data-rm]', function (e, t) { e.preventDefault(); removeChip(t.getAttribute('data-facet'), t.getAttribute('data-val')); });
    on(wrap, 'click', '[data-clear]', function (e) { e.preventDefault(); clearAll(); });
    on(wrap, 'click', '[data-rmscope]', function (e) {
      e.preventDefault(); track('clear', { value: 'scope' });
      var p = new URLSearchParams(location.search); p.delete(PARAM.scope); p.delete('ukids'); if (data.scope && data.scope.native) p.delete('filtre');
      var q = p.toString().replace(/%2C/gi, ',');
      location.assign(location.pathname + (q ? '?' + q : ''));
    });
    on(wrap, 'click', '[data-toggle]', function (e, t) { e.preventDefault(); var k = t.getAttribute('data-toggle'), f = t.closest('.f'); var open = f.classList.contains('closed'); ui.open[k] = open; f.classList.toggle('closed', !open); });
    on(wrap, 'click', '[data-more]', function (e, t) { e.preventDefault(); ui.showMore[t.getAttribute('data-more')] = true; renderPanel(); renderDrawer(); renderTop(); });
    on(wrap, 'click', '[data-less]', function (e, t) { e.preventDefault(); ui.showMore[t.getAttribute('data-less')] = false; renderPanel(); renderDrawer(); renderTop(); });
    on(wrap, 'input', '[data-fs]', function (e, t) { ui.search[t.getAttribute('data-fs')] = t.value; var box = t.closest('.fb'); var f = data.facets.filter(function (x) { return x.key === t.getAttribute('data-fs'); })[0]; if (f && box) { var pos = t.selectionStart; box.innerHTML = listHTML(f, facetSelected(f)); var ni = qs('[data-fs]', box); if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (x) { } } } });
    on(wrap, 'click', '[data-pgo]', function (e, t) { e.preventDefault(); var pr = t.closest('.pr'); setPrice(qs('.pmin', pr).value, qs('.pmax', pr).value); });
    on(wrap, 'keydown', '.pmin,.pmax', function (e, t) { if (e.key === 'Enter') { e.preventDefault(); var pr = t.closest('.pr'); setPrice(qs('.pmin', pr).value, qs('.pmax', pr).value); } });
    on(wrap, 'click', '[data-bk]', function (e, t) { e.preventDefault(); var mn = Number(t.getAttribute('data-min')), mx = Number(t.getAttribute('data-max')); if (t.classList.contains('on')) setPrice(null, null); else setPrice(mn, mx); });
    on(wrap, 'input', '.rlo,.rhi', function (e, t) {
      var pr = t.closest('.pr'), lo = qs('.rlo', pr), hi = qs('.rhi', pr), mn = Number(pr.getAttribute('data-pmin')), mx = Number(pr.getAttribute('data-pmax'));
      var a = Number(lo.value), b = Number(hi.value); if (a > b) { if (t === lo) { hi.value = a; b = a; } else { lo.value = b; a = b; } }
      qs('.pmin', pr).value = a === mn ? '' : a; qs('.pmax', pr).value = b === mx ? '' : b;
      var bar = qs('.tr i', pr); if (bar) { bar.style.left = ((a - mn) / (mx - mn) * 100) + '%'; bar.style.right = (100 - (b - mn) / (mx - mn) * 100) + '%'; }
    });
    on(wrap, 'change', '.rlo,.rhi', function (e, t) { var pr = t.closest('.pr'); setPrice(qs('.pmin', pr).value, qs('.pmax', pr).value); });
    on(wrap, 'change', '[data-sort]', function (e, t) { if (MODE === 'native') { nativeSort(t.value); return; } state.sort = t.value; track('sort', { value: t.value }); commit(); });
    on(wrap, 'click', '[data-grid]', function (e, t) { e.preventDefault(); var ty = t.getAttribute('data-grid'); var b = (nb.gridBtns || []).filter(function (x) { return (x.getAttribute('data-type') || '') === ty; })[0]; if (b) { try { localStorage.setItem('yunbi_grid', '1'); } catch (x) { } try { b.click(); } catch (x) { } } setTimeout(renderToolbar, 60); });
    on(wrap, 'click', '[data-more-products]', function (e, t) { e.preventDefault(); t.disabled = true; t.textContent = 'Yükleniyor…'; state.page++; writeUrl(false); fetchList(true); });
    on(wrap, 'click', '[data-open]', function (e) { e.preventDefault(); renderDrawer(); openDrawer(); });
    on(wrap, 'click', '#dwx,#ov', function (e) { e.preventDefault(); closeDrawer(); });
    on(wrap, 'click', '#dwa', function (e) { e.preventDefault(); closeDrawer(); });
    on(wrap, 'click', '#dwc', function (e) { e.preventDefault(); clearAll(); });
    on(wrap, 'click', '[data-pop]', function (e, t) { e.preventDefault(); e.stopPropagation(); var k = t.getAttribute('data-pop'); ui.popover = ui.popover === k ? null : k; renderTop(); });
    on(wrap, 'click', '.pop', function (e) { e.stopPropagation(); });
    on(wrap, 'click', '.cd', function (e, t) { track('click', { product_id: t.getAttribute('data-pid'), value: t.getAttribute('data-i') }); });
    if (!bind.globalsBound) {
      bind.globalsBound = true;
      document.addEventListener('click', function () { if (ui.popover) { ui.popover = null; renderTop(); } });
      window.addEventListener('resize', function () { if (ui.panelOpen && isDesktop() && cfg.template !== 'drawer') closeDrawer(); });
    }
  }

  /* ═══ başlat ═══ */
  function isCategoryPage() {
    if (FORCE_PATH) return true;
    var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    var paths = cfg.category_paths || [];
    if (paths.indexOf(p) >= 0) return true;
    // Ticimax productsModel.pageType: 1 = kategori. Etiket (5), marka, arama sayfalarında Yunbi'de karşılık yok → temaya dokunma
    var pm = window.productsModel;
    if (pm && pm.pageType != null && Number(pm.pageType) !== 1) return false;
    // Ticimax ipuçları: ürün listesi + filtre bloğu birlikte ise kategori sayfasıdır (yol listede olmasa da dene)
    return !!(qs('.ProductListContent') && qs('.filterBlock'));
  }
  function start() {
    getJSON(API + '/config').then(function (c) {
      cfg = c || {};
      cfg.rules = cfg.rules || {};
      if (FORCE_TPL === 'sidebar' || FORCE_TPL === 'topbar' || FORCE_TPL === 'drawer') cfg.template = FORCE_TPL;
      if (!cfg.template) cfg.template = 'sidebar';
      if (FORCE_THEME) cfg.theme = Object.assign({}, cfg.theme || {}, FORCE_THEME);
      if (!isCategoryPage()) { dbg('kategori sayfası değil'); return; }
      catPath = FORCE_PATH || location.pathname;
      // Mod: panel ayarı native ise ve Ticimax globalleri varsa liste Ticimax'ta kalır; aksi hâlde Yunbi çizer
      var ticimaxOk = !!(window.filterModel && window.filterModel.filter && typeof window.getProducts === 'function');
      MODE = (FORCE_MODE === 'native' || FORCE_MODE === 'takeover') ? FORCE_MODE : (cfg.mode === 'native' ? 'native' : 'takeover');
      if (MODE === 'native' && (!ticimaxOk || FORCE_MOUNT)) { dbg('native istendi ama Ticimax globalleri yok → takeover'); MODE = 'takeover'; }
      dbg('mode', MODE, 'template', cfg.template);
      readUrl();
      data.sorts = cfg.sorts || data.sorts;
      if (!state.sort && cfg.rules.sort_default) state.sort = cfg.rules.sort_default;
      var go = function (pre) {
        if (MODE === 'native') hookTicimaxUrl();
        if (!mount()) return;
        renderToolbar();
        fetchList(MODE === 'native' ? 'init' : false, pre);
      };
      if (MODE === 'native' && !FORCE_PATH) {
        // Yunbi'nin tanımadığı liste sayfasında (404 category_not_found) tema filtresi GİZLENMEMELİ:
        // önce listeyi çek, kategori doğrulanınca temaya dokun (aynı cevap ilk çizimde kullanılır)
        getJSON(apiUrl('/list', listParams())).then(function (d) {
          if (d && d.category) go(d); else dbg('kategori doğrulanamadı → tema filtresi kalır');
        }).catch(function (e) { dbg('liste alınamadı → tema filtresi kalır', e); });
      } else go();
      window.YunbiFilter = { mode: MODE, refresh: function () { fetchList(false); }, state: state, sort: function (k) { if (MODE === 'native') nativeSort(k); else { state.sort = k; commit(); } }, setPath: function (p) { catPath = p; state.filters = emptyFilters(); state.page = 1; fetchList(false); } };
    }).catch(function (e) { dbg('config error', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* >>> yunbi-seo-content — kaynak: widget/seo.js (kategori üst/alt SEO metni yerleşimi). Elle düzenleme: seo.js değişince bu bölümü yenile. */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi SEO — kategori içeriği yerleşimi.
     Ticimax kategori "İçerik" alanı tek parça ve sayfanın ALTINDA basılır
     (#mainHolder_divKategoriBaslik). Yunbi SEO içeriği iki blokla yazar:
       <div data-yb-seo="top">    H1 + üst metin   → ürün listesinin ÜSTÜNE taşınır
       <div data-yb-seo="bottom"> alt metin + SSS  → yerinde (altta) kalır, katlanır
     Blok yoksa hiçbir şey yapmaz. JS çalışmazsa içerik olduğu gibi altta görünür.
     SSS başlık/cevap çiftlerinden FAQPage JSON-LD üretir.

     Bu dosya filter.js sonuna da gömülüdür (tema zaten yüklüyor); tek başına:
       <script src="https://eticaretq.com/widget/seo.js?v=1"></script>
     ═══════════════════════════════════════════════════════════════════════ */

  if (window.__ybSeoContent) return;
  window.__ybSeoContent = 1;

  var CSS = '' +
    '.yb-seo{box-sizing:border-box;width:100%;clear:both;float:none;color:#333;font-size:14px;line-height:1.65;text-align:left}' +
    '.yb-seo *{box-sizing:border-box}' +
    '.yb-seo a{color:inherit;text-decoration:underline}' +
    '.yb-seo-top{padding:4px 0 12px}' +
    '.yb-seo-top h1{font-size:22px;line-height:1.25;font-weight:600;margin:0 0 6px;padding:0;color:#111}' +
    '.yb-seo-top p{margin:0;max-width:980px}' +
    '.yb-seo-bottom{max-width:1100px;margin:28px auto 12px;padding:0 15px;position:relative}' +
    '.yb-seo-bottom h2{font-size:18px;line-height:1.3;font-weight:600;margin:22px 0 8px;color:#111}' +
    '.yb-seo-bottom h3{font-size:15px;line-height:1.35;font-weight:600;margin:16px 0 6px;color:#111}' +
    '.yb-seo-bottom p{margin:0 0 10px}' +
    '.yb-seo-bottom ul{margin:0 0 12px;padding-left:20px;list-style:disc}' +
    '.yb-seo-bottom li{margin:0 0 6px;list-style:disc}' +
    '.yb-seo-table{overflow-x:auto;margin:0 0 12px}' +
    '.yb-seo-table table{border-collapse:collapse;min-width:260px}' +
    '.yb-seo-table th,.yb-seo-table td{border:1px solid #e3e3e3;padding:6px 12px;text-align:left}' +
    '.yb-seo-table th{background:#f6f6f6;font-weight:600}' +
    '.yb-seo-bottom.yb-clamp{max-height:260px;overflow:hidden}' +
    '.yb-seo-bottom.yb-clamp:after{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(rgba(255,255,255,0),#fff)}' +
    '.yb-seo-more{display:block;margin:4px auto 24px;padding:8px 18px;border:1px solid #222;background:#fff;color:#222;font-size:13px;font-weight:600;border-radius:4px;cursor:pointer}' +
    '.yb-seo-toplink{display:none;border:0;background:none;padding:0;margin:2px 0 0;font-size:13px;font-weight:600;text-decoration:underline;color:#222;cursor:pointer}' +
    '@media (max-width:768px){' +
      '.yb-seo{font-size:13px}' +
      '.yb-seo-top{padding:2px 0 10px}' +
      '.yb-seo-top h1{font-size:18px}' +
      '.yb-seo-top.yb-clamp p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.yb-seo-top.yb-clamp .yb-seo-toplink{display:inline-block}' +
      '.yb-seo-bottom{padding:0 12px}' +
      '.yb-seo-bottom.yb-clamp{max-height:200px}' +
    '}';

  function addCss() {
    if (document.getElementById('yb-seo-css')) return;
    var s = document.createElement('style');
    s.id = 'yb-seo-css';
    s.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  function text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function placeTop() {
    var top = document.querySelector('[data-yb-seo="top"]');
    if (!top || top.getAttribute('data-yb-placed')) return !!top;
    var anchor = document.querySelector('#ProductListMainContainer .categoryTitle') || document.querySelector('.categoryTitle');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(top, anchor.nextSibling);
    } else {
      var list = document.getElementById('ProductListMainContainer') || document.querySelector('.ProductListContent');
      if (!list || !list.parentNode) return true;
      list.parentNode.insertBefore(top, list);
    }
    top.setAttribute('data-yb-placed', '1');
    // Mobilde üst metin 2 satır + "Devamını oku" (ürünler aşağı itilmesin)
    if (top.querySelector('p')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'yb-seo-toplink';
      b.textContent = 'Devamını oku';
      b.onclick = function () { top.className = top.className.replace(/\s*yb-clamp/, ''); };
      top.appendChild(b);
      top.className += ' yb-clamp';
    }
    return true;
  }

  function foldBottom() {
    var bottom = document.querySelector('[data-yb-seo="bottom"]');
    if (!bottom || bottom.getAttribute('data-yb-placed')) return;
    bottom.setAttribute('data-yb-placed', '1');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yb-seo-more';
    btn.textContent = 'Devamını göster';
    btn.onclick = function () {
      var open = !/yb-clamp/.test(bottom.className);
      if (open) { bottom.className += ' yb-clamp'; btn.textContent = 'Devamını göster'; bottom.scrollIntoView({ block: 'nearest' }); }
      else { bottom.className = bottom.className.replace(/\s*yb-clamp/, ''); btn.textContent = 'Daha az göster'; }
    };
    bottom.className += ' yb-clamp';
    if (bottom.parentNode) bottom.parentNode.insertBefore(btn, bottom.nextSibling);
  }

  function faqSchema() {
    var faq = document.querySelector('[data-yb-seo="faq"]');
    if (!faq || document.getElementById('yb-seo-faq-ld')) return;
    var items = [], hs = faq.querySelectorAll('h3');
    for (var i = 0; i < hs.length; i++) {
      var a = hs[i].nextElementSibling, ans = [];
      while (a && !/^H[1-6]$/.test(a.tagName)) { ans.push(text(a)); a = a.nextElementSibling; }
      if (ans.length) items.push({ '@type': 'Question', name: text(hs[i]), acceptedAnswer: { '@type': 'Answer', text: ans.join(' ') } });
    }
    if (!items.length) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'yb-seo-faq-ld';
    s.text = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items });
    (document.head || document.documentElement).appendChild(s);
  }

  function run() {
    if (!document.querySelector('[data-yb-seo]')) return;
    addCss();
    placeTop();
    foldBottom();
    faqSchema();
  }

  run();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
})();
/* <<< yunbi-seo-content */
