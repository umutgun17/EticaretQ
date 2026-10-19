/*!
 * Yunbi Çark (Spin-to-Win) widget — profesyonel iki-kolon tasarım, bağımsız (no deps).
 *
 *   <script src="https://hub.yunbi.ai/widget/wheel.js?v=6"
 *           data-tenant="tonnyblack" data-campaign="yaz-carki"
 *           async crossorigin="anonymous" integrity="sha384-..."></script>
 *
 * TEK async script — host sitede RENDER-BLOCKING kaynak YOK. CSS'i bu script lazy enjekte eder.
 * Sunucumuz yavaşlasa/çökse/ölse bile host sitenin render'ı ve DOMContentLoaded'ı bloklanmaz;
 * widget sadece sessizce görünmez. integrity (SRI) → dosya kurcalanırsa tarayıcı çalıştırmaz.
 *
 * Güvenlik: kazanan dilim & kupon SUNUCUDA belirlenir; bu script yalnızca sonucu animasyona
 * çevirir, kuponu ekranda gösterir. Form alanları client'ta filtrelenir/validasyondan geçer ve
 * sunucu tarafında tekrar doğrulanır. KVKK + ileti izni onaylanmadan çark dönmez.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var TENANT = script.getAttribute('data-tenant');
  var CAMPAIGN = script.getAttribute('data-campaign');
  if (!TENANT || !CAMPAIGN) return;

  var SRC = new URL(script.src);
  var BASE = SRC.origin;
  var API = BASE + '/w/' + encodeURIComponent(TENANT) + '/wheel/' + encodeURIComponent(CAMPAIGN);
  var LS_KEY = 'yunbi_wheel_' + TENANT + '_' + CAMPAIGN;
  var currentTab = null;

  // CSS'i JS ile (lazy) enjekte et — gömme kodunda RENDER-BLOCKING <link> YOK. Böylece
  // sunucumuz yavaşlasa/çökse bile host sitenin (ör. tonnyblack) render'ı/DOMContentLoaded'ı
  // ASLA bloklanmaz; widget sessizce görünmez. CSS'in cache sürümü (?v=) script ile senkron kalır.
  var cssInjected = false;
  function ensureCss() {
    if (cssInjected) return;
    cssInjected = true;
    try {
      if (document.querySelector('link[data-ywheel-css]')) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = BASE + '/widget/wheel.css' + (SRC.search || '');
      link.setAttribute('data-ywheel-css', '1');
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {}
  }

  // Önizleme/test modu (Yunbi panelinden): hemen açılır, kaydedilmez, dedup yok, taslak çalışır.
  var PREVIEW = script.getAttribute('data-preview') === '1';
  var PREVIEW_TOKEN = script.getAttribute('data-token') || '';
  // Önizlemede oyun türü zorlanabilir (panel "Test Et (Kazı Kazan)"): data-variant="scratch"
  var FORCED_VARIANT = script.getAttribute('data-variant') || '';

  // ── A/B oyun türü: wheel (çark) | scratch (kazı kazan) ──
  // Ziyaretçi bazında BİR KEZ atanır ve localStorage'da kalır (aynı kişi hep aynı oyunu görür).
  // Yüzde sunucudan (kampanya ayarı). Kazı kazan kapatılırsa (0) herkes çarka döner.
  // Oyun Kampanyaları: gömülü kampanya (cfg) çark ya da kazı kazan olabilir. Çarkın A/B eşi
  // (cfg.ab.partner = ayrı kazı kazan kampanyası) varsa ziyaretçilerin %percent'i onu görür.
  function pickVariant(cfg) {
    if (cfg.game === 'scratch') return 'scratch';          // gömülü kampanya zaten kazı kazan
    if (!cfg.ab || !cfg.ab.partner) return 'wheel';        // A/B eşi yok/yayında değil → herkes çark
    if (PREVIEW) return (FORCED_VARIANT === 'scratch' || FORCED_VARIANT === 'b') ? 'scratch' : 'wheel'; // 'b' = A/B eşi (partner)
    var pct = Number(cfg.ab.percent) || 0;
    var st = getState();
    if (st.variant === 'scratch' && pct <= 0) { st.variant = 'wheel'; setState(st); }
    if (st.variant === 'wheel' || st.variant === 'scratch') return st.variant;
    var v = (Math.random() * 100 < pct) ? 'scratch' : 'wheel';
    st.variant = v; setState(st);
    return v;
  }
  // Ziyaretçinin gerçekten göreceği kampanya konfigürasyonu (çark ya da A/B eşi kazı kazan).
  // Tetik her zaman gömülü kampanyadan gelir (tek gömme kodu).
  function activeCfg(cfg) {
    if (pickVariant(cfg) === 'scratch' && cfg.game !== 'scratch' && cfg.ab && cfg.ab.partner) {
      var p = cfg.ab.partner; var out = {};
      for (var k in p) out[k] = p[k];
      out.trigger = cfg.trigger; out.active = true;
      return out;
    }
    return cfg;
  }
  function apiFor(slug) { return BASE + '/w/' + encodeURIComponent(TENANT) + '/wheel/' + encodeURIComponent(slug || CAMPAIGN); }

  // ── durum ── (önizlemede bellek-içi: her açılış temiz, kulakçık çalışır, cache kirlenmez)
  var previewState = {};
  function getState() { if (PREVIEW) return previewState; try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function setState(s) { if (PREVIEW) { previewState = s; return; } try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }

  function fingerprint() {
    var st = getState();
    if (st.fp) return st.fp;
    var raw = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, new Date().getTimezoneOffset()].join('|');
    var h = 0; for (var i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
    var fp = 'fp_' + Math.abs(h).toString(36) + Math.random().toString(36).slice(2, 8);
    st.fp = fp; setState(st); return fp;
  }

  function isMobile() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent); }

  function shouldShow(trigger) {
    var st = getState();
    if (st.spun) return false;
    if (st.won && trigger.show_once_per_win) return false;
    if (st.seen) {
      if (!trigger.frequency_days || trigger.frequency_days <= 0) return false;
      if (st.lastShown) { if ((Date.now() - st.lastShown) / 86400000 < trigger.frequency_days) return false; }
    }
    if (trigger.device === 'mobile' && !isMobile()) return false;
    if (trigger.device === 'desktop' && isMobile()) return false;
    return true;
  }

  function markSeen() { if (PREVIEW) return; var st = getState(); st.seen = true; st.lastShown = Date.now(); setState(st); }

  // ── API ──
  function fetchConfig() {
    var u = API + '/config' + (PREVIEW ? '?preview_token=' + encodeURIComponent(PREVIEW_TOKEN) : '');
    return fetch(u).then(function (r) { return r.json(); });
  }
  function postSpin(body, slug) {
    if (PREVIEW) body.preview_token = PREVIEW_TOKEN;
    return fetch(apiFor(slug) + '/spin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  // Kuponun hâlâ geçerli (kullanılmamış + süresi dolmamış) olup olmadığını sorar.
  function fetchCouponStatus(code, slug) {
    return fetch(apiFor(slug) + '/coupon-status?code=' + encodeURIComponent(code))
      .then(function (r) { return r.json(); })
      .then(function (j) { return j && j.active === true; })
      .catch(function () { return true; }); // hata → kulakçığı gizleme (güvenli taraf)
  }

  // ── DOM yardımcı ──
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function darken(hex, f) {
    try {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = Math.round(parseInt(h.slice(0, 2), 16) * f), g = Math.round(parseInt(h.slice(2, 4), 16) * f), b = Math.round(parseInt(h.slice(4, 6), 16) * f);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    } catch (e) { return hex; }
  }
  function applyVars(node, d) {
    node.style.setProperty('--yw-primary', d.primary_color || '#e11d48');
    // primary_2 (şablon gradyanının 2. rengi) varsa onu, yoksa primary'den koyulaştır.
    node.style.setProperty('--yw-primary-2', d.primary_2 || darken(d.primary_color || '#e11d48', 0.72));
    node.style.setProperty('--yw-accent', d.accent_color || '#fbbf24');
    node.style.setProperty('--yw-text', d.text_color || '#ffffff');
    node.style.setProperty('--yw-pointer', d.pointer_color || '#111827');
    // Buton arka planı accent; yazı rengi accent'e göre okunur (siyah buton→beyaz yazı).
    node.style.setProperty('--yw-btn-text', contrast(d.accent_color || '#fbbf24'));
  }
  // hex → {r,g,b}
  function rgb(hex) {
    try {
      var h = (hex || '').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    } catch (e) { return { r: 128, g: 128, b: 128 }; }
  }
  // Dilim doluluğuna göre okunur yazı rengi (siyah/beyaz) — mono temada şart.
  function contrast(hex) {
    var c = rgb(hex);
    var lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
  }
  function lighten(hex, f) {
    var c = rgb(hex);
    return 'rgb(' + Math.round(c.r + (255 - c.r) * f) + ',' + Math.round(c.g + (255 - c.g) * f) + ',' + Math.round(c.b + (255 - c.b) * f) + ')';
  }

  // ── doğrulama ──
  var reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function validName(v) { return /^[\p{L}][\p{L}\s.\-]{1,}$/u.test((v || '').trim()); }
  // Sunucu (RFC) Türkçe karakterli e-postayı reddediyor; aynı kuralı BURADA da uygula ki
  // kullanıcı "Bir hata oluştu" duvarına çarpmak yerine alanda net uyarı görsün.
  function emailProblem(v) {
    v = (v || '').trim();
    if (!reEmail.test(v)) return 'Geçerli bir e-posta girin.';
    if (/[^\x21-\x7e]/.test(v)) return 'E-postada Türkçe karakter olamaz (ş→s, ı→i, ğ→g…).';
    return null;
  }
  function validEmail(v) { return emailProblem(v) === null; }
  // Sunucu/limit hatasını kullanıcıya NET Türkçe mesaja çevirir ("Bir hata oluştu" bırakmaz).
  function apiError(res) {
    var b = (res && res.body) || {};
    if (b.error) return b.error; // bizim uçlarımızın Türkçe mesajları
    var m = b.message || '';
    if (b.errors) { for (var k in b.errors) { if (b.errors[k] && b.errors[k][0]) { m = b.errors[k][0]; break; } } }
    if ((res && res.status === 429) || /too many attempts/i.test(m)) return 'Çok fazla deneme yapıldı. Lütfen 1 dakika sonra tekrar dene.';
    if (/phone/i.test(m)) return /required/i.test(m) ? 'Lütfen telefon numaranı gir.' : 'Geçerli bir telefon numarası gir.';
    if (/email/i.test(m)) return 'Geçerli bir e-posta gir (Türkçe karakter kullanma).';
    if (/name/i.test(m)) return 'Geçerli bir ad soyad gir.';
    return m || 'Bir hata oluştu, lütfen tekrar dene.';
  }
  function validPhone(v) { var d = (v || '').replace(/\D+/g, ''); return d.length >= 10 && d.length <= 13; }
  function filterName(v) { return v.replace(/[^\p{L}\s.\-]/gu, ''); }
  function filterPhone(v) { return v.replace(/[^\d\s()+\-]/g, ''); }
  // TR cep maskesi: "5xx xxx xx xx" (yazdıkça boşluklu formatlar; baştaki 0/90 atılır).
  function maskPhone(v) {
    var d = (v || '').replace(/\D/g, '');
    if (d.indexOf('90') === 0) d = d.slice(2);
    if (d.charAt(0) === '0') d = d.slice(1);
    d = d.slice(0, 10);
    var out = '';
    for (var i = 0; i < d.length; i++) { if (i === 3 || i === 6 || i === 8) out += ' '; out += d.charAt(i); }
    return out;
  }

  var STATE = { spinning: false, done: false };

  // ── çark çizimi (Bambi tarzı: düz dilimler, kalın halka + beyaz noktalar) ──
  function drawWheel(canvas, slices, d) {
    var ctx = canvas.getContext('2d');
    // Yüksek-DPI (retina) netliği: backing piksel dpr katı, çizim 360 mantıksal birimde.
    var dpr = canvas.width / 360 || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ringW = 16;                                   // dış halka kalınlığı
    var size = 360, cx = size / 2, cy = size / 2;
    var r = size / 2 - ringW - 4;                     // dilim yarıçapı (halka dışta)
    var n = slices.length, seg = (Math.PI * 2) / n;
    var accent = d.accent_color || '#111111';         // halka rengi
    ctx.clearRect(0, 0, size, size);

    // ── dilimler (düz, kontrast yazı) ──
    for (var i = 0; i < n; i++) {
      var start = -Math.PI / 2 + i * seg, end = start + seg;
      var fill = slices[i].color || '#e5e7eb';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, end); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      // dilimler arası ince ayraç (komşu aynı renkse görünür kalsın)
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.stroke();
      // etiket: dilim doluluğuna göre siyah/beyaz (mono için şart), büyük+kalın+gölgeli
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = contrast(fill);
      var fs = n <= 6 ? 18 : (n <= 9 ? 15 : 12);
      ctx.font = '800 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      // Gölge YOK → yazılar net (kontrast renk zaten okunurluğu sağlıyor).
      var label = slices[i].label || ''; if (label.length > 18) label = label.slice(0, 17) + '…';
      ctx.fillText(label, r - 22, 0); ctx.restore();
    }

    // ── dış halka (düz, kalın) ──
    var rMid = r + ringW / 2;
    ctx.beginPath(); ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
    ctx.lineWidth = ringW; ctx.strokeStyle = accent; ctx.stroke();

    // ── halka üzerinde eşit aralıklı beyaz noktalar ──
    var dots = Math.max(24, n * 6);
    for (var k = 0; k < dots; k++) {
      var a = (k / dots) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx + rMid * Math.cos(a), cy + rMid * Math.sin(a), 2.4, 0, Math.PI * 2);
      ctx.fillStyle = contrast(accent); ctx.fill();
    }
  }

  // ── Kazı kazan kartı (A/B ikinci oyun) ──
  // Sol kolonda çark yerine "SANA ÖZEL" kart: üstte kazınabilir folyo (canvas), altında ödül.
  // Ödül SUNUCUDAN gelir (form gönderilince); folyo ancak ondan sonra kazınabilir olur.
  function buildScratchCard(left, cfg) {
    var d = cfg.design;
    var card = el('div', 'ywheel-card');
    card.appendChild(el('div', 'ywheel-card-head', 'SANA ÖZEL'));
    if (d.logo_url) { var lg = el('img', 'ywheel-card-logo'); lg.src = d.logo_url; lg.alt = ''; card.appendChild(lg); }
    var body = el('div', 'ywheel-card-body');
    var prize = el('div', 'ywheel-card-prize');
    prize.appendChild(el('div', 'ywheel-card-prize-emoji', '🎁'));
    var prizeText = el('div', 'ywheel-card-prize-text', '');
    prize.appendChild(prizeText);
    body.appendChild(prize);
    var foil = el('canvas', 'ywheel-scratch');
    body.appendChild(foil);
    card.appendChild(body);
    var foot = el('div', 'ywheel-card-foot', '⏱ Kazı, ' + ((cfg.scratch && cfg.scratch.valid_minutes) || 30) + ' dakika içinde kullan');
    if (cfg.scratch && cfg.scratch.skip_form) foot.textContent = '👆 Hemen kazı, ' + ((cfg.scratch && cfg.scratch.valid_minutes) || 30) + ' dakika içinde kullan';
    card.appendChild(foot);
    left.appendChild(card);

    var W = 360, H = 220, DPR = Math.min(window.devicePixelRatio || 1, 3);
    foil.width = W * DPR; foil.height = H * DPR;
    var ctx = foil.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var accent = d.accent_color || '#111111';

    function drawFoil(locked) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#d4d4d8'); g.addColorStop(0.45, '#f4f4f5'); g.addColorStop(0.55, '#e4e4e7'); g.addColorStop(1, '#a1a1aa');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // ince çapraz doku
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (var x = -H; x < W; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke(); }
      ctx.fillStyle = '#3f3f46'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 22px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(locked ? (cfg.scratch && cfg.scratch.skip_form ? '⏳  HAZIRLANIYOR' : '🔒  KAZIMAK İÇİN') : '👆  BURAYI KAZI', W / 2, H / 2 - 12);
      ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = '#52525b';
      ctx.fillText(locked ? (cfg.scratch && cfg.scratch.skip_form ? 'sana özel kartın geliyor' : 'önce bilgilerini gir') : 'sana özel indirimin burada', W / 2, H / 2 + 16);
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }
    drawFoil(true);

    var unlocked = false, revealed = false, moves = 0, onReveal = null, idleTimer = null;
    function pos(e) {
      var r = foil.getBoundingClientRect();
      var p = (e.touches && e.touches[0]) || e;
      return { x: (p.clientX - r.left) * (W / r.width), y: (p.clientY - r.top) * (H / r.height) };
    }
    function scratchAt(p) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.fill();
    }
    function clearedRatio() {
      try {
        var img = ctx.getImageData(0, 0, foil.width, foil.height).data, n = 0, tot = 0;
        for (var i = 3; i < img.length; i += 4 * 16) { tot++; if (img[i] === 0) n++; } // 1/16 örnekleme
        return tot ? n / tot : 0;
      } catch (e) { return 1; }
    }
    function reveal() {
      if (revealed) return; revealed = true;
      foil.classList.add('ywheel-scratch-done');
      card.classList.add('ywheel-card-open');
      setTimeout(function () { if (onReveal) onReveal(); }, 450);
    }
    var down = false, last = null;
    function start(e) { if (!unlocked || revealed) return; down = true; last = pos(e); scratchAt(last); e.preventDefault(); }
    function move(e) {
      if (!down || !unlocked || revealed) return;
      e.preventDefault();
      var p = pos(e);
      // noktalar arasını doldur (hızlı hareketlerde boşluk kalmasın)
      var dx = p.x - last.x, dy = p.y - last.y, dist = Math.sqrt(dx * dx + dy * dy), steps = Math.max(1, Math.floor(dist / 6));
      for (var i = 1; i <= steps; i++) scratchAt({ x: last.x + dx * i / steps, y: last.y + dy * i / steps });
      last = p; moves++;
      if (moves % 8 === 0 && clearedRatio() > 0.45) reveal();
      clearTimeout(idleTimer);
      // Kazımayı bıraktı ve yeterince açtıysa → otomatik aç (kullanıcı takılmasın)
      idleTimer = setTimeout(function () { if (!revealed && clearedRatio() > 0.2) reveal(); }, 1400);
    }
    function end() { down = false; }
    foil.addEventListener('mousedown', start); foil.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    foil.addEventListener('touchstart', start, { passive: false }); foil.addEventListener('touchmove', move, { passive: false }); foil.addEventListener('touchend', end);

    return {
      // Sunucu sonucu geldi: ödülü karta yaz, folyoyu kazınabilir yap.
      unlock: function (r, cb) {
        prizeText.textContent = r.is_win ? (r.prize_label || 'İndirim') : (d.lose_message || 'Bu sefer olmadı');
        prize.querySelector('.ywheel-card-prize-emoji').textContent = r.is_win ? '🎁' : '🍀';
        onReveal = cb; unlocked = true; drawFoil(false); foil.classList.add('ywheel-scratch-ready');
      },
      revealNow: reveal,
    };
  }

  // ── modal ──
  // preset: formsuz kazı kazanda spin cevabı PENCEREDEN ÖNCE alınmışsa (launch) buraya gelir.
  function open(rootCfg, preset) {
    ensureCss();
    if (document.querySelector('.ywheel-overlay')) return;
    markSeen();
    removeTab();
    STATE.spinning = false; STATE.done = false;
    var cfg = activeCfg(rootCfg);                 // çark ya da A/B eşi kazı kazan kampanyası
    var d = cfg.design, form = cfg.form;
    var scratch = cfg.game === 'scratch';
    var sc = cfg.scratch || {};
    var formless = scratch && !!sc.skip_form;     // form yok: kart açılır açılmaz kazınır
    var overlay = el('div', 'ywheel-overlay' + (formless ? ' ywheel-overlay-light' : ''));
    // Formsuz kazı kazan: tek kolon, küçük kart (başlık + kart + bir satır). Site görünür kalır.
    var modal = el('div', 'ywheel-modal' + (scratch ? ' ywheel-modal-scratch' : '') + (formless ? ' ywheel-modal-compact' : '')); applyVars(modal, d);

    var close = el('button', 'ywheel-close', '&times;');
    close.onclick = function () { teardown(overlay, rootCfg); };
    modal.appendChild(close);

    // sol: çark (A) ya da kazı kazan kartı (B)
    var left = el('div', 'ywheel-left' + (scratch ? ' ywheel-left-scratch' : ''));

    var canvas = null, card = null;
    if (scratch) {
      card = buildScratchCard(left, cfg);
    } else {
      var wrap = el('div', 'ywheel-wheelwrap');
      wrap.appendChild(el('div', 'ywheel-pointer'));
      canvas = el('canvas', 'ywheel-canvas ywheel-idle');
      var DPR = Math.min(window.devicePixelRatio || 1, 3); // mobilde çark büyüdü → 3x'e kadar keskin
      canvas.width = 360 * DPR; canvas.height = 360 * DPR; // backing; CSS boyutu %100
      wrap.appendChild(canvas);
      var hub = el('div', 'ywheel-hub', d.logo_url ? '' : '🎯');
      if (d.logo_url) { var hi = el('img'); hi.src = d.logo_url; hub.appendChild(hi); }
      wrap.appendChild(hub);
      left.appendChild(wrap);
    }
    modal.appendChild(left);
    if (canvas) drawWheel(canvas, cfg.slices, d);

    // sağ: form (logo yalnızca çark ortasında; form tarafında tekrar gösterilmez)
    var right = el('div', 'ywheel-right');
    right.appendChild(el('div', 'ywheel-title', d.title || (scratch ? 'Sana Özel Kazı Kazan' : 'Şansını Dene!')));
    right.appendChild(el('div', 'ywheel-subtitle', d.subtitle || ''));
    var btnLabel = d.button_label || (scratch ? 'Kartımı Aç' : 'Çevir');

    var formEl = el('form', 'ywheel-form');
    // Honeypot: readOnly ŞART — Android/iOS otomatik doldurma (autofill) gizli alanı da
    // dolduruyordu ve gerçek kullanıcılar "Geçersiz istek" ile çeviremiyordu. Autofill
    // readOnly alana yazmaz; value'yu JS ile dolduran botlar yine yakalanır.
    var hp = el('input', 'ywheel-hp'); hp.type = 'text'; hp.tabIndex = -1; hp.readOnly = true; hp.setAttribute('autocomplete', 'off'); hp.setAttribute('aria-hidden', 'true'); formEl.appendChild(hp);

    var fields = {};
    if (!formless && form.collect_name) fields.full_name = addField(formEl, 'text', 'Ad Soyad', form.require_name);
    if (!formless && form.collect_email) fields.email = addField(formEl, 'email', 'E-posta', form.require_email);
    if (!formless && form.collect_phone) fields.phone = addField(formEl, 'tel', '5xx xxx xx xx', form.require_phone);

    // onay kutuları (formsuz kazı kazanda kişisel veri alınmaz → onay kutusu yok)
    var kvkk = (!formless && form.kvkk_required) ? addConsent(formEl, form.kvkk_text) : null;
    var comms = (!formless && form.comms_required) ? addConsent(formEl, form.comms_text) : null;

    var formErr = el('div', 'ywheel-formerr'); formEl.appendChild(formErr);
    var btn = el('button', 'ywheel-btn', btnLabel); btn.type = 'submit';
    formEl.appendChild(btn);
    right.appendChild(formEl);

    var result = el('div', 'ywheel-result'); right.appendChild(result);
    if (formless) {
      // Sol: büyük kazıma kartı. Sağ: yalnız başlık + alt başlık + tek satır yönlendirme.
      // (form/result DOM dışında kalır, mantık aynı)
      var side = el('div', 'ywheel-compact-side');
      side.appendChild(el('div', 'ywheel-compact-title', d.title || 'Sana Özel Kazı Kazan'));
      if (d.subtitle) side.appendChild(el('div', 'ywheel-compact-sub', d.subtitle));
      var note = el('div', 'ywheel-compact-note', 'Kartı parmağınla kazı, sana özel indirimini gör.');
      side.appendChild(note);
      modal.appendChild(side);
    } else {
      modal.appendChild(right);
    }

    function setFieldErr(f, msg) { if (!f) return; f.input.classList.add('ywheel-invalid'); f.err.textContent = msg || ''; }

    // Buton HER ZAMAN tıklanabilir; tıklayınca hangi alanın eksik/hatalı olduğu gösterilir.
    function validateAll() {
      formErr.textContent = '';
      var ok = true, firstBad = null;
      function check(f, required, validate, emptyMsg, badMsg) {
        if (!f) return;
        var v = f.input.value.trim();
        if (!v) { if (required) { setFieldErr(f, emptyMsg); ok = false; firstBad = firstBad || f; } return; }
        if (!validate(v)) { setFieldErr(f, typeof badMsg === 'function' ? badMsg(v) : badMsg); ok = false; firstBad = firstBad || f; }
      }
      check(fields.full_name, form.require_name, validName, 'Lütfen adınızı soyadınızı girin.', 'Geçerli bir ad soyad girin.');
      check(fields.email, form.require_email, validEmail, 'Lütfen e-posta adresinizi girin.', function (v) { return emailProblem(v) || 'Geçerli bir e-posta girin.'; });
      check(fields.phone, form.require_phone, validPhone, 'Lütfen telefon numaranızı girin.', 'Geçerli bir telefon numarası girin.');
      if ((kvkk && !kvkk.checked) || (comms && !comms.checked)) {
        ok = false;
        if (!formErr.textContent) formErr.textContent = 'Devam etmek için onay kutularını işaretleyin.';
      }
      if (!ok && firstBad && !formErr.textContent) formErr.textContent = 'Lütfen işaretli alanları kontrol edin.';
      if (firstBad) { try { firstBad.input.focus(); } catch (e) {} }
      return ok;
    }

    // input filtreleme + canlı hata temizleme
    function clearErr() { formErr.textContent = ''; }
    if (fields.full_name) bindInput(fields.full_name, filterName, validName, 'Geçerli bir ad soyad girin.', clearErr);
    if (fields.email) {
      // blur'da alan-özel mesaj: format mı, Türkçe karakter mi — kullanıcı nedenini görsün.
      fields.email.input.addEventListener('input', function () {
        fields.email.input.classList.remove('ywheel-invalid'); fields.email.err.textContent = ''; clearErr();
      });
      fields.email.input.addEventListener('blur', function () {
        var v = fields.email.input.value.trim();
        var p = v ? emailProblem(v) : null;
        if (p) { fields.email.input.classList.add('ywheel-invalid'); fields.email.err.textContent = p; }
        else { fields.email.input.classList.remove('ywheel-invalid'); fields.email.err.textContent = ''; }
      });
    }
    if (fields.phone) {
      // Maske: yazdıkça "5xx xxx xx xx" (cursor sona — input sırasında value set'i imleci sona alır).
      fields.phone.input.addEventListener('input', function () {
        fields.phone.input.value = maskPhone(fields.phone.input.value);
        fields.phone.input.classList.remove('ywheel-invalid'); fields.phone.err.textContent = '';
        clearErr();
      });
      fields.phone.input.addEventListener('blur', function () {
        var v = fields.phone.input.value;
        if (v && !validPhone(v)) { fields.phone.input.classList.add('ywheel-invalid'); fields.phone.err.textContent = 'Geçerli bir telefon numarası girin.'; }
        else { fields.phone.input.classList.remove('ywheel-invalid'); fields.phone.err.textContent = ''; }
      });
    }
    if (kvkk) kvkk.addEventListener('change', clearErr);
    if (comms) comms.addEventListener('change', clearErr);

    // Formsuz kazı kazan: sağda "Sana Özel Hediye" kutusu — kart hazırlanınca SAYAÇ burada
    // akmaya başlar (kazımadan önce bile süre görünür), kazıyınca altına kod gelir.
    var giftBox = null, giftCd = null;
    if (formless) {
      btn.style.display = 'none';
      // Sade ilk ekran: süre YOK (mobilde yer kaplıyordu). Süre ve kod, kazıyınca açılan sağ panelde.
      giftCd = note; // tek satır bilgi: hazırlanıyor → kazı → hata
    }

    function submitSpin() {
      if (STATE.spinning || STATE.done) return;
      if (!formless && !validateAll()) return;
      var body = { fingerprint: fingerprint(), source_url: location.href, hp: hp.value };
      if (fields.full_name) body.full_name = fields.full_name.input.value.trim();
      if (fields.email) body.email = fields.email.input.value.trim();
      if (fields.phone) body.phone = fields.phone.input.value.trim();
      body.kvkk_consent = kvkk ? kvkk.checked : true;
      body.comms_consent = comms ? comms.checked : true;

      STATE.spinning = true; btn.disabled = true; btn.textContent = scratch ? 'Hazırlanıyor…' : 'Çevriliyor…';
      postSpin(body, cfg.campaign).then(onSpin).catch(onSpinError);
    }
    function onSpin(res) {
        if (!res.ok) {
          STATE.spinning = false; btn.disabled = false; btn.textContent = btnLabel;
          formErr.textContent = apiError(res);
          if (giftCd) giftCd.textContent = 'Şu an kart hazırlanamadı, lütfen tekrar dene.';
          return;
        }
        var r = res.body.result;
        // DAHA ÖNCE ÇEVİRMİŞ (başka cihaz/tarayıcıdan aynı e-posta/telefon): sahte "yeni
        // kazandın" animasyonu YAPMA. Eskiden eski (çoğu zaman süresi geçmiş) kupon yeni
        // kazanılmış gibi gösteriliyordu → müşteri sepette kullanamayıp şikayet ediyordu.
        if (res.body.already_spun) {
          var stp = getState(); stp.spun = true; stp.lastShown = Date.now();
          var expT = r ? parseExpiry(r.coupon_expires_at) : null;
          var validC = !!(r && r.coupon_code && expT && expT > Date.now());
          if (validC) { stp.won = true; stp.coupon = { code: r.coupon_code, label: r.prize_label, min: r.min_basket, expires: r.coupon_expires_at, variant: r.variant || 'wheel', campaign: cfg.campaign }; }
          setState(stp);
          STATE.done = true;
          formEl.style.display = 'none';
          result.style.display = 'block';
          if (card) { card.unlock(r, null); card.revealNow(); }
          if (formless) {
            // Formsuz kazı kazan: daha önce kazımış → modal kapanır, geçerli kuponu sağ panelde görür.
            if (validC) {
              teardown(overlay, rootCfg);
              var sp = getState();
              if (sp.coupon) setTimeout(function () { showCouponPanel(cfg, sp.coupon); }, 260);
            } else if (giftCd) {
              giftCd.textContent = 'Bu kartı daha önce kazımıştın.' + (r && r.coupon_code ? ' Önceki kuponunun süresi doldu.' : '');
            }
            return;
          }
          if (validC) {
            buildCoupon(result, {
              title: (r.variant === 'scratch' ? 'Kartını daha önce kazımıştın. Kuponun hâlâ geçerli:' : 'Bu çarkı daha önce çevirmiştin. Kuponun hâlâ geçerli:'),
              prize: r.prize_label || '',
              min: r.min_basket,
              code: r.coupon_code,
              expires: r.coupon_expires_at,
              countdown: r.variant === 'scratch',
            });
          } else {
            result.appendChild(el('div', 'ywheel-win-emoji', scratch ? '🎫' : '🎡'));
            result.appendChild(el('div', 'ywheel-lose', 'Bu kampanyada hakkını daha önce kullandın.' + (r && r.coupon_code ? ' Önceki kuponunun süresi doldu.' : '')));
          }
          return;
        }
        // Sunucu spini + kuponu ZATEN oluşturdu → durumu HEMEN kaydet (animasyonu beklemeden).
        // Kullanıcı çevirme sırasında popup'ı kapatsa bile: kupon kaybolmaz, çark "çevrilmemiş"
        // gibi olmaz, tekrar çeviremez (kulakçık doğru şekilde kupon paneli olarak gelir).
        var st = getState(); st.spun = true; st.lastShown = Date.now();
        if (r.is_win) { st.won = true; if (r.coupon_code) st.coupon = { code: r.coupon_code, label: r.prize_label, min: r.min_basket, expires: r.coupon_expires_at, variant: r.variant || 'wheel', campaign: cfg.campaign }; }
        setState(st);
        var finish = function () {
          STATE.done = true;
          formEl.style.display = 'none';
          if (scratch && r.is_win && r.coupon_code) {
            // Kazı kazan kazanımı: modal kapanır, sağ kulakçık AÇIK gelir (süre + kod + durum orada).
            teardown(overlay, rootCfg);
            var s4 = getState();
            if (s4.coupon) setTimeout(function () { showCouponPanel(cfg, s4.coupon); }, 260);
            return;
          }
          if (formless) {
            // Kaybeden: kartta "Bu sefer olmadı" zaten görünür; alt satırı güncelle, kapatma butonu kalır.
            if (giftCd) giftCd.textContent = r.is_win ? '' : (d.lose_message || 'Bu sefer olmadı, bir dahaki sefere!');
            if (PREVIEW) { var again2 = el('button', 'ywheel-replay', '↻ Önizlemeyi tekrarla (test)'); again2.type = 'button'; again2.onclick = function () { overlay.remove(); open(rootCfg); }; (note.parentNode || left).appendChild(again2); }
            return;
          }
          showResult(result, r, d, scratch);
          if (PREVIEW) {
            // Yalnızca önizlemede: tekrar test için küçük, sade bir link (müşteriye gösterilmez).
            var again = el('button', 'ywheel-replay', '↻ Önizlemeyi tekrarla (test)');
            again.type = 'button';
            again.onclick = function () { overlay.remove(); open(rootCfg); };
            result.appendChild(again);
          }
        };
        if (scratch) {
          // Kazı kazan: buton gider; folyo kazınınca sonuç (kod) gelir.
          btn.style.display = 'none';
          formErr.textContent = '';
          if (giftCd) {
            giftCd.textContent = 'Kartı parmağınla kazı, sana özel indirimini gör.';
          } else {
            formEl.appendChild(el('div', 'ywheel-scratch-hint', '👈 Soldaki kartı parmağınla / fareyle kazı'));
          }
          card.unlock(r, finish);
        } else {
          animateTo(canvas, cfg.slices.length, r.slice_index, finish);
        }
    }
    function onSpinError() {
      STATE.spinning = false; btn.disabled = false; btn.textContent = btnLabel;
      formErr.textContent = 'Bağlantı hatası, tekrar deneyin.';
      if (giftCd) giftCd.textContent = 'Bağlantı hatası, lütfen tekrar dene.';
    }

    formEl.onsubmit = function (e) { e.preventDefault(); submitSpin(); };
    // Formsuz kazı kazan: kart açılır açılmaz sunucudan sana özel kartı iste.
    if (formless) { if (preset) { STATE.spinning = true; onSpin(preset); } else { setTimeout(submitSpin, 250); } }

    overlay.appendChild(modal);
    overlay.onclick = function (e) { if (e.target === overlay) teardown(overlay, rootCfg); };
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('ywheel-in'); });
  }

  // Pencereyi açma kararı. Formsuz kazı kazanda ÖNCE sunucuya sorulur: daha önce kazımışsa
  // pencere HİÇ açılmaz → kupon geçerliyse kulakçık (sayaçlı), süresi geçtiyse hiçbir şey.
  function launch(rootCfg) {
    var a = activeCfg(rootCfg);
    var formless = a.game === 'scratch' && a.scratch && a.scratch.skip_form;
    if (!formless || PREVIEW) { open(rootCfg); return; }
    postSpin({ fingerprint: fingerprint(), source_url: location.href, hp: '' }, a.campaign).then(function (res) {
      if (!res.ok) { open(rootCfg); return; } // hata mesajını pencere gösterir
      var r = res.body.result;
      if (res.body.already_spun) {
        var st = getState(); st.spun = true; st.lastShown = Date.now(); st.seen = true;
        var exp = r ? parseExpiry(r.coupon_expires_at) : null;
        var valid = !!(r && r.coupon_code && exp && exp > Date.now());
        if (valid) { st.won = true; st.coupon = { code: r.coupon_code, label: r.prize_label, min: r.min_basket, expires: r.coupon_expires_at, variant: r.variant || 'scratch', campaign: a.campaign }; }
        setState(st);
        if (valid) mountTab(rootCfg); // süresi geçtiyse: hiçbir şey
        return;
      }
      open(rootCfg, res); // yeni kart: pencere açılır, kart hemen kazınabilir
    }).catch(function () { open(rootCfg); });
  }

  function addField(formEl, type, placeholder, required) {
    var field = el('div', 'ywheel-field');
    var input = el('input', 'ywheel-input'); input.type = type; input.placeholder = placeholder + (required ? ' *' : '');
    input.setAttribute('autocomplete', type === 'email' ? 'email' : (type === 'tel' ? 'tel' : 'name'));
    if (type === 'tel') input.inputMode = 'tel';
    var err = el('div', 'ywheel-fielderr');
    field.appendChild(input); field.appendChild(err);
    formEl.appendChild(field);
    return { wrap: field, input: input, err: err };
  }

  function bindInput(f, filter, validate, msg, onChange) {
    f.input.addEventListener('input', function () {
      if (filter) { var c = f.input.selectionStart; f.input.value = filter(f.input.value); try { f.input.setSelectionRange(c, c); } catch (e) {} }
      f.input.classList.remove('ywheel-invalid'); f.err.textContent = '';
      onChange();
    });
    f.input.addEventListener('blur', function () {
      if (f.input.value && !validate(f.input.value)) { f.input.classList.add('ywheel-invalid'); f.err.textContent = msg; }
      else { f.input.classList.remove('ywheel-invalid'); f.err.textContent = ''; }
    });
  }

  function addConsent(formEl, text) {
    var label = el('label', 'ywheel-consent');
    var cb = el('input'); cb.type = 'checkbox';
    label.appendChild(cb); label.appendChild(el('span', null, text || ''));
    formEl.appendChild(label);
    return cb;
  }

  function animateTo(canvas, n, index, cb) {
    if (index == null) index = 0;
    // İdle (sallanma) CSS animasyonunu KESİN kapat — yoksa transform'u ezip dönüşü engeller.
    canvas.classList.remove('ywheel-idle');
    canvas.style.animation = 'none';
    canvas.style.transform = 'rotate(0deg)';
    void canvas.offsetWidth; // reflow: başlangıç durumunu işle ki geçiş tetiklensin
    var seg = 360 / n, target = 360 * 6 - (index + 0.5) * seg;
    canvas.style.transition = 'transform 5s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    canvas.style.transform = 'rotate(' + target + 'deg)';
    setTimeout(cb, 5200);
  }

  // Tarih metnini ("Y-m-d H:i:s") epoch ms'e çevirir.
  function parseExpiry(str) { if (!str) return null; var t = Date.parse(String(str).replace(' ', 'T')); return isNaN(t) ? null : t; }

  // "Bu kodu X saat/gün içinde kullanabilirsin." metni (son kullanmaya göre).
  function validityText(expires) {
    var t = parseExpiry(expires);
    if (!t) return '';
    var hrs = Math.ceil((t - Date.now()) / 3600000);
    if (hrs < 1) return 'Kuponun süresi dolmuş olabilir.';
    if (hrs >= 48) return 'Bu kodu ' + Math.ceil(hrs / 24) + ' gün içinde kullanabilirsin.';
    return 'Bu kodu ' + hrs + ' saat içinde kullanabilirsin.';
  }

  // Geri sayım kutuları (Gün/Saat/Dakika/Saniye) — son kullanmaya kadar, saniyede bir.
  function buildCountdown(expiresStr) {
    var target = parseExpiry(expiresStr);
    if (!target) return null;
    var wrap = el('div', 'ywheel-countdown');
    var labels = ['Gün', 'Saat', 'Dakika', 'Saniye'];
    var nums = []; var boxes = [];
    for (var i = 0; i < 4; i++) {
      var box = el('div', 'ywheel-cd-box');
      var num = el('div', 'ywheel-cd-num', '0');
      box.appendChild(num); box.appendChild(el('div', 'ywheel-cd-lab', labels[i]));
      wrap.appendChild(box); nums.push(num); boxes.push(box);
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
      var diff = Math.max(0, target - Date.now());
      var s = Math.floor(diff / 1000);
      var d = Math.floor(s / 86400); s -= d * 86400;
      var h = Math.floor(s / 3600); s -= h * 3600;
      var m = Math.floor(s / 60); s -= m * 60;
      // Gün kutusu sadece gerçekten gün kaldıysa görünür (24 saatlik kuponda gizli);
      // saat kutusu da 1 saatin altında gizlenir (30 dk kazı kazan: yalnız Dakika/Saniye → aciliyet).
      boxes[0].style.display = d > 0 ? '' : 'none';
      boxes[1].style.display = (d > 0 || h > 0) ? '' : 'none';
      nums[0].textContent = d; nums[1].textContent = pad(h); nums[2].textContent = pad(m); nums[3].textContent = pad(s);
    }
    tick();
    setInterval(tick, 1000);
    return wrap;
  }

  // 2000 → "2.000" (TR binlik ayracı; Intl bazı eski WebView'larda yok, regex güvenli).
  function formatTL(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Kazanım/kupon içeriği: başlık + ödül + kod (Kopyala butonlu) + geçerlilik notu.
  function buildCoupon(container, opts) {
    container.appendChild(el('div', 'ywheel-win-emoji', '🎉'));
    container.appendChild(el('div', 'ywheel-win-title', opts.title));
    if (opts.prize) { var pz = el('div', 'ywheel-win-prize'); pz.textContent = opts.prize; container.appendChild(pz); }
    // Minimum sepet koşulu (ör. 500 TL kupon → 2.000 TL üzeri) — müşteri sepette
    // sürprizle karşılaşmasın diye kazanım anında ve kupon panelinde açıkça gösterilir.
    var minB = Math.round(Number(opts.min) || 0);
    if (minB > 0) {
      container.appendChild(el('div', 'ywheel-minbasket',
        formatTL(minB) + ' TL ve üzeri alışverişlerde geçerlidir'));
    }
    if (opts.countdown) {
      var cd = buildCountdown(opts.expires);
      if (cd) container.appendChild(cd);
    }
    if (opts.code) {
      container.appendChild(el('div', 'ywheel-code-label', 'Kupon kodun'));
      var row = el('div', 'ywheel-code-row');
      var code = el('div', 'ywheel-code'); code.appendChild(el('span', null, opts.code));
      var copy = el('button', 'ywheel-copybtn'); copy.type = 'button'; copy.textContent = 'Kopyala';
      function doCopy() {
        try { navigator.clipboard.writeText(opts.code); } catch (e) {}
        code.classList.add('copied'); copy.classList.add('copied'); copy.textContent = 'Kopyalandı ✓';
        setTimeout(function () { copy.classList.remove('copied'); copy.textContent = 'Kopyala'; }, 1800);
      }
      code.onclick = doCopy; copy.onclick = doCopy;
      row.appendChild(code); row.appendChild(copy);
      container.appendChild(row);
    }
    // Geri sayım varsa ayrıca metin gösterme (tekrar olmasın).
    if (!opts.countdown) {
      var vt = validityText(opts.expires);
      if (vt) container.appendChild(el('div', 'ywheel-validity', vt));
    }
  }

  function showResult(container, r, d, scratch) {
    container.style.display = 'block';
    if (r.is_win) {
      // Çevirme anı: temiz beyaz panelde net kazanım ekranı (yeşil/sayaç KULAKÇIKTA).
      // Kazı kazanda sayaç BURADA da akar (30 dk → hemen kullan baskısı).
      buildCoupon(container, {
        title: scratch ? 'Sana özel kuponun hazır!' : 'Tebrikler, kazandın!',
        prize: r.prize_label || '',
        min: r.min_basket,
        code: r.coupon_code,
        expires: r.coupon_expires_at,
        countdown: !!scratch,
      });
      if (scratch) container.appendChild(el('div', 'ywheel-validity ywheel-urgent', 'Bu kod yalnızca sana özel ve süre bitince geçersiz olur. Sepetine ekle, ödemede kodu gir.'));
    } else {
      container.appendChild(el('div', 'ywheel-win-emoji', '🍀'));
      container.appendChild(el('div', 'ywheel-lose', d.lose_message || 'Bu sefer olmadı!'));
    }
  }

  function teardown(overlay, cfg) {
    overlay.classList.add('ywheel-closing');
    setTimeout(function () { overlay.remove(); }, 220);
    var st = getState(); st.lastShown = Date.now(); setState(st);
    mountTab(cfg); // önizlemede de kulakçık görünür (gerçek gibi test)
  }

  // ── yan kulakçık ──
  function removeTab() { if (currentTab) { currentTab.remove(); currentTab = null; } }
  function mountTab(rootCfg) {
    ensureCss();
    removeTab();
    var st = getState();
    var cfg = activeCfg(rootCfg);
    var d = cfg.design;
    var hasCoupon = st.coupon && st.coupon.code;

    // Kupon süresi dolduysa → kuponu unut, kulakçık gösterme.
    if (hasCoupon && st.coupon.expires) {
      var exp = parseExpiry(st.coupon.expires);
      if (exp && exp <= Date.now()) { st.coupon = null; setState(st); hasCoupon = false; }
    }
    if (!hasCoupon && st.spun) return; // çevirdi ama kuponu yok/bitti → gösterecek bir şey yok

    var scratchV = hasCoupon ? (st.coupon.variant === 'scratch') : (cfg.game === 'scratch');
    var scTab = d.tab_label || 'Sana Özel Hediye';
    var label = hasCoupon ? (scratchV ? scTab : 'Çark Hediyesi') : (scratchV ? scTab : (d.tab_label || 'Çark'));
    var cls = 'ywheel-tab ' + (d.tab_position === 'right' ? 'ywheel-tab-right' : 'ywheel-tab-left') + (hasCoupon ? ' ywheel-tab-coupon' : '');
    var tab = el('div', cls);
    applyVars(tab, d);
    var x = el('button', 'ywheel-tab-x', '&times;');
    x.onclick = function (e) { e.stopPropagation(); removeTab(); };
    tab.appendChild(x);
    var body = el('button', 'ywheel-tab-btn');
    body.appendChild(el('span', 'ywheel-tab-label', label));
    body.innerHTML += (hasCoupon ? GIFT_ICON : (scratchV ? TICKET_ICON : WHEEL_ICON));
    // Kazı kazan kuponu: kulakçıkta canlı "dk:sn" sayacı (süre bitince kulakçık kalkar).
    if (hasCoupon && scratchV && st.coupon.expires) {
      var target = parseExpiry(st.coupon.expires);
      if (target) {
        // Sayaç HER cihazda etiketin içinde (aynı dikey yazı) → kulakçık çarkın kupon kulakçığıyla
        // birebir aynı genişlikte kalır (ayrı rozet kulakçığı genişletiyordu).
        var timer = el('span', 'ywheel-tab-timer-inline', '');
        body.querySelector('.ywheel-tab-label').appendChild(timer);
        var tabTick = function () {
          var diff = Math.max(0, target - Date.now());
          if (diff <= 0) { clearInterval(iv); var s3 = getState(); s3.coupon = null; setState(s3); removeTab(); return; }
          var s = Math.floor(diff / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
          var p = function (n) { return (n < 10 ? '0' : '') + n; };
          timer.textContent = ' · ' + (h > 0 ? h + ':' : '') + p(m) + ':' + p(sec);
          timer.classList.toggle('ywheel-tab-timer-urgent', diff < 5 * 60000);
        };
        tabTick();
        var iv = setInterval(function () { if (!document.body.contains(timer)) { clearInterval(iv); return; } tabTick(); }, 1000);
      }
    }
    body.onclick = function () { if (hasCoupon) showCouponPanel(cfg, st.coupon); else launch(rootCfg); };
    tab.appendChild(body);
    document.body.appendChild(tab);
    currentTab = tab;

    // Kupon kullanıldı mı? (sipariş/ödeme) — sunucuya sor; kullanıldıysa kulakçığı kaldır.
    if (hasCoupon && !PREVIEW) {
      fetchCouponStatus(st.coupon.code, st.coupon.campaign || cfg.campaign).then(function (active) {
        if (!active) { var s2 = getState(); s2.coupon = null; setState(s2); removeTab(); }
      });
    }
  }

  // Kulakçık ikonları (basit SVG).
  var WHEEL_ICON = '<svg class="ywheel-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>';
  var TICKET_ICON = '<svg class="ywheel-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4z"/><path d="M13 7v10"/></svg>';
  var GIFT_ICON = '<svg class="ywheel-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13"/><path d="M12 8S10.5 4 8.5 4 5.5 6 7 8h5zM12 8s1.5-4 3.5-4 3 2 1.5 4H12z"/></svg>';

  // Çevirme sonrası kupon paneli — SAĞDAN açılan yeşil drawer: başlık + geri sayım + kod.
  function showCouponPanel(cfg, coupon) {
    if (document.querySelector('.ywheel-coupon-overlay')) return;
    var overlay = el('div', 'ywheel-coupon-overlay');
    var drawer = el('div', 'ywheel-drawer ywheel-success');
    function dismiss() { overlay.classList.remove('ywheel-in'); setTimeout(function () { overlay.remove(); }, 320); }

    var close = el('button', 'ywheel-close', '&times;'); close.onclick = dismiss; drawer.appendChild(close);

    // sol dikey şerit: geri oku + "Çark Hediyesi"
    var side = el('div', 'ywheel-drawer-side');
    var back = el('button', 'ywheel-drawer-back', '&rsaquo;'); back.onclick = dismiss; side.appendChild(back);
    var scratchC = coupon.variant === 'scratch';
    side.appendChild(el('span', 'ywheel-drawer-sidetext', scratchC ? (cfg.design.tab_label || 'Sana Özel Hediye') : 'Çark Hediyesi'));
    drawer.appendChild(side);

    var box = el('div', 'ywheel-drawer-body');
    buildCoupon(box, {
      title: scratchC ? 'Sana özel kuponun hazır!' : 'Kuponun hazır!',
      prize: coupon.label || '',
      min: coupon.min,
      code: coupon.code,
      expires: coupon.expires,
      countdown: true, // sağ panelde 24 saatten geri sayan timer
    });
    drawer.appendChild(box);

    overlay.appendChild(drawer);
    overlay.onclick = function (e) { if (e.target === overlay) dismiss(); };
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('ywheel-in'); });
  }

  // ── başlat ──
  // Gerçek sitede test kancası: ?ywheel=a (çark) | b (kazı kazan) | reset (bu tarayıcının
  // widget hafızasını sil). Yalnız localStorage'ı etkiler; sunucu hile kilidi (parmak izi + IP)
  // aynen çalışır → aynı cihazdan tekrar kupon ÜRETMEZ, mevcut kuponu gösterir.
  function applyTestHook() {
    try {
      var v = new URLSearchParams(location.search).get('ywheel');
      if (!v) return false;
      if (v === 'reset') { localStorage.removeItem(LS_KEY); return true; }
      var st = getState();
      if (v === 'a' || v === 'b') { st.variant = v === 'b' ? 'scratch' : 'wheel'; delete st.seen; delete st.lastShown; setState(st); return true; }
    } catch (e) {}
    return false;
  }

  function init() {
    var hooked = applyTestHook();
    fetchConfig().then(function (cfg) {
      if (!cfg || !cfg.active || !cfg.slices || cfg.slices.length < 2) return;
      // Önizleme: tetik/frekans/kayıt yok — hemen aç.
      if (PREVIEW) { open(cfg); return; }
      // Test kancası: kura/tetik beklemeden 1 sn içinde aç (kupon varsa kulakçık).
      if (hooked) { var sh = getState(); if (sh.coupon && sh.coupon.code) { mountTab(cfg); } else if (!sh.spun) { setTimeout(function () { launch(cfg); }, 800); } return; }
      var st = getState();
      if (st.coupon && st.coupon.code) { mountTab(cfg); return; } // kazandı → kupon kulakçığı
      if (st.spun) return;                                        // kaybetti → bir şey yok
      var t = cfg.trigger;
      if (t.type === 'manual') { mountTab(cfg); return; }         // kulakçıktan açılır
      if (shouldShow(t)) {
        if (t.type === 'exit_intent') {
          var opened = false;
          document.addEventListener('mouseout', function (e) { if (!opened && e.clientY <= 0 && shouldShow(t)) { opened = true; launch(cfg); } });
          if (isMobile()) setTimeout(function () { if (!opened && shouldShow(t)) { opened = true; launch(cfg); } }, Math.max(8, t.delay_seconds) * 1000);
          else mountTab(cfg);
        } else {
          setTimeout(function () { if (shouldShow(t)) launch(cfg); }, (t.delay_seconds || 6) * 1000);
        }
      } else {
        mountTab(cfg); // görüldü ama frekansla bastırıldı → manuel yeniden açma kulakçığı
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
