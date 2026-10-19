(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;

  var TENANT = SCRIPT.getAttribute('data-tenant');
  var MODE = SCRIPT.getAttribute('data-mode') || 'auto';
  var API_BASE = SCRIPT.src.replace(/\/widget\/reviews\.js.*$/, '/w/' + TENANT + '/reviews');
  var DATA_BASE = SCRIPT.src.replace(/\/widget\/reviews\.js.*$/, '/widget/data');
  var CSS_URL = SCRIPT.src.replace(/\/widget\/reviews\.js.*$/, '/widget/reviews.css?v=2');

  // Configurable timeout (ms) — if API doesn't respond within this, silently skip
  var TIMEOUT = parseInt(SCRIPT.getAttribute('data-timeout'), 10) || 15000;
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  function dbg() { if(DEBUG && typeof console !== 'undefined') console.log.apply(console, ['[YunbiReviews]'].concat(Array.prototype.slice.call(arguments))); }

  if (!TENANT) return;

  /* ═══════════════════════════════════════════════
     CSS — loaded from external file, cached in memory
     ═══════════════════════════════════════════════ */
  var _cssText = null;
  var _cssLoading = false;
  var _cssCallbacks = [];

  function loadCSS(cb) {
    if (_cssText !== null) { cb(_cssText); return; }
    _cssCallbacks.push(cb);
    if (_cssLoading) return;
    _cssLoading = true;
    fetch(CSS_URL, { mode: 'cors', credentials: 'omit' })
      .then(function(res) {
        if (!res.ok) throw new Error('CSS HTTP ' + res.status);
        return res.text();
      })
      .then(function(text) {
        _cssText = text;
        dbg('CSS loaded', text.length, 'bytes');
        var cbs = _cssCallbacks.slice();
        _cssCallbacks = [];
        cbs.forEach(function(fn) { fn(_cssText); });
      })
      .catch(function(err) {
        dbg('CSS load error, using empty', err);
        _cssText = '';
        var cbs = _cssCallbacks.slice();
        _cssCallbacks = [];
        cbs.forEach(function(fn) { fn(_cssText); });
      });
  }

  function injectCSS(shadow) {
    var style = document.createElement('style');
    style.textContent = _cssText || '';
    shadow.appendChild(style);
    return style;
  }

  /* ═══════════════════════════════════════════════
     Config — loaded from API, cached in memory
     ═══════════════════════════════════════════════ */
  // Default selectors (Ticimax) — used as fallback if config fails
  var DEFAULT_SEL = {
    header_stars_target: '#divUrunKodu',
    widget_insert_before: '#BenzerUrunDiv',
    widget_insert_fallback: '#divTabYorumlar,.urunOzellik,#divUrunOzellikAlani',
    detail_container: '.product-detail,#urunDetay,.detay_sag,.detaySliderContainer,#divTabYorumlar',
    listing_card: '.productItem,.product-item,.urunKutu',
    listing_product_id: '.detailLink[data-id],.detailUrl[data-id],.productDetail[data-id],.productName[data-id]',
    listing_product_id_attr: 'data-id',
    listing_badge_after: '.productName,.product-name,.urunAdi',
    product_id_js_var: 'productDetailModel.productId'
  };

  var _config = null;
  var _configLoading = false;
  var _configCallbacks = [];

  function sel(key) {
    if (_config && _config.selectors && _config.selectors[key]) return _config.selectors[key];
    return DEFAULT_SEL[key] || '';
  }

  function loadConfig(cb) {
    if (_config !== null) { cb(_config); return; }
    _configCallbacks.push(cb);
    if (_configLoading) return;
    _configLoading = true;
    var url = API_BASE + '/config';
    dbg('loadConfig:', url);
    fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, mode: 'cors', credentials: 'omit' })
      .then(function(res) {
        if (!res.ok) throw new Error('Config HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        _config = data;
        dbg('config loaded', data.platform, data.selectors);
        var cbs = _configCallbacks.slice();
        _configCallbacks = [];
        cbs.forEach(function(fn) { fn(_config); });
      })
      .catch(function(err) {
        dbg('config load error, using defaults', err);
        _config = { platform: 'ticimax', selectors: DEFAULT_SEL };
        var cbs = _configCallbacks.slice();
        _configCallbacks = [];
        cbs.forEach(function(fn) { fn(_config); });
      });
  }

  /* ═══════════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════════ */

  // SVG star with precise fractional fill
  var STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z';

  function starSVG(fill, size, color) {
    color = color || '#f5a623';
    var grey = '#e0e0e0';
    var id = 'sg' + Math.random().toString(36).substr(2,6);
    if (fill >= 1) {
      return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24"><path d="'+STAR_PATH+'" fill="'+color+'"/></svg>';
    }
    if (fill <= 0) {
      return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24"><path d="'+STAR_PATH+'" fill="'+grey+'"/></svg>';
    }
    var pct = Math.round(fill * 100);
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24"><defs><linearGradient id="'+id+'"><stop offset="'+pct+'%" stop-color="'+color+'"/><stop offset="'+pct+'%" stop-color="'+grey+'"/></linearGradient></defs><path d="'+STAR_PATH+'" fill="url(#'+id+')"/></svg>';
  }

  function starsHTML(rating, sz) {
    var r = parseFloat(rating) || 0, s = sz || 16, h = '';
    for (var i = 1; i <= 5; i++) {
      var fill = Math.min(1, Math.max(0, r - (i - 1)));
      h += starSVG(fill, s);
    }
    return '<span class="tr-stars">' + h + '</span>';
  }

  function starsFixed(n, sz) {
    var s = sz || 14, h = '';
    for (var i = 1; i <= 5; i++) {
      h += starSVG(i <= n ? 1 : 0, s);
    }
    return '<span class="tr-stars">' + h + '</span>';
  }

  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }

  function mask(n) {
    if (!n || n.length <= 2) return n || '';
    return n.split(' ').map(function(p){ return p.length <= 1 ? p : p[0] + Array(p.length).join('*'); }).join(' ');
  }

  // Validate URL: only allow http(s) image URLs
  function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try { var u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; }
    catch (e) { return false; }
  }

  // API fetch with timeout + AbortController — never blocks host page
  function api(url, cb) {
    // Use AbortController for proper timeout if available
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function() {
      if (controller) controller.abort();
      cb(new Error('timeout'));
    }, TIMEOUT);

    var opts = {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      credentials: 'omit'  // Never send cookies to our API
    };
    if (controller) opts.signal = controller.signal;

    fetch(url, opts)
      .then(function(res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) { cb(null, data); })
      .catch(function(err) {
        clearTimeout(timer);
        // Silently fail — never break host page
        cb(err);
      });
  }

  /* ═══════════════════════════════════════════════
     DETAIL WIDGET
     ═══════════════════════════════════════════════ */
  function renderDetail(container, barcode, productId) {
    var shadow = container.attachShadow({mode:'closed'});
    injectCSS(shadow);
    var root = document.createElement('div'); root.className='tr-widget';
    root.innerHTML='<div class="tr-loading">Yorumlar y\u00fckleniyor...</div>';
    shadow.appendChild(root);

    var lb = document.createElement('div'); lb.className='tr-lb';
    lb.onclick=function(){lb.classList.remove('open')};
    shadow.appendChild(lb);

    var baseUrl = productId ? API_BASE+'/product-id/'+encodeURIComponent(productId) : API_BASE+'/product/'+encodeURIComponent(barcode);

    // State
    var state = { page:1, star:null, photo:false, sort:'newest', q:'', summary:null };
    var allReviews = [];

    function buildUrl(page) {
      var u = baseUrl + '?page=' + page + '&per_page=6';
      if (state.star) u += '&star=' + state.star;
      if (state.photo) u += '&photo=1';
      if (state.sort && state.sort !== 'newest') u += '&sort=' + state.sort;
      if (state.q) u += '&q=' + encodeURIComponent(state.q);
      return u;
    }

    function resetAndLoad() {
      state.page = 1;
      allReviews = [];
      loadPage(1, true);
    }

    function loadPage(page, rebuild) {
      api(buildUrl(page), function(err, data) {
        if (err || !data || !data.summary) {
          // On timeout/error for first page, silently hide widget — don't slow host
          if (page === 1) {
            root.innerHTML = '';
            container.style.display = 'none';
          }
          return;
        }
        container.style.display = '';

        if (page === 1 || rebuild) {
          state.summary = data.summary;
          allReviews = [];
          root.innerHTML = '';

          var title = document.createElement('h2'); title.className='tr-title';
          title.textContent='\u00dcr\u00fcn De\u011ferlendirmeleri';
          root.appendChild(title);

          var cols = document.createElement('div'); cols.className='tr-columns';

          // LEFT
          var left = document.createElement('div'); left.className='tr-left';
          left.innerHTML = buildLeftHTML(data.summary);
          // Attach bar click handlers
          left.querySelectorAll('.tr-bar-row[data-star]').forEach(function(row){
            row.addEventListener('click', function(){
              var s = parseInt(this.getAttribute('data-star'));
              state.star = (state.star === s) ? null : s;
              resetAndLoad();
            });
          });
          // AI summary "Devamini Oku" toggle
          var aiBtn = left.querySelector('.tr-ai-readmore');
          if (aiBtn) {
            var aiTxt = left.querySelector('.tr-ai-text');
            if (aiTxt) {
              setTimeout(function(){
                if (aiTxt.scrollHeight <= aiTxt.clientHeight + 4) { aiBtn.style.display = 'none'; }
              }, 50);
              aiBtn.addEventListener('click', function(){
                var expanded = aiTxt.classList.toggle('expanded');
                this.textContent = expanded ? 'Daha Az G\u00f6ster' : 'Devam\u0131n\u0131 Oku';
                // After collapsing, re-check if button is still needed
                if (!expanded) {
                  setTimeout(function(){
                    if (aiTxt.scrollHeight <= aiTxt.clientHeight + 4) { aiBtn.style.display = 'none'; }
                  }, 50);
                }
              });
            }
          }
          cols.appendChild(left);

          // RIGHT
          var right = document.createElement('div'); right.className='tr-right'; right.id='tr-right';

          // Filters
          var filterDiv = document.createElement('div'); filterDiv.className='tr-filters'; filterDiv.id='tr-filters';
          filterDiv.innerHTML = buildFiltersHTML(data.summary);
          right.appendChild(filterDiv);

          // Toolbar
          var toolbar = document.createElement('div'); toolbar.className='tr-toolbar';
          toolbar.innerHTML = buildToolbarHTML();
          right.appendChild(toolbar);

          // List
          var list = document.createElement('ul'); list.className='tr-list'; list.id='tr-list';
          right.appendChild(list);

          cols.appendChild(right);
          root.appendChild(cols);

          // Attach event handlers
          attachFilterHandlers(shadow);
          attachToolbarHandlers(shadow);
        }

        // Inject stars into host page header on first successful load
        if (page === 1 && data.summary) {
          injectHeaderStars(data.summary);
        }

        var list = shadow.getElementById('tr-list');
        var reviews = data.reviews || [];
        allReviews = allReviews.concat(reviews);
        reviews.forEach(function(r){ list.appendChild(buildReviewEl(r, lb)); });

        // Empty state: summary exists but no review details available
        if (page === 1 && reviews.length === 0) {
          var emptyDiv = document.createElement('div'); emptyDiv.className = 'tr-empty';
          emptyDiv.textContent = 'Bu \u00fcr\u00fcn i\u00e7in hen\u00fcz detayl\u0131 yorum bulunmuyor.';
          list.appendChild(emptyDiv);
        }

        // Remove old more/footer
        var om = shadow.getElementById('tr-more'); if(om) om.remove();
        var of = shadow.querySelector('.tr-foot'); if(of) of.remove();

        var right = shadow.getElementById('tr-right');

        if (data.pagination && data.pagination.current_page < data.pagination.last_page) {
          state.page = data.pagination.current_page;
          var btn = document.createElement('button'); btn.className='tr-more'; btn.id='tr-more';
          btn.textContent='DAHA FAZLA YORUM G\u00d6STER';
          btn.onclick = function(){ btn.textContent='Y\u00dcKLEN\u0130YOR...'; btn.disabled=true; loadPage(state.page+1, false); };
          right.appendChild(btn);
        }

        var foot = document.createElement('div'); foot.className='tr-foot';
        foot.innerHTML='<div></div><div>Kaynak: <a href="https://www.trendyol.com" target="_blank" rel="noopener">Trendyol</a></div>';
        right.appendChild(foot);
      });
    }

    function buildLeftHTML(s) {
      var rates = [{s:5,c:s.rate_five},{s:4,c:s.rate_four},{s:3,c:s.rate_three},{s:2,c:s.rate_two},{s:1,c:s.rate_one}];
      var total = s.rate_count;
      var barsH = '';
      rates.forEach(function(r){
        var pct = total > 0 ? Math.round(r.c/total*100) : 0;
        var act = state.star === r.s ? ' active' : '';
        barsH += '<div class="tr-bar-row'+act+'" data-star="'+r.s+'">' +
          starsFixed(r.s, 13) +
          '<div class="tr-bar-track"><div class="tr-bar-fill" style="width:'+pct+'%"></div></div>' +
          '<span class="tr-bar-count">'+r.c+'</span></div>';
      });

      var aiH = '';
      if (s.ai_summary) {
        aiH = '<div class="tr-ai">' +
          '<div class="tr-ai-content">' +
            '<div class="tr-ai-head">' +
              '<span class="tr-ai-icon"><img src="https://cdn.dsmcdn.com/web/prod/fp/ai1_1744811068004.svg" alt="AI"></span>' +
              '<div class="tr-ai-title-wrap">' +
                '<h3 class="tr-ai-title">De\u011ferlendirme \u00d6zeti</h3>' +
                '<button class="tr-ai-info" type="button" aria-label="De\u011ferlendirme \u00f6zeti hakk\u0131nda bilgi">' +
                  '<img src="https://cdn.dsmcdn.com/web/prod/fp/info_1744805921885.svg" alt="">' +
                  '<span class="tr-ai-tooltip">Bu \u00f6zet, kullan\u0131c\u0131 yorumlar\u0131n\u0131n yapay zek\u00e2 teknolojisi kullan\u0131larak otomatik olarak analiz edilip \u00f6zetlenmesiyle olu\u015fturulmu\u015ftur. Platform, yapay zeka taraf\u0131ndan verilen bilgilerin do\u011frulu\u011fu veya eksiksizli\u011fi konusunda herhangi bir garanti vermez.</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div class="tr-ai-body">' +
              '<p class="tr-ai-text">'+esc(s.ai_summary)+'</p>' +
              '<button class="tr-ai-readmore" type="button">Devam\u0131n\u0131 Oku</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      return '<div class="tr-rsummary"><div class="tr-rsummary-line">' +
          '<span class="tr-rsummary-num">'+Number(s.avg_rate).toFixed(1)+'</span> ' +
          starsHTML(s.avg_rate, 18) +
          ' <span class="tr-rsummary-dot">&middot;</span> ' +
          '<span class="tr-rsummary-count">'+total+' De\u011ferlendirme</span>' +
        '</div></div>' +
        '<div class="tr-bars">'+barsH+'</div>' + aiH;
    }

    function buildFiltersHTML(s) {
      var h = '';
      var total = s.rate_count;
      var photo = s.photo_count || 0;

      h += '<button class="tr-fbtn'+((!state.star&&!state.photo)?' active':'')+'" data-f="all">T\u00fcm Yorumlar ('+total+')</button>';
      h += '<button class="tr-fbtn'+(state.photo?' active':'')+'" data-f="photo">\ud83d\udcf7 Foto\u011frafl\u0131 Yorumlar'+(photo ? ' ('+photo+')' : '')+'</button>';

      var sc = {5:s.rate_five,4:s.rate_four,3:s.rate_three,2:s.rate_two,1:s.rate_one};
      [5,4,3,2,1].forEach(function(star){
        if(sc[star]>0){
          var act = state.star===star ? ' active' : '';
          h += '<button class="tr-fbtn'+act+'" data-f="star_'+star+'">'+starsFixed(star,13)+' <span>('+sc[star]+')</span></button>';
        }
      });
      return h;
    }

    function buildToolbarHTML() {
      var sortVal = state.sort || 'newest';
      return '<div class="tr-search"><input type="text" placeholder="Yorumlarda ara..." value="'+esc(state.q)+'"><span class="tr-search-icon">\ud83d\udd0d</span></div>' +
        '<div class="tr-sort"><select>' +
          '<option value="newest"'+(sortVal==='newest'?' selected':'')+'>En Yeni</option>' +
          '<option value="most_liked"'+(sortVal==='most_liked'?' selected':'')+'>En Be\u011fenilen</option>' +
          '<option value="highest"'+(sortVal==='highest'?' selected':'')+'>En Y\u00fcksek Puan</option>' +
          '<option value="lowest"'+(sortVal==='lowest'?' selected':'')+'>En D\u00fc\u015f\u00fck Puan</option>' +
        '</select><span class="tr-sort-icon">\u21C5</span></div>';
    }

    function attachFilterHandlers(sh) {
      sh.querySelectorAll('.tr-fbtn').forEach(function(btn){
        btn.addEventListener('click', function(){
          var f = this.getAttribute('data-f');
          if (f === 'all') { state.star = null; state.photo = false; }
          else if (f === 'photo') { state.photo = !state.photo; state.star = null; }
          else if (f.indexOf('star_') === 0) {
            var s = parseInt(f.split('_')[1]);
            state.star = (state.star === s) ? null : s;
            state.photo = false;
          }
          resetAndLoad();
        });
      });
    }

    function attachToolbarHandlers(sh) {
      // Search
      var input = sh.querySelector('.tr-search input');
      var searchTimer = null;
      if (input) {
        input.addEventListener('input', function(){
          clearTimeout(searchTimer);
          var val = this.value;
          searchTimer = setTimeout(function(){
            state.q = val;
            resetAndLoad();
          }, 400);
        });
        // Search icon click
        var icon = sh.querySelector('.tr-search-icon');
        if (icon) icon.addEventListener('click', function(){ state.q = input.value; resetAndLoad(); });
      }
      // Sort
      var sel = sh.querySelector('.tr-sort select');
      if (sel) {
        sel.addEventListener('change', function(){
          state.sort = this.value;
          resetAndLoad();
        });
      }
    }

    function buildReviewEl(r, lb) {
      var li = document.createElement('li'); li.className='tr-review';

      var dateText = r.comment_date_text || '';
      if (!dateText && r.reviewed_at) {
        var d = new Date(r.reviewed_at);
        var m = ['Ocak','\u015eubat','Mart','Nisan','May\u0131s','Haziran','Temmuz','A\u011fustos','Eyl\u00fcl','Ekim','Kas\u0131m','Aral\u0131k'];
        dateText = d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
      }

      var html = '<div class="tr-review-head">' + starsHTML(r.rate, 16) +
        '</div>' +
        '<div class="tr-review-meta"><span>'+esc(mask(r.user_full_name))+'</span>' +
        '<span class="tr-review-sep">\u00b7</span><span>'+esc(dateText)+'</span></div>';
      if (r.comment) html += '<p class="tr-review-text">'+esc(r.comment)+'</p>';
      li.innerHTML = html;

      // Images — safe DOM construction (no innerHTML for URLs)
      if (r.images && r.images.length) {
        var imgDiv = document.createElement('div'); imgDiv.className='tr-review-imgs';
        r.images.forEach(function(img){
          var src = typeof img==='string' ? img : (img.url||'');
          var thumb = typeof img==='object' ? (img.thumbnailUrl||src) : src;
          if(!isSafeUrl(src)) return;
          var el = document.createElement('img');
          el.src = isSafeUrl(thumb) ? thumb : src;
          el.alt = '';
          el.loading = 'lazy';
          el.onclick = function(e){
            e.stopPropagation();
            // Safe lightbox: use DOM API, not innerHTML
            lb.innerHTML = '';
            var lbImg = document.createElement('img');
            lbImg.src = src;
            lbImg.alt = '';
            lb.appendChild(lbImg);
            lb.classList.add('open');
          };
          imgDiv.appendChild(el);
        });
        li.appendChild(imgDiv);
      }

      // Seller reply
      if (r.seller_reply) {
        var sel = document.createElement('div'); sel.className='tr-review-seller';
        sel.innerHTML='<b>Sat\u0131c\u0131 Yan\u0131t\u0131</b><p>'+esc(r.seller_reply)+'</p>';
        li.appendChild(sel);
      }
      return li;
    }

    loadPage(1, true);
  }

  /* ═══════════════════════════════════════════════
     LISTING WIDGET (Badge)
     ═══════════════════════════════════════════════ */
  // Catalog cache for listing badges — loaded once from static JSON
  var _catalog = null;
  var _catalogLoading = false;
  var _catalogCallbacks = [];

  function loadCatalog(cb) {
    if (_catalog) { cb(_catalog); return; }
    _catalogCallbacks.push(cb);
    if (_catalogLoading) return;
    _catalogLoading = true;
    var url = DATA_BASE + '/' + TENANT + '.json';
    dbg('loadCatalog: fetching', url);
    api(url, function(err, data) {
      _catalogLoading = false;
      if (!err && data && data.products) {
        _catalog = data.products;
        dbg('loadCatalog: loaded', Object.keys(_catalog).length, 'products');
      } else {
        _catalog = {};
        dbg('loadCatalog: error, using empty catalog', err);
      }
      var cbs = _catalogCallbacks.slice();
      _catalogCallbacks = [];
      cbs.forEach(function(fn){ fn(_catalog); });
    });
  }

  function renderListing() {
    function injectBadges(catalog) {
      // Use config-driven selectors
      var cardSel = sel('listing_card');
      var idSel = sel('listing_product_id');
      var idAttr = sel('listing_product_id_attr');
      var badgeAfterSel = sel('listing_badge_after');

      var cards = document.querySelectorAll('[data-product-id],' + cardSel);
      dbg('injectBadges: found', cards.length, 'cards');
      var injected = 0;
      cards.forEach(function(card){
        if(card.querySelector('trendyol-review-badge')) return;
        var id = card.getAttribute('data-product-id');
        if(!id){
          var link = card.querySelector(idSel);
          if(link) id = link.getAttribute(idAttr);
        }
        if(!id){
          var btn = card.querySelector('[data-productid]');
          if(btn) id = btn.getAttribute('data-productid');
        }
        if(!id){ var a=card.querySelector('a[href]'); if(a){ var h=a.getAttribute('href')||''; var m=h.match(/[?&](?:urunId|uid|SID)=(\d+)/i)||h.match(/-p-(\d+)/)||h.match(/-(\d+)$/); if(m) id=m[1]; }}
        if(!id) return;
        var info = catalog[id];
        if(!info) return;
        var badge=document.createElement('trendyol-review-badge'); badge.style.cssText='display:block;margin:6px 0 4px;line-height:1';
        var sh=badge.attachShadow({mode:'closed'});
        injectCSS(sh);
        var sp=document.createElement('span'); sp.className='tr-badge';
        sp.innerHTML=starsHTML(info.avg_rate,15)+' <span class="tr-badge-count">('+info.rate_count+')</span>';
        sh.appendChild(sp);
        var nameEl=card.querySelector(badgeAfterSel);
        if(nameEl){ nameEl.parentNode.insertBefore(badge,nameEl.nextSibling); }
        else { var t=card.querySelector('.productPrice,h3,h2'); if(t) t.parentNode.insertBefore(badge,t); else card.appendChild(badge); }
        injected++;
      });
      dbg('injectBadges:', injected, 'badges injected');
    }

    // Load catalog (static JSON, ~100ms) then inject badges
    loadCatalog(function(catalog) {
      dbg('renderListing: catalog ready, injecting badges');
      injectBadges(catalog);

      // MutationObserver for infinite scroll — persistent, no disconnect limit
      var debounce = null;
      var observer = new MutationObserver(function(){
        clearTimeout(debounce);
        debounce = setTimeout(function(){
          dbg('renderListing: MutationObserver triggered, injecting badges');
          injectBadges(catalog);
        }, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ═══════════════════════════════════════════════
     Detection — uses config-driven selectors
     ═══════════════════════════════════════════════ */
  function detectBarcode(){
    var b=SCRIPT.getAttribute('data-barcode'); if(b) return b;
    var el=document.querySelector('[data-barcode]'); if(el) return el.getAttribute('data-barcode');
    var lds=document.querySelectorAll('script[type="application/ld+json"]');
    for(var i=0;i<lds.length;i++){ try{ var d=JSON.parse(lds[i].textContent); if(d['@type']==='Product'){ if(d.gtin13)return d.gtin13;if(d.gtin12)return d.gtin12;if(d.gtin)return d.gtin;if(d.sku)return d.sku; } }catch(e){} }
    var m=document.querySelector('meta[property="product:barcode"],meta[name="barcode"]'); if(m) return m.getAttribute('content');
    return null;
  }

  function detectProductId(){
    var p=SCRIPT.getAttribute('data-product-id'); if(p) return p;
    var el=document.querySelector('[data-product-id]'); if(el) return el.getAttribute('data-product-id');
    // Dynamic: evaluate JS variable path from config
    var jsVar = sel('product_id_js_var');
    if (jsVar) {
      try {
        var parts = jsVar.split('.');
        var obj = window;
        for (var i = 0; i < parts.length; i++) {
          obj = obj[parts[i]];
          if (obj == null) break;
        }
        if (obj != null) return String(obj);
      } catch(e){}
    }
    var h=window.location.href; var m=h.match(/-p-(\d+)/)||h.match(/[?&](?:urunId|uid|SID)=(\d+)/i)||h.match(/-(\d+)(?:\?|$)/);
    if(m) return m[1]; return null;
  }

  function isDetail(){
    var h=window.location.href;
    if(/-p-\d+/.test(h)) return true;
    if(/[?&](?:urunId|uid|SID)=\d+/i.test(h)) return true;
    // Dynamic: evaluate JS variable path from config
    var jsVar = sel('product_id_js_var');
    if (jsVar) {
      try {
        var parts = jsVar.split('.');
        var obj = window;
        for (var i = 0; i < parts.length; i++) {
          obj = obj[parts[i]];
          if (obj == null) break;
        }
        if (obj != null) return true;
      } catch(e){}
    }
    // Config-driven detail containers
    var detailSel = sel('detail_container');
    if (detailSel && document.querySelector(detailSel)) return true;
    // .productDetail only counts if NOT inside a product card
    var cardSel = sel('listing_card');
    var pd = document.querySelector('.productDetail');
    if(pd && !(pd.closest && cardSel && pd.closest(cardSel.split(',')[0]))) return true;
    var lds=document.querySelectorAll('script[type="application/ld+json"]');
    for(var i=0;i<lds.length;i++){ try{if(JSON.parse(lds[i].textContent)['@type']==='Product') return true;}catch(e){} }
    return false;
  }

  function isListing(){
    var cardSel = sel('listing_card');
    return document.querySelectorAll('[data-product-id],' + cardSel).length>=2;
  }

  /* ═══════════════════════════════════════════════
     Wait for element — MutationObserver helper
     ═══════════════════════════════════════════════ */
  function waitForElement(selector, callback, timeout) {
    var el = document.querySelector(selector);
    if (el) { callback(el); return; }
    var done = false;
    var observer = new MutationObserver(function(){
      if (done) return;
      var el = document.querySelector(selector);
      if (el) { done = true; observer.disconnect(); callback(el); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(function(){
      if (done) return;
      done = true; observer.disconnect();
      var el = document.querySelector(selector);
      if (el) callback(el);
    }, timeout || 10000);
  }

  // Inject star rating badge into host page product header (detail page only)
  function injectHeaderStars(summary){
    if(!summary || !summary.avg_rate || !summary.rate_count) return;
    if(document.getElementById('trendyol-header-stars')) return;

    function doInject() {
      if(document.getElementById('trendyol-header-stars')) return;

      var badge = document.createElement('div');
      badge.id = 'trendyol-header-stars';
      badge.style.cssText = 'display:block;float:left;width:100%;clear:both;margin:8px 0 12px;line-height:1';

      var sh = badge.attachShadow({mode:'closed'});
      injectCSS(sh);
      var inner = document.createElement('div');
      inner.className = 'tr-hdr';
      inner.innerHTML = starsHTML(summary.avg_rate, 16) + ' <span class="tr-hdr-count">(' + summary.rate_count + ' de\u011ferlendirme)</span>';
      sh.appendChild(inner);

      badge.addEventListener('click', function(){
        var t = document.getElementById('trendyol-reviews');
        if(t) t.scrollIntoView({behavior:'smooth', block:'start'});
      });

      // Primary: before .PriceList (price area)
      var price = document.querySelector('.PriceList,#pnlFiyatlar,.productPrice');
      if(price){ price.parentNode.insertBefore(badge, price); dbg('headerStars: injected before price'); return; }
      // Fallback: after header target
      var headerTarget = sel('header_stars_target');
      if (headerTarget) {
        var codeEl = document.querySelector(headerTarget);
        if(codeEl){
          var anchor = codeEl.closest ? (codeEl.closest('h1') || codeEl) : codeEl;
          if(anchor && anchor.parentNode){
            anchor.parentNode.insertBefore(badge, anchor.nextSibling);
            dbg('headerStars: injected after header target');
            return;
          }
        }
      }
      // Fallback: after first h1 in product detail area
      var detailSel = sel('detail_container');
      var detailArea = detailSel ? document.querySelector(detailSel) : null;
      if(detailArea){
        var dh1 = detailArea.querySelector('h1');
        if(dh1){ dh1.parentNode.insertBefore(badge, dh1.nextSibling); dbg('headerStars: injected after detail h1'); return; }
      }
    }

    // Wait for header target or price area to appear
    var headerTarget = sel('header_stars_target');
    var waitSel = (headerTarget || '') + ',h1,.PriceList,#pnlFiyatlar';
    waitSel = waitSel.replace(/^,/, '');
    waitForElement(waitSel, doInject, 8000);
  }

  /* ═══════════════════════════════════════════════
     Init
     ═══════════════════════════════════════════════ */
  function initDetail() {
    var bc=detectBarcode(), pid=detectProductId();
    if(!bc&&!pid) return;

    // Build wait selector from config
    var insertBefore = sel('widget_insert_before');
    var insertFallback = sel('widget_insert_fallback');
    var detailContainer = sel('detail_container');
    var waitParts = [];
    if (insertBefore) waitParts.push(insertBefore);
    if (insertFallback) waitParts.push(insertFallback);
    if (detailContainer) waitParts.push(detailContainer);
    var waitSel = waitParts.join(',') || '.product-detail';

    waitForElement(waitSel, function() {
      var c=document.getElementById('trendyol-reviews');
      if(!c){ c=document.createElement('div'); c.id='trendyol-reviews';
        // Config-driven: insert before target
        var beforeEl = insertBefore ? document.querySelector(insertBefore) : null;
        if(beforeEl && beforeEl.parentNode){
          beforeEl.parentNode.insertBefore(c, beforeEl);
        } else {
          // Config-driven: fallback insertion
          var af = insertFallback ? document.querySelector(insertFallback) : null;
          if (!af && detailContainer) af = document.querySelector(detailContainer);
          if(af) af.parentNode.insertBefore(c,af.nextSibling); else document.body.appendChild(c);
        }
      }
      renderDetail(c,bc,pid);
    }, 10000);
  }

  function init(){
    try {
      dbg('init', 'MODE='+MODE, 'readyState='+document.readyState);
      var detail = MODE==='detail'||(MODE==='auto'&&isDetail());
      dbg('isDetail='+detail);
      if(detail){
        initDetail();
      }
      // Listing badges: use MutationObserver for dynamically rendered cards
      var cardSel = sel('listing_card');
      var listingWaitSel = cardSel ? '[data-product-id],' + cardSel : '[data-product-id],.productItem,.product-item,.urunKutu';
      if(MODE==='listing'){
        dbg('listing mode — direct renderListing');
        renderListing();
      } else if(MODE==='auto'){
        dbg('auto mode — waiting for product cards...');
        waitForElement(listingWaitSel, function(){
          dbg('product cards found in DOM, calling renderListing');
          renderListing();
        }, 10000);
      }
    } catch (e) {
      dbg('init ERROR', e.message, e.stack);
      // Never break host page — silently fail
    }
  }

  /* ═══════════════════════════════════════════════
     Bootstrap — load CSS + config, then init
     ═══════════════════════════════════════════════ */
  function bootstrap() {
    var ready = 0;
    function check() {
      if (++ready >= 2) {
        dbg('bootstrap: CSS + config ready, calling init');
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
      }
    }
    loadCSS(check);
    loadConfig(check);
  }

  bootstrap();
})();
