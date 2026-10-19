/* KATMAN POLİTİKASI (tüm Yunbi widget'ları, düşükten yükseğe): duyuru üst barı 2147481000 < hero KULAKÇIK 2147481900
 * < çan / mobil alt bar 2147482000-2003 < hero çekmece/panel 2147482050-2060 < Yunbi MENÜ 2147482100-2101 (menü açıkken
 * kulakçık ve alt bar arkada kalır) < arama / chat / filtre / galeri görüntüleyici / çark 2147483000+ (tam ekran modallar). */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     Yunbi "Bugüne Özel" Hero Ürün Kulakçığı (CRO)
     Ekran kenarında dikkat çekici bir kulakçık (ribbon/pill/badge); tıklanınca (veya belirlenen süre
     sonra kendiliğinden) açılan çekmecede panelden seçilen 2-4 hero ürün, gerçek sayaç (gece 23:59 veya
     set bitişi), gerçek stok notu, beden çipleriyle çekmeceden sepete ekleme (Ticimax AddToCartV3), kupon.
     Kurulum: <script src="https://hub.yunbi.ai/widget/hero.js?v=3" data-tenant="tonnyblack"></script>
     Demo öznitelikleri: data-force="1" (gizleme/sıklık kuralları yok), data-open="1" (hemen aç),
     data-theme (JSON), data-rules (JSON), data-mount (iframe demo), data-debug="1"
     ═══════════════════════════════════════════════════════════════════════ */

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var TENANT = SCRIPT.getAttribute('data-tenant');
  if (!TENANT) return;
  if (window.__yunbiHeroLoaded) return;
  window.__yunbiHeroLoaded = true;

  var VERSION = 4;
  var API = SCRIPT.src.replace(/\/widget\/hero\.js.*$/, '/w/' + TENANT + '/hero');
  var FORCE = SCRIPT.getAttribute('data-force') === '1';
  var AUTO_OPEN_NOW = SCRIPT.getAttribute('data-open') === '1';
  var MOUNT_SEL = SCRIPT.getAttribute('data-mount') || '';
  var DEBUG = SCRIPT.getAttribute('data-debug') === '1';
  var FORCE_THEME = null, FORCE_RULES = null;
  try { FORCE_THEME = SCRIPT.getAttribute('data-theme') ? JSON.parse(SCRIPT.getAttribute('data-theme')) : null; } catch (e) { }
  try { FORCE_RULES = SCRIPT.getAttribute('data-rules') ? JSON.parse(SCRIPT.getAttribute('data-rules')) : null; } catch (e) { }
  function dbg() { if (DEBUG && window.console) console.log.apply(console, ['[YunbiHero]'].concat([].slice.call(arguments))); }

  var SID = (function () {
    try { var k = 'yunbi_sid', v = localStorage.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; } catch (e) { return 'w' + Date.now().toString(36); }
  })();

  var cfg = null, host = null, root = null, isOpen = false, opened = false, tickTm = null, autoTm = null, clockOffset = 0, selected = {}, MOBILE_BP = 640;
  var mIdx = 0, mSel = {}; // minimal düzen: gösterilen ürün + seçili renk (kardeş ürün id)
  function isMini() { return cfg && cfg.theme && cfg.theme.layout === 'minimal'; }
  function isPanel() { return cfg && cfg.theme && cfg.theme.layout === 'panel'; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  function money(n) { n = Number(n || 0); var s = n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return s.replace(/,00$/, '') + ' TL'; }
  function hexRgb(h) { h = (h || '#dc2626').replace('#', ''); if (h.length !== 6) h = 'dc2626'; return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function isMobile() { return window.innerWidth <= MOBILE_BP; }
  function device() { return window.innerWidth <= 768 ? 'm' : 'd'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  /* ═══ sayfa tipi / gizleme ═══ */
  function pageType() {
    var p = location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (p === '/') return 'home';
    var cartPath = (cfg.cart_url || '').replace(/^https?:\/\/[^/]+/, '').toLowerCase();
    if (cartPath && p.indexOf(cartPath.replace(/\/$/, '')) === 0) return 'cart';
    if (/^\/(hesabim|uyegiris|uye|account|login)/.test(p)) return 'account';
    if (qs('.ProductListContent') && qs('.filterBlock')) return 'category';
    if (window.productDetailModel || qs('#divSatinAl, .product-detail, #divUrunDetay, .productDetailPage')) return 'product';
    return 'other';
  }
  function shouldHide() {
    if (FORCE) return false;
    var r = cfg.rules;
    var paths = (r.hide_paths || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var p = location.pathname.toLowerCase();
    for (var i = 0; i < paths.length; i++) if (p.indexOf(paths[i]) === 0) return true;
    var pt = pageType();
    if (pt === 'cart') return true;
    if (/sepet|checkout|odeme|siparis|payment|basket/.test(p)) return true;
    if ((r.hide_page_types || []).indexOf(pt) >= 0) return true;
    if (r.max_width > 0 && window.innerWidth > r.max_width) return true;
    if (r.min_width > 0 && window.innerWidth < r.min_width) return true;
    return false;
  }

  /* ═══ sıklık (otomatik açılma) ═══ */
  function seenKey() { return 'yunbi_hero_seen:' + ((cfg.set && cfg.set.id) || 'x'); }
  function wasSeen() {
    if (FORCE) return false;
    var f = cfg.rules.frequency || 'day';
    try {
      if (f === 'always') return false;
      if (f === 'session') return sessionStorage.getItem(seenKey()) === '1';
      return localStorage.getItem(seenKey()) === today();
    } catch (e) { return false; }
  }
  function markSeen() {
    try { sessionStorage.setItem(seenKey(), '1'); localStorage.setItem(seenKey(), today()); } catch (e) { }
  }

  /* ═══ olay ═══ */
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, sid: SID, path: location.pathname, page_type: pageType(), device: device(), set_id: cfg && cfg.set ? cfg.set.id : '' }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }));
      else fetch(API + '/event', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true });
    } catch (e) { }
  }

  /* ═══ CSS ═══ */
  function css(t) {
    var acc = t.accent || '#dc2626', acc2 = t.accent2 || '#7f1d1d', bg = t.bg || '#ffffff', ink = t.ink || '#111827';
    var dark = t.preset === 'black' || (bg && /^#(0|1|2)/.test(bg));
    var muted = dark ? 'rgba(255,255,255,.62)' : '#6b7280', line = dark ? 'rgba(255,255,255,.1)' : '#f0f1f4', card = dark ? 'rgba(255,255,255,.04)' : '#fff', chipBg = dark ? 'rgba(255,255,255,.08)' : '#f3f4f6';
    var gold = t.preset === 'black' ? '#f5c451' : acc;
    var r = (t.radius != null ? t.radius : 20) + 'px', w = (t.drawer_width || 440) + 'px';
    var font = t.font ? t.font + ',' : '';
    var pulse = t.tab_pulse !== false && !reducedMotion();
    var left = /^left/.test(t.tab_position || '');
    var bottom = /bottom$/.test(t.tab_position || '');
    var side = left ? 'left' : 'right', oside = left ? 'right' : 'left';
    var c = [
      ':host{all:initial;font-family:' + font + 'inherit;--acc:' + acc + ';--acc2:' + acc2 + ';--accrgb:' + hexRgb(acc) + ';--bg:' + bg + ';--ink:' + ink + ';--muted:' + muted + ';--line:' + line + ';--card:' + card + ';--chip:' + chipBg + ';--gold:' + gold + ';--r:' + r + ';-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}',
      '*{box-sizing:border-box}button,a{font:inherit;color:inherit;text-decoration:none;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}img{display:block;max-width:100%}',
      /* ── kulakçık ── */
      '.tab{position:fixed;z-index:2147481900;' + side + ':0;display:flex;flex-direction:column;align-items:center;gap:6px;color:#fff;background:linear-gradient(160deg,var(--acc),var(--acc2));box-shadow:0 10px 30px rgba(var(--accrgb),.35),0 2px 6px rgba(0,0,0,.15);transition:transform .25s ease,opacity .25s;cursor:pointer;user-select:none;letter-spacing:.06em;font-weight:800}',
      '.tab.hide{opacity:0;pointer-events:none;transform:translate' + (left ? 'X(-110%)' : 'X(110%)') + '}',
      '.tab .em{font-size:20px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}',
      '.tab .tx{font-size:12.5px;white-space:nowrap}',
      '.tab .tm{font-variant-numeric:tabular-nums;font-size:11.5px;font-weight:700;background:rgba(255,255,255,.18);border-radius:8px;padding:3px 7px;letter-spacing:.02em}',
      '.tab .ct{position:absolute;top:-6px;' + oside + ':-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#fff;color:var(--acc);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2)}',
      /* ribbon: dikey şerit */
      '.tab.ribbon{top:50%;transform:translateY(-50%);padding:14px 9px 16px;border-radius:' + (left ? '0 14px 14px 0' : '14px 0 0 14px') + '}.tab.ribbon .tx{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13px}.tab.ribbon .tm{writing-mode:vertical-rl;transform:rotate(180deg)}.tab.ribbon:hover{transform:translateY(-50%) translateX(' + (left ? '2px' : '-2px') + ')}',
      '.tab.ribbon.bottom{top:auto;bottom:calc(120px + env(safe-area-inset-bottom,0));transform:none}.tab.ribbon.bottom:hover{transform:translateX(' + (left ? '2px' : '-2px') + ')}',
      /* pill: yatay yüzen hap */
      '.tab.pill{flex-direction:row;gap:9px;padding:11px 16px 11px 14px;border-radius:999px;' + side + ':16px;bottom:calc(22px + env(safe-area-inset-bottom,0))}.tab.pill.withbar{bottom:calc(84px + env(safe-area-inset-bottom,0))}.tab.pill.mid{bottom:auto;top:50%;transform:translateY(-50%)}.tab.pill:hover{transform:translateY(-2px)}.tab.pill.mid:hover{transform:translateY(calc(-50% - 2px))}',
      /* badge: yuvarlak düğme */
      '.tab.badge{width:58px;height:58px;border-radius:50%;justify-content:center;gap:0;' + side + ':16px;bottom:calc(22px + env(safe-area-inset-bottom,0))}.tab.badge.withbar{bottom:calc(84px + env(safe-area-inset-bottom,0))}.tab.badge.mid{bottom:auto;top:50%;transform:translateY(-50%)}.tab.badge .em{font-size:24px}.tab.badge .tx,.tab.badge .tm{display:none}.tab.badge:hover{transform:scale(1.06)}.tab.badge.mid:hover{transform:translateY(-50%) scale(1.06)}',
      pulse ? '.tab:before{content:"";position:absolute;inset:-3px;border-radius:inherit;border:2px solid rgba(var(--accrgb),.7);animation:yh-pulse 2.4s ease-out infinite;pointer-events:none}@keyframes yh-pulse{0%{opacity:.9;transform:scale(1)}70%{opacity:0;transform:scale(1.14)}100%{opacity:0;transform:scale(1.14)}}' : '',
      pulse ? '.tab .em{animation:yh-wig 3.2s ease-in-out infinite}@keyframes yh-wig{0%,80%,100%{transform:rotate(0)}84%{transform:rotate(-12deg)}88%{transform:rotate(10deg)}92%{transform:rotate(-6deg)}96%{transform:rotate(4deg)}}' : '',
      /* ── çekmece ── */
      '.ov{position:fixed;inset:0;background:rgba(10,10,20,.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);z-index:2147482050;opacity:0;pointer-events:none;transition:opacity .25s}.ov.on{opacity:1;pointer-events:auto}',
      '.dr{position:fixed;top:0;bottom:0;' + side + ':0;width:min(' + w + ',100vw);z-index:2147482051;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;transform:translateX(' + (left ? '-105%' : '105%') + ');transition:transform .32s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 60px rgba(0,0,0,.3);overflow:hidden}.dr.on{transform:none}',
      '.dr.sheet{top:auto;left:0;right:0;width:100vw;max-height:92vh;border-radius:22px 22px 0 0;transform:translateY(105%);padding-bottom:env(safe-area-inset-bottom,0)}.dr.sheet.on{transform:none}',
      '.dr .grab{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.55);position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:2}',
      /* başlık */
      '.hd{position:relative;padding:26px 22px 20px;background:linear-gradient(135deg,var(--acc) 0%,var(--acc2) 100%);color:#fff;overflow:hidden;flex:none}',
      '.hd:before{content:"";position:absolute;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.28),rgba(255,255,255,0) 70%);top:-120px;' + oside + ':-80px;pointer-events:none}',
      '.hd:after{content:"";position:absolute;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,.25),rgba(0,0,0,0) 70%);bottom:-120px;' + side + ':-40px;pointer-events:none}',
      '.hd>*{position:relative;z-index:1}',
      '.eb{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:5px 11px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}',
      '.eb .dot{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.3)}' + (pulse ? '.eb .dot{animation:yh-blink 1.6s ease-in-out infinite}@keyframes yh-blink{50%{opacity:.35}}' : ''),
      '.hd h2{margin:12px 0 4px;font-size:26px;line-height:1.1;font-weight:900;letter-spacing:-.01em}.hd p{margin:0;font-size:13.5px;line-height:1.45;opacity:.9;max-width:36ch}',
      '.x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;z-index:2;transition:background .15s}.x:hover{background:rgba(255,255,255,.3)}',
      /* sayaç */
      '.cd{display:flex;align-items:center;gap:10px;margin-top:16px}.cd .lb{font-size:11.5px;font-weight:600;opacity:.9;letter-spacing:.02em;max-width:9ch;line-height:1.25}',
      '.cd .bx{display:flex;align-items:center;gap:5px}.cd .u{display:flex;flex-direction:column;align-items:center;min-width:50px;padding:7px 6px 5px;border-radius:12px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(4px)}',
      '.cd .n{font-size:21px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:.02em}.cd .s{font-size:9.5px;font-weight:700;opacity:.75;margin-top:3px;letter-spacing:.1em}.cd .c{font-size:20px;font-weight:900;opacity:.7;margin-top:-4px}',
      '.cd.over .u{background:rgba(0,0,0,.4)}',
      /* kupon */
      '.cp{margin:14px 16px 0;padding:11px 12px;border:1.5px dashed rgba(var(--accrgb),.55);border-radius:14px;background:rgba(var(--accrgb),.06);display:flex;align-items:center;gap:10px}.cp .k{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;font-size:15px;letter-spacing:.12em;color:var(--acc)}.cp .t{font-size:12px;color:var(--muted);line-height:1.3;flex:1;min-width:0}.cp .cb{border:1px solid rgba(var(--accrgb),.4);border-radius:999px;padding:6px 11px;font-size:12px;font-weight:700;color:var(--acc);white-space:nowrap}.cp .cb.ok{background:var(--acc);color:#fff;border-color:var(--acc)}',
      /* liste */
      '.bd{flex:1;overflow:auto;padding:14px 16px 18px;-webkit-overflow-scrolling:touch}.bd.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start}',
      '.it{display:flex;gap:14px;padding:12px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);margin-bottom:12px;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.04)}.grid .it{flex-direction:column;gap:10px;margin:0}',
      '.im{position:relative;flex:0 0 36%;border-radius:calc(var(--r) - 6px);overflow:hidden;background:#f3f4f6;aspect-ratio:3/4}.grid .im{flex:none;width:100%}.im img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.it:hover .im img{transform:scale(1.04)}',
      '.im .dc{position:absolute;top:8px;left:8px;background:var(--acc);color:#fff;font-size:11.5px;font-weight:900;padding:4px 7px;border-radius:8px;letter-spacing:.02em;box-shadow:0 2px 6px rgba(var(--accrgb),.4)}',
      '.im .rk{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:rgba(17,24,39,.75);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}',
      '.in{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.br{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
      '.nm{font-size:14px;line-height:1.3;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--ink)}.nm a{color:inherit}',
      '.pr{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.pr .np{font-size:20px;font-weight:900;color:var(--acc);letter-spacing:-.01em}.pr .op{font-size:12.5px;color:var(--muted);text-decoration:line-through}.pr .np.plain{color:var(--ink)}',
      '.mt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--muted)}.mt .st{color:var(--acc);font-weight:700}.mt .rt{display:inline-flex;align-items:center;gap:3px}.mt .rt b{color:var(--ink)}',
      '.sz{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.sz .lbl{font-size:11px;color:var(--muted);width:100%;margin-bottom:-2px}.sz button{min-width:34px;height:30px;padding:0 8px;border-radius:9px;background:var(--chip);font-size:12px;font-weight:700;color:var(--ink);border:1.5px solid transparent;transition:all .15s}.sz button.on{background:var(--acc)!important;color:#fff!important;border-color:var(--acc)!important;box-shadow:0 4px 10px rgba(var(--accrgb),.35)}.sz button.low{position:relative}.sz button.low:after{content:"";position:absolute;top:-3px;right:-3px;width:7px;height:7px;border-radius:50%;background:var(--acc)}.sz.shake{animation:yh-shake .4s}@keyframes yh-shake{20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}',
      '.sz .more{background:none;color:var(--muted);font-weight:600}',
      '.ac{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:4px;flex-wrap:wrap}',
      '.cta{flex:1;min-width:0;height:42px;padding:0 14px;white-space:nowrap;border-radius:12px;background:var(--acc);color:#fff;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 6px 16px rgba(var(--accrgb),.3);transition:transform .15s,box-shadow .15s,background .2s;letter-spacing:.01em}.cta:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(var(--accrgb),.38)}.cta:active{transform:translateY(0)}.cta.busy{opacity:.7;pointer-events:none}.cta.ok{background:#059669;box-shadow:0 6px 16px rgba(5,150,105,.3)}.cta svg{width:17px;height:17px}',
      '.vw{flex:none;width:42px;height:42px;border-radius:12px;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted);transition:all .15s}.vw svg{width:18px;height:18px}.vw:hover{color:var(--acc);border-color:var(--acc)}.grid .vw{display:none}',
      '.hint{font-size:11.5px;color:var(--acc);font-weight:600}',
      /* alt */
      '.ft{flex:none;padding:12px 16px calc(14px + env(safe-area-inset-bottom,0));border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--muted)}.ft a{color:var(--acc);font-weight:700}.ft .gc{display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:var(--bg);border-radius:999px;padding:8px 14px;font-weight:700}',
      '.empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:14px}',
      '.toast{position:fixed;left:16px;right:16px;bottom:calc(20px + env(safe-area-inset-bottom,0));z-index:2147482060;background:#111827;color:#fff;font-size:13px;line-height:1.4;border-radius:12px;padding:11px 14px;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}.toast.on{opacity:1;transform:none}',
      /* ── minimal kart (tek ürün, renk seçenekleri) ── */
      '.mn{position:fixed;z-index:2147482051;' + side + ':16px;top:50%;width:320px;max-width:calc(100vw - 32px);background:var(--bg);color:var(--ink);border-radius:var(--r);box-shadow:0 24px 60px rgba(0,0,0,.28),0 0 0 1px var(--line);overflow:hidden;transform:translateY(-50%) translateX(' + (left ? '-120%' : '120%') + ');opacity:0;pointer-events:none;transition:transform .38s cubic-bezier(.2,.8,.2,1),opacity .3s}.mn.on{transform:translateY(-50%);opacity:1;pointer-events:auto}',
      '.mn .mh{display:flex;align-items:center;gap:7px;padding:10px 12px;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.mn .mh .dot{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.3)}' + (pulse ? '.mn .mh .dot{animation:yh-blink 1.6s ease-in-out infinite}' : '') + '.mn .mh .mt{margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px;letter-spacing:.02em;background:rgba(0,0,0,.22);padding:3px 8px;border-radius:8px}.mn .mx{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;color:#fff;flex:none}.mn .mx:hover{background:rgba(255,255,255,.32)}',
      '.mn .ph{position:relative;aspect-ratio:4/5;background:#f3f4f6;overflow:hidden;display:block}.mn .ph img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.mn .ph:hover img{transform:scale(1.03)}.mn .ph .dc{position:absolute;top:10px;left:10px;background:var(--acc);color:#fff;font-size:12px;font-weight:900;padding:5px 8px;border-radius:9px;box-shadow:0 2px 8px rgba(var(--accrgb),.4)}',
      '.mn .nv{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.92);color:#111;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.2);transition:background .15s}.mn .nv:hover{background:#fff}.mn .nv.l{left:10px}.mn .nv.r{right:10px}.mn .nv svg{width:16px;height:16px}',
      '.mn .dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:5px;pointer-events:none}.mn .dots i{width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.65);transition:width .2s}.mn .dots i.on{background:#fff;width:16px}',
      '.mn .mb{padding:12px 14px 14px}.mn .mbr{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.mn .mnm{font-size:13.5px;font-weight:600;line-height:1.3;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.mn .mnm a{color:inherit}',
      '.mn .mpr{display:flex;align-items:baseline;gap:8px;margin-top:6px;flex-wrap:wrap}.mn .mpr .np{font-size:21px;font-weight:900;color:var(--acc);letter-spacing:-.01em}.mn .mpr .np.plain{color:var(--ink)}.mn .mpr .op{font-size:12.5px;color:var(--muted);text-decoration:line-through}.mn .mst{font-size:11.5px;color:var(--acc);font-weight:700;margin-left:auto}',
      '.mn .cl{margin-top:10px}.mn .clh{display:flex;justify-content:space-between;align-items:baseline;font-size:11.5px;color:var(--muted);margin-bottom:7px}.mn .clh b{color:var(--ink);font-weight:600}.mn .sw{display:flex;gap:8px;flex-wrap:wrap}.mn .sw button{width:26px;height:26px;border-radius:50%;border:2px solid var(--bg);box-shadow:0 0 0 1.5px rgba(0,0,0,.12);position:relative;transition:transform .15s,box-shadow .15s;background:#ddd}.mn .sw button:hover{transform:scale(1.1)}.mn .sw button.on{box-shadow:0 0 0 2px var(--acc);transform:scale(1.08)}.mn .sw button.multi{background:conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)}.mn .sw button.unk{background:linear-gradient(135deg,#e5e7eb,#9ca3af)}.mn .sw button.low:after{content:"";position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:var(--acc);border:1.5px solid var(--bg)}',
      '.mn .mcta{display:flex;align-items:center;justify-content:center;gap:7px;height:42px;border-radius:12px;background:var(--acc);color:#fff;font-weight:800;font-size:13.5px;margin-top:12px;box-shadow:0 6px 16px rgba(var(--accrgb),.3);transition:transform .15s}.mn .mcta:hover{transform:translateY(-1px)}.mn .mcta svg{width:17px;height:17px}',
      '@media (max-width:' + MOBILE_BP + 'px){.mn{' + side + ':12px;width:min(320px,calc(100vw - 24px))}.mn .ph{aspect-ratio:1/1}}',
      /* ── panel düzeninde kulakçık = panelin yan şeridiyle birebir (aynı genişlik/yükseklik/biçim) ── */
      '.tab.strip{top:50%;transform:translateY(-50%);width:52px;padding:10px 0 12px;gap:10px;justify-content:space-between;border-radius:' + (left ? '0 20px 20px 0' : '20px 0 0 20px') + ';letter-spacing:.12em;box-shadow:0 10px 30px rgba(var(--accrgb),.35),0 2px 6px rgba(0,0,0,.15)}.tab.strip .em{font-size:21px}.tab.strip .tx{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13.5px}.tab.strip .tw{display:flex;flex-direction:row-reverse;align-items:center;gap:4px}.tab.strip .tl{writing-mode:vertical-rl;transform:rotate(180deg);font-size:8.5px;font-weight:800;letter-spacing:.14em;opacity:.9}.tab.strip .tm{writing-mode:vertical-rl;transform:rotate(180deg);font-size:14px;font-weight:900;letter-spacing:.03em;padding:8px 5px;border-radius:9px;background:#fff;color:var(--acc);box-shadow:0 2px 8px rgba(0,0,0,.25);animation:yh-tm 2s ease-in-out infinite}@keyframes yh-tm{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.25)}50%{box-shadow:0 0 0 4px rgba(255,255,255,.35),0 2px 8px rgba(0,0,0,.25)}}.tab.strip:hover{transform:translateY(-50%) translateX(' + (left ? '2px' : '-2px') + ')}.tab.strip.hide{transform:translateY(-50%)}',
      '@media (max-width:' + MOBILE_BP + 'px){.tab.strip{width:34px;padding:7px 0 8px;border-radius:' + (left ? '0 16px 16px 0' : '16px 0 0 16px') + '}.tab.strip .em{font-size:15px}.tab.strip .tx{font-size:9.5px;letter-spacing:.08em}.tab.strip .tw{gap:2px}.tab.strip .tl{font-size:7px;letter-spacing:.08em}.tab.strip .tm{font-size:11px;padding:5px 2px;border-radius:7px}}',
      /* ── yan panel: kulakçıktan yana büyür, N ürün yan yana (çark kupon paneli deseni) ── */
      '.pn{position:fixed;z-index:2147482051;' + side + ':0;top:50%;transform:translateY(-50%);display:flex;flex-direction:' + (left ? 'row' : 'row-reverse') + ';max-width:calc(100vw - 8px);background:var(--bg);color:var(--ink);border-radius:' + (left ? '0 20px 20px 0' : '20px 0 0 20px') + ';box-shadow:0 24px 60px rgba(0,0,0,.28),0 0 0 1px var(--line);overflow:hidden;clip-path:inset(0 ' + (left ? '100% 0 0' : '0 0 100%') + ');opacity:0;pointer-events:none;transition:clip-path .5s cubic-bezier(.2,.8,.2,1),opacity .25s}.pn.on{clip-path:inset(0 0 0 0);opacity:1;pointer-events:auto}',
      '.pn .ps{flex:0 0 52px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:10px 0 12px;background:linear-gradient(160deg,var(--acc),var(--acc2));color:#fff;gap:10px}.pn .ps .px{width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.28);color:#fff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none}.pn .ps .px:hover{background:rgba(0,0,0,.42)}.pn .ps .pl{writing-mode:vertical-rl;transform:rotate(180deg);font-size:13.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.pn .ps .pe{font-size:23px;line-height:1}.pn .ps .pt{writing-mode:vertical-rl;transform:rotate(180deg);font-size:14px;font-weight:900;font-variant-numeric:tabular-nums;background:#fff;color:var(--acc);border-radius:9px;padding:8px 5px;box-shadow:0 2px 8px rgba(0,0,0,.25);letter-spacing:.02em}',
      '.pn .pb{padding:14px 16px 16px;display:flex;flex-direction:column;gap:11px;min-width:0}.pn .ph2{display:flex;align-items:center;justify-content:space-between;gap:12px}.pn .ph2 h3{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em;line-height:1.15}.pn .ph2 p{margin:2px 0 0;font-size:12px;color:var(--muted)}.pn .pcd{display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;font-weight:800;font-size:14px;color:var(--ink)}.pn .pcd b{background:var(--ink);color:var(--bg);border-radius:7px;padding:4px 6px;min-width:32px;text-align:center;font-size:14px}.pn .pcd small{display:none}',
      '.pn .row{display:flex;gap:11px}.pn .pc{flex:1 1 0;width:172px;min-width:0;display:flex;flex-direction:column;gap:5px;position:relative}.pn .pc .pim{position:relative;display:block;aspect-ratio:3/4;border-radius:12px;overflow:hidden;background:#f3f4f6}.pn .pc .pim img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.pn .pc:hover .pim img{transform:scale(1.04)}.pn .pc .dc{position:absolute;top:8px;left:8px;background:var(--acc);color:#fff;font-size:12px;font-weight:900;padding:3px 7px;border-radius:7px;box-shadow:0 2px 6px rgba(var(--accrgb),.4)}.pn .pc .sg{position:absolute;left:0;right:0;bottom:0;padding:5px 8px;background:linear-gradient(0deg,rgba(17,24,39,.78),rgba(17,24,39,0));color:#fff;font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none}.pn .pc .rk{display:none;position:absolute;top:7px;right:7px;width:20px;height:20px;border-radius:50%;background:rgba(17,24,39,.75);color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center}',
      '.pn .pc .pnm{font-size:12.5px;line-height:1.3;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:32px;margin-top:2px}.pn .pc .pnm a{color:inherit}.pn .pc .ppr{display:flex;flex-direction:column;align-items:flex-start;gap:1px;line-height:1.15;margin-top:1px}.pn .pc .ppr .np{font-size:17.5px;font-weight:900;color:var(--acc)}.pn .pc .ppr .np.plain{color:var(--ink)}.pn .pc .ppr .op{font-size:12px;color:var(--muted);text-decoration:line-through}.pn .pc .pst{font-size:11.5px;color:var(--acc);font-weight:700}.pn .pc .pcl{font-size:12px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:4px}.pn .pc .pcl i{width:10px;height:10px;border-radius:50%;background:conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e);display:inline-block}',
      '.pn .pc .sw{display:flex;align-items:center;gap:5px;min-height:18px}.pn .pc .sw button{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--bg);box-shadow:0 0 0 1px rgba(0,0,0,.14);background:#ddd;transition:transform .15s}.pn .pc .sw button.on{box-shadow:0 0 0 1.5px var(--acc);transform:scale(1.12)}.pn .pc .sw button.multi{background:conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)}.pn .pc .sw button.unk{background:linear-gradient(135deg,#e5e7eb,#9ca3af)}.pn .pc .sw .more{font-size:10.5px;color:var(--muted);font-weight:700}',
      '.pn .pc .pcta{margin-top:auto;height:36px;border-radius:10px;background:var(--acc);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:5px;box-shadow:0 4px 12px rgba(var(--accrgb),.28);transition:transform .15s}.pn .pc .pcta:hover{transform:translateY(-1px)}.pn .pc .pcta svg{display:none}',
      '@media (max-width:' + MOBILE_BP + 'px){.pn{border-radius:' + (left ? '0 16px 16px 0' : '16px 0 0 16px') + ';width:calc(100vw - 10px);max-width:calc(100vw - 10px)}.pn .ps{flex-basis:34px;padding:7px 0 8px}.pn .ps .px{width:22px;height:22px;font-size:14px}.pn .pb{padding:8px 9px 9px;gap:7px}.pn .pc .pim{border-radius:10px}.pn .pc .pnm{margin-top:1px}.pn .ps .pl{font-size:9.5px;letter-spacing:.08em}.pn .ps .pe{font-size:16px}.pn .ps .pt{font-size:11.5px;padding:6px 3px;border-radius:7px}.pn .pb{padding:8px 9px 9px;gap:7px;flex:1 1 auto}.pn .ph2 h3{font-size:12.5px}.pn .ph2 p{display:none}.pn .pcd{font-size:12px}.pn .pcd b{font-size:11px;padding:3px 4px;min-width:24px}.pn .pcd small{display:none}.pn .row{gap:8px}.pn .pc{width:auto;gap:5px}.pn .pc .pim{aspect-ratio:3/4;border-radius:10px}.pn .pc .dc{font-size:9.5px;padding:2px 5px;top:5px;left:5px}.pn .pc .sg{font-size:9.5px;padding:4px 5px;letter-spacing:.1em}.pn .pc .rk{display:none}.pn .pc .pnm{font-size:10.5px;line-height:1.3;min-height:27px;margin-top:1px}.pn .pc .ppr{gap:1px;line-height:1.2;margin-top:1px}.pn .pc .ppr .np{font-size:13.5px}.pn .pc .ppr .op{font-size:10px}.pn .pc .pst{font-size:9.5px}.pn .pc .pcl{font-size:9.5px}.pn .pc .sw button{width:13px;height:13px}.pn .pc .sw .cnt{display:none}.pn .pc .sw .more{font-size:10px}.pn .pc .sw{gap:4px;overflow:hidden}.pn .pc .sw button:nth-child(5){display:none}.pn .pc .pcta{height:28px;font-size:10.5px}}',
      '@media (max-width:' + MOBILE_BP + 'px){.hd{padding:26px 18px 18px}.hd h2{font-size:23px}.cd .u{min-width:46px}.cd .n{font-size:19px}.im{flex-basis:36%}.pr .np{font-size:18px}.tab.ribbon{padding:12px 8px 14px}.tab.ribbon .tx{font-size:12px}.bd.grid{grid-template-columns:1fr 1fr}}',
      '@media (prefers-reduced-motion:reduce){.dr,.ov,.tab{transition:none}.tab.strip .tm{animation:none}}'
    ];
    return c.join('');
  }

  var ICON_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12H5z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  /* ═══ sayaç ═══ */
  function remainMs() { if (!cfg.ends_at) return null; return cfg.ends_at - (Date.now() + clockOffset); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function cdHTML() {
    if (!cfg.ends_at || cfg.rules.timer_mode === 'off') return '';
    var ms = remainMs(), over = ms <= 0; if (over) ms = 0;
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    var u = function (n, l) { return '<div class="u"><span class="n">' + pad(n) + '</span><span class="s">' + l + '</span></div>'; };
    return '<div class="cd' + (over ? ' over' : '') + '" role="timer" aria-live="off"><span class="lb">' + esc(over ? 'Süre doldu' : (cfg.rules.timer_label || 'Kampanya bitimine')) + '</span><div class="bx">' +
      (d > 0 ? u(d, 'GÜN') + '<span class="c">:</span>' : '') + u(h, 'SAAT') + '<span class="c">:</span>' + u(m, 'DK') + '<span class="c">:</span>' + u(s, 'SN') + '</div></div>';
  }
  function tabTimer() {
    if (!cfg.ends_at || cfg.theme.tab_timer === false || cfg.rules.timer_mode === 'off') return '';
    var ms = Math.max(0, remainMs() || 0);
    var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    return h >= 100 ? Math.floor(ms / 86400000) + ' gün' : pad(h) + ':' + pad(m) + ':' + pad(s);
  }
  function tick() {
    var tm = qs('#tabtm', root); if (tm) tm.textContent = tabTimer();
    var cd = qs('#cdwrap', root); if (cd && isOpen) cd.innerHTML = cdHTML();
    var mt = qs('#mtm', root); if (mt) mt.textContent = tabTimer() || '';
    var pt = qs('#ptm', root); if (pt) pt.textContent = tabTimer() || '';
    var pc = qs('#pcd', root); if (pc && isOpen) pc.innerHTML = panelCd();
  }

  /* ═══ render ═══ */
  function tabHTML() {
    var t = cfg.theme, style = t.tab_style || 'ribbon', pos = t.tab_position || 'right-middle';
    var cls = isPanel() ? 'tab strip' : 'tab ' + style + (/bottom$/.test(pos) ? ' bottom' : ' mid') + (qs('#yunbi-bottombar') && isMobile() ? ' withbar' : '');
    if (isPanel()) return '<button class="' + cls + '" id="tab" aria-label="' + esc(t.tab_text || 'Bugüne Özel') + '">' + (t.tab_emoji ? '<span class="em">' + esc(t.tab_emoji) + '</span>' : '<span></span>') + '<span class="tx">' + esc(cfg.rules.eyebrow || t.tab_text || 'BUGÜNE ÖZEL') + '</span>' + (tabTimer() ? '<span class="tw"><span class="tl">' + esc(cfg.rules.tab_timer_label || 'KALAN SÜRE') + '</span><span class="tm" id="tabtm">' + tabTimer() + '</span></span>' : '<span></span>') + '</button>';
    var n = (cfg.products || []).length;
    return '<button class="' + cls + '" id="tab" aria-label="' + esc(t.tab_text || 'Bugüne Özel') + '">' +
      (t.tab_emoji ? '<span class="em">' + esc(t.tab_emoji) + '</span>' : '') +
      '<span class="tx">' + esc(t.tab_text || 'BUGÜNE ÖZEL') + '</span>' +
      (tabTimer() ? '<span class="tm" id="tabtm">' + tabTimer() + '</span>' : '') +
      (n > 0 && style !== 'ribbon' ? '<span class="ct">' + n + '</span>' : '') + '</button>';
  }
  function itemHTML(p, i) {
    var r = cfg.rules, hasD = p.dprice != null && p.dprice < p.price;
    var quick = r.quick_add !== false && (cfg.platform || 'ticimax') === 'ticimax' && p.variants && p.variants.length > 0;
    var sizes = '';
    if (quick && p.variants.length > 1) {
      var vs = p.variants, MAXV = 8, more = vs.length > MAXV + 1;
      sizes = '<div class="sz" data-i="' + i + '"><span class="lbl">Beden seç</span>' + vs.map(function (v, k) {
        return '<button type="button" data-vid="' + esc(v.vid) + '" data-label="' + esc(v.label) + '" class="' + (v.stock <= 2 ? 'low' : '') + (more && k >= MAXV ? ' hid' : '') + '"' + (more && k >= MAXV ? ' style="display:none"' : '') + ' title="' + (v.stock <= 2 ? 'Son ' + v.stock + ' adet' : '') + '">' + esc(v.label) + '</button>';
      }).join('') + (more ? '<button type="button" class="more">+' + (vs.length - MAXV) + '</button>' : '') + '</div>';
    }
    var stockNote = r.show_stock !== false && p.stock > 0 && p.stock <= (r.stock_threshold || 5) ? '<span class="st">Son ' + p.stock + ' adet</span>' : '';
    var rating = p.rating ? '<span class="rt">★ <b>' + String(p.rating).replace('.', ',') + '</b></span>' : '';
    return '<article class="it" data-i="' + i + '">' +
      '<a class="im" href="' + esc(p.url) + '" data-act="view" data-i="' + i + '">' + (p.img ? '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="' + (i < 2 ? 'eager' : 'lazy') + '">' : '') +
      (hasD && r.show_discount_badge !== false ? '<span class="dc">-%' + p.discount_pct + '</span>' : '') + '<span class="rk">' + (i + 1) + '</span></a>' +
      '<div class="in">' + (p.brand ? '<div class="br">' + esc(p.brand) + '</div>' : '') +
      '<h3 class="nm" style="margin:0"><a href="' + esc(p.url) + '" data-act="view" data-i="' + i + '">' + esc(p.name) + '</a></h3>' +
      '<div class="pr">' + (hasD ? '<span class="np">' + money(p.dprice) + '</span><span class="op">' + money(p.price) + '</span>' : '<span class="np plain">' + money(p.price) + '</span>') + '</div>' +
      ((stockNote || rating) ? '<div class="mt">' + stockNote + rating + '</div>' : '') + sizes +
      '<div class="ac">' + (quick ? '<button type="button" class="cta" data-act="atc" data-i="' + i + '">' + ICON_BAG + esc(r.cta_text || 'Sepete Ekle') + '</button>' : '<a class="cta" href="' + esc(p.url) + '" data-act="view" data-i="' + i + '">' + esc(r.view_text || 'Ürünü İncele') + ICON_ARROW + '</a>') +
      (quick ? '<a class="vw" href="' + esc(p.url) + '" data-act="view" data-i="' + i + '" title="' + esc(r.view_text || 'Ürünü İncele') + '" aria-label="' + esc(r.view_text || 'Ürünü İncele') + '">' + ICON_ARROW + '</a>' : '') + '</div>' +
      '</div></article>';
  }
  /* ═══ minimal kart: tek ürün fotoğrafı, renk seçenekleri, eski/yeni fiyat ═══ */
  var ICON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>';
  var ICON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>';
  function miniEntry(i) {
    var p = cfg.products[i]; if (!p) return null;
    var colors = (p.colors && p.colors.length) ? p.colors : [{ id: p.id, name: p.color || '', hex: null, hex2: null, img: p.img, url: p.url, price: p.price, dprice: p.dprice, stock: p.stock }];
    var sel = null;
    for (var k = 0; k < colors.length; k++) if (mSel[i] != null && colors[k].id === mSel[i]) sel = colors[k];
    sel = sel || colors[0];
    return { p: p, colors: colors, sel: sel };
  }
  function miniBody() {
    var n = cfg.products.length, e = miniEntry(mIdx); if (!e) return '';
    var p = e.p, sel = e.sel, r = cfg.rules;
    var hasD = sel.dprice != null && sel.dprice < sel.price, pct = hasD ? Math.round((sel.price - sel.dprice) / sel.price * 100) : 0;
    var sw = e.colors.map(function (c) {
      var cls = (c.id === sel.id ? 'on' : '') + (c.stock <= (r.stock_threshold || 5) ? ' low' : '') + (c.hex === 'multi' ? ' multi' : (!c.hex ? ' unk' : ''));
      var style = c.hex && c.hex !== 'multi' ? 'background:' + (c.hex2 ? 'linear-gradient(135deg,' + c.hex + ' 50%,' + c.hex2 + ' 50%)' : c.hex) : '';
      return '<button type="button" class="' + cls.trim() + '" style="' + style + '" data-cid="' + c.id + '" title="' + esc(c.name) + '" aria-label="' + esc(c.name) + '"></button>';
    }).join('');
    return '<a class="ph" href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '"><img src="' + esc(sel.img) + '" alt="' + esc(p.name) + '">' +
      (hasD && r.show_discount_badge !== false ? '<span class="dc">-%' + pct + '</span>' : '') +
      (n > 1 ? '<span class="nv l" data-nav="-1" role="button" aria-label="Önceki">' + ICON_L + '</span><span class="nv r" data-nav="1" role="button" aria-label="Sonraki">' + ICON_R + '</span><span class="dots">' + cfg.products.map(function (_, k) { return '<i class="' + (k === mIdx ? 'on' : '') + '"></i>'; }).join('') + '</span>' : '') + '</a>' +
      '<div class="mb">' + (p.brand ? '<div class="mbr">' + esc(p.brand) + '</div>' : '') +
      '<div class="mnm"><a href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '">' + esc(p.name) + '</a></div>' +
      '<div class="mpr">' + (hasD ? '<span class="np">' + money(sel.dprice) + '</span><span class="op">' + money(sel.price) + '</span>' : '<span class="np plain">' + money(sel.price) + '</span>') +
      (r.show_stock !== false && sel.stock > 0 && sel.stock <= (r.stock_threshold || 5) ? '<span class="mst">Son ' + sel.stock + ' adet</span>' : '') + '</div>' +
      (e.colors.length > 1 || sel.name ? '<div class="cl"><div class="clh"><span>' + (e.colors.length > 1 ? '<b>' + e.colors.length + ' renk</b> seçeneği' : 'Renk') + '</span><b>' + esc(sel.name) + '</b></div><div class="sw">' + sw + '</div></div>' : '') +
      '<a class="mcta" href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '">' + esc(r.view_text || 'Ürünü İncele') + ICON_ARROW + '</a></div>';
  }
  function miniHTML() {
    var r = cfg.rules, s = cfg.set || {};
    return '<aside class="mn" id="mn" role="dialog" aria-label="' + esc(s.title || r.title || 'Bugüne Özel') + '">' +
      '<div class="mh"><span class="dot"></span><span>' + esc(r.eyebrow || 'BUGÜNE ÖZEL') + '</span>' + (cfg.ends_at && r.timer_mode !== 'off' ? '<span class="mt" id="mtm">' + tabTimer() + '</span>' : '') + '<button type="button" class="mx" id="mx" aria-label="Kapat">×</button></div>' +
      '<div id="mbody">' + (cfg.products.length ? miniBody() : '<div class="empty">Bugün için ürün seçilmedi.</div>') + '</div></aside><div class="toast" id="toast"></div>';
  }
  function renderMini() { var b = qs('#mbody', root); if (b) b.innerHTML = miniBody(); }
  function bindMini() {
    qs('#tab', root).addEventListener('click', function () { open('tab'); });
    qs('#mx', root).addEventListener('click', function () { close('x'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close('esc'); });
    qs('#mbody', root).addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-nav],[data-cid],[data-act]') : null; if (!t) return;
      if (t.getAttribute('data-nav')) { e.preventDefault(); e.stopPropagation(); var n = cfg.products.length; mIdx = (mIdx + parseInt(t.getAttribute('data-nav'), 10) + n) % n; renderMini(); return; }
      if (t.getAttribute('data-cid')) { e.preventDefault(); mSel[mIdx] = parseInt(t.getAttribute('data-cid'), 10); renderMini(); return; }
      if (t.getAttribute('data-act') === 'view') { track('click', { product_id: parseInt(t.getAttribute('data-pid'), 10) || cfg.products[mIdx].id }); markSeen(); }
    });
    // dokunmatik kaydırma: fotoğrafta sola/sağa → ürün değiştir
    var x0 = null, ph = qs('#mn', root);
    ph.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    ph.addEventListener('touchend', function (e) { if (x0 == null || cfg.products.length < 2) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { var n = cfg.products.length; mIdx = (mIdx + (dx < 0 ? 1 : -1) + n) % n; renderMini(); } });
  }

  /* ═══ yan panel: kulakçıktan yana büyür, tüm ürünler yan yana ═══ */
  function panelCd() {
    if (!cfg.ends_at || cfg.rules.timer_mode === 'off') return '';
    var ms = Math.max(0, remainMs() || 0), h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sec = Math.floor(ms % 60000 / 1000);
    return '<b>' + pad(h) + '</b>:<b>' + pad(m) + '</b>:<b>' + pad(sec) + '</b><small>' + esc(cfg.rules.timer_label || 'kaldı') + '</small>';
  }
  function panelCard(i) {
    var e = miniEntry(i); if (!e) return '';
    var p = e.p, sel = e.sel, r = cfg.rules, MAXS = 5;
    var hasD = sel.dprice != null && sel.dprice < sel.price, pct = hasD ? Math.round((sel.price - sel.dprice) / sel.price * 100) : 0;
    var sw = e.colors.length > 1 ? '<div class="pcl"><i></i>+' + (e.colors.length - 1) + ' renk</div>' : '';
    return '<div class="pc" data-i="' + i + '"><a class="pim" href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '"><img src="' + esc(sel.img) + '" alt="' + esc(p.name) + '" loading="eager">' +
      (hasD && r.show_discount_badge !== false ? '<span class="dc">-%' + pct + '</span>' : '') + (p.segment ? '<span class="sg">' + esc(p.segment) + '</span>' : '') + '</a>' +
      '<div class="pnm"><a href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '">' + esc(p.name) + '</a></div>' +
      '<div class="ppr">' + (hasD ? '<span class="op">' + money(sel.price) + '</span><span class="np">' + money(sel.dprice) + '</span>' : '<span class="np plain">' + money(sel.price) + '</span>') + '</div>' +
      (r.show_stock !== false && sel.stock > 0 && sel.stock <= (r.stock_threshold || 5) ? '<div class="pst">Son ' + sel.stock + ' adet</div>' : '') + sw +
      '<a class="pcta" href="' + esc(sel.url) + '" data-act="view" data-pid="' + sel.id + '">' + esc(r.view_text || 'Ürünü İncele') + ICON_ARROW + '</a></div>';
  }
  function panelHTML() {
    var r = cfg.rules, s = cfg.set || {}, t = cfg.theme;
    return '<aside class="pn" id="pn" role="dialog" aria-label="' + esc(s.title || r.title || 'Bugüne Özel') + '">' +
      '<div class="ps"><button type="button" class="px" id="px" aria-label="Kapat">×</button><span class="pl">' + esc(r.eyebrow || t.tab_text || 'BUGÜNE ÖZEL') + '</span>' +
      (cfg.ends_at && r.timer_mode !== 'off' ? '<span class="pt" id="ptm">' + tabTimer() + '</span>' : (t.tab_emoji ? '<span class="pe">' + esc(t.tab_emoji) + '</span>' : '')) + '</div>' +
      '<div class="pb"><div class="ph2"><div><h3>' + esc(s.title || r.title || 'Günün Fırsatları') + '</h3>' + (s.subtitle || r.subtitle ? '<p>' + esc(s.subtitle || r.subtitle) + '</p>' : '') + '</div><div class="pcd" id="pcd">' + panelCd() + '</div></div>' +
      '<div class="row" id="prow">' + (cfg.products.length ? cfg.products.map(function (_, i) { return panelCard(i); }).join('') : '<div class="empty">Bugün için ürün seçilmedi.</div>') + '</div></div></aside><div class="toast" id="toast"></div>';
  }
  function syncTabHeight() {
    var pn = qs('#pn', root), tb = qs('#tab', root); if (!pn || !tb) return;
    var h = pn.offsetHeight; if (h > 80) tb.style.height = h + 'px';
    placeWheelTab(h > 80 ? h : tb.offsetHeight);
  }
  // Aynı kenardaki çark kulakçığını (wheel.js) hero'nun hemen altına taşı; çark yoksa dokunma.
  function placeWheelTab(h) {
    var wt = qs('.ywheel-tab'); if (!wt || !h) return;
    var left = /^left/.test((cfg.theme && cfg.theme.tab_position) || ''), wl = wt.classList.contains('ywheel-tab-left');
    if (left !== wl) return; // farklı kenarlardaysa çakışma yok
    wt.style.top = 'calc(50% + ' + (Math.round(h / 2) + 8) + 'px)'; wt.style.transform = 'none';
  }
  function renderPanelCard(i) { var el = qs('.pc[data-i="' + i + '"]', root); if (!el) return; var tmp = document.createElement('div'); tmp.innerHTML = panelCard(i); el.replaceWith(tmp.firstChild); syncTabHeight(); }
  function bindPanel() {
    qs('#tab', root).addEventListener('click', function () { open('tab'); });
    qs('#px', root).addEventListener('click', function () { close('x'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close('esc'); });
    qs('#prow', root).addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-cid],[data-act]') : null; if (!t) return;
      var card = t.closest('.pc'), i = card ? parseInt(card.getAttribute('data-i'), 10) : 0;
      if (t.getAttribute('data-cid')) { e.preventDefault(); mSel[i] = parseInt(t.getAttribute('data-cid'), 10); renderPanelCard(i); return; }
      if (t.getAttribute('data-act') === 'view') { track('click', { product_id: parseInt(t.getAttribute('data-pid'), 10) || (cfg.products[i] && cfg.products[i].id) }); markSeen(); }
    });
    // dışarı tıklama kapatmaz (karartma yok). Hero kulakçığı DAİMA dikey ortalı (çark kulakçığı gibi);
    // aynı kenarda çark kulakçığı varsa hero'yu itmek yerine ÇARK hero'nun hemen altına yerleşir (v4).
    syncTabHeight(); setTimeout(syncTabHeight, 300); setTimeout(syncTabHeight, 1500); setTimeout(syncTabHeight, 4000);
    window.addEventListener('resize', syncTabHeight);
    try { new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) { var m = ms[i], n = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes)); for (var j = 0; j < n.length; j++) if (n[j].nodeType === 1 && n[j].classList && n[j].classList.contains('ywheel-tab')) { setTimeout(syncTabHeight, 50); return; } } }).observe(document.body, { childList: true }); } catch (e) {}
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncTabHeight);
  }

  function drawerHTML() {
    var r = cfg.rules, s = cfg.set || {}, t = cfg.theme;
    var sheet = isMobile() && r.mobile_sheet !== false;
    var items = (cfg.products || []).map(itemHTML).join('');
    var coupon = s.coupon ? '<div class="cp"><span class="k">' + esc(s.coupon) + '</span><span class="t">' + esc(s.coupon_text || 'Sepette bu kodu kullan') + '</span><button type="button" class="cb" id="cpbtn">Kopyala</button></div>' : '';
    var footer = '';
    if (r.footer_text && r.footer_url) footer = '<div class="ft"><a href="' + esc(r.footer_url) + '" data-act="footer">' + esc(r.footer_text) + ' →</a><a class="gc" href="' + esc(cfg.cart_url || '/checkout') + '" id="gocart" style="display:none">' + ICON_BAG + ' Sepete Git</a></div>';
    else footer = '<div class="ft" id="ftwrap" style="display:none"><span id="ftmsg"></span><a class="gc" href="' + esc(cfg.cart_url || '/checkout') + '" id="gocart">' + ICON_BAG + ' Sepete Git</a></div>';
    return '<div class="ov" id="ov"></div>' +
      '<aside class="dr' + (sheet ? ' sheet' : '') + '" id="dr" role="dialog" aria-modal="true" aria-label="' + esc(s.title || r.title || 'Bugüne Özel') + '">' +
      (sheet ? '<div class="grab"></div>' : '') +
      '<header class="hd"><button type="button" class="x" id="x" aria-label="Kapat">×</button>' +
      '<span class="eb"><span class="dot"></span>' + esc(r.eyebrow || 'BUGÜNE ÖZEL') + '</span>' +
      '<h2>' + esc(s.title || r.title || 'Günün Fırsatları') + '</h2>' +
      (s.subtitle || r.subtitle ? '<p>' + esc(s.subtitle || r.subtitle) + '</p>' : '') +
      '<div id="cdwrap">' + cdHTML() + '</div></header>' +
      coupon +
      '<div class="bd' + (t.card_layout === 'grid' ? ' grid' : '') + '" id="list">' + (items || '<div class="empty">Bugün için ürün seçilmedi.</div>') + '</div>' +
      footer + '</aside><div class="toast" id="toast"></div>';
  }

  function toast(msg) {
    var t = qs('#toast', root); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  /* ═══ aç / kapat ═══ */
  function open(source) {
    if (isOpen) return;
    isOpen = true; opened = true;
    clearTimeout(autoTm);
    if (isPanel()) {
      var pn = qs('#pn', root); if (!pn) return;
      pn.classList.add('on'); qs('#tab', root).classList.add('hide'); qs('#pcd', root).innerHTML = panelCd();
      markSeen(); track('open', { source: source || 'tab' }); dbg('open panel', source);
      return;
    }
    if (isMini()) {
      var mn = qs('#mn', root); if (!mn) return;
      mn.classList.add('on'); qs('#tab', root).classList.add('hide');
      markSeen(); track('open', { source: source || 'tab' }); dbg('open mini', source);
      return;
    }
    var dr = qs('#dr', root), ov = qs('#ov', root);
    if (!dr) return;
    // yerleşim değişmiş olabilir (yatay ↔ dikey): mobil sheet sınıfını güncelle
    dr.classList.toggle('sheet', isMobile() && cfg.rules.mobile_sheet !== false);
    qs('#cdwrap', root).innerHTML = cdHTML();
    ov.classList.add('on'); dr.classList.add('on');
    qs('#tab', root).classList.add('hide');
    try { document.documentElement.style.setProperty('--yh-ovf', document.body.style.overflow || ''); document.body.style.overflow = 'hidden'; } catch (e) { }
    markSeen();
    track('open', { source: source || 'tab' });
    dbg('open', source);
  }
  function close(reason) {
    if (!isOpen) return;
    isOpen = false;
    if (isPanel()) { qs('#pn', root).classList.remove('on'); qs('#tab', root).classList.remove('hide'); markSeen(); track('close', { source: reason || 'x' }); return; }
    if (isMini()) { qs('#mn', root).classList.remove('on'); qs('#tab', root).classList.remove('hide'); markSeen(); track('close', { source: reason || 'x' }); return; }
    qs('#ov', root).classList.remove('on'); qs('#dr', root).classList.remove('on');
    qs('#tab', root).classList.remove('hide');
    try { document.body.style.overflow = document.documentElement.style.getPropertyValue('--yh-ovf') || ''; } catch (e) { }
    markSeen();
    track('close', { source: reason || 'x' });
  }

  /* ═══ sepete ekle (Ticimax) ═══ */
  function refreshThemeCart() {
    try { if (window.cart && window.cart.get && typeof window.cart.get.cart === 'function') window.cart.get.cart(); } catch (e) { }
    try { if (window.cart && window.cart.init && typeof window.cart.init === 'function' && !window.cart.get) window.cart.init(); } catch (e) { }
    try { if (window.YunbiBottomBar && window.YunbiBottomBar.refresh) setTimeout(window.YunbiBottomBar.refresh, 600); } catch (e) { }
  }
  function addToCart(i, btn) {
    var p = cfg.products[i]; if (!p) return;
    var vid = null, label = '';
    if (p.variants.length === 1) { vid = p.variants[0].vid; label = p.variants[0].label; }
    else if (selected[i]) { vid = selected[i].vid; label = selected[i].label; }
    if (!vid) {
      var sz = qs('.sz[data-i="' + i + '"]', root);
      if (sz) { sz.classList.remove('shake'); void sz.offsetWidth; sz.classList.add('shake'); var lb = qs('.lbl', sz); if (lb) { lb.textContent = 'Önce beden seçin'; lb.className = 'lbl hint'; } }
      return;
    }
    btn.classList.add('busy');
    var pid = parseInt(p.pid, 10) || 0, vnum = parseInt(vid, 10) || 0;
    fetch('/api/cart/AddToCartV3', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ AsortiUrunKartId: 0, KampanyaId: 0, BagliUrunId: 0, UrunKartId: pid, UrunId: vnum, Adet: 1, UrunNot: '', AssortmentQuantities: [] })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      btn.classList.remove('busy');
      if (!j || j.isError) { dbg('atc fail', j); track('error', { value: 'atc: ' + (j && (j.message || j.errorMessage) || 'http'), product_id: p.id }); location.href = p.url; return; }
      btn.classList.add('ok'); btn.innerHTML = ICON_CHECK + 'Sepete eklendi';
      track('atc', { product_id: p.id, value: label });
      refreshThemeCart();
      var ft = qs('#ftwrap', root), gc = qs('#gocart', root), msg = qs('#ftmsg', root);
      if (ft) { ft.style.display = ''; if (msg) msg.textContent = (label ? label + ' beden ' : '') + 'sepetinize eklendi.'; }
      if (gc) gc.style.display = '';
      toast('Sepete eklendi' + (label ? ' · ' + label : ''));
    }).catch(function (e) { btn.classList.remove('busy'); track('error', { value: 'atc: ' + (e && e.message), product_id: p.id }); location.href = p.url; });
  }

  /* ═══ bağla ═══ */
  function bind() {
    qs('#tab', root).addEventListener('click', function () { open('tab'); });
    qs('#ov', root).addEventListener('click', function () { close('overlay'); });
    qs('#x', root).addEventListener('click', function () { close('x'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close('esc'); });
    var list = qs('#list', root);
    list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button,a') : null; if (!b) return;
      var i = parseInt(b.getAttribute('data-i') || (b.parentNode && b.parentNode.getAttribute && b.parentNode.getAttribute('data-i')), 10);
      if (b.classList.contains('more')) { e.preventDefault(); qsa('.sz[data-i="' + i + '"] button.hid', root).forEach(function (x) { x.style.display = ''; x.classList.remove('hid'); }); b.style.display = 'none'; return; }
      if (b.getAttribute('data-vid')) {
        e.preventDefault();
        var sz = b.parentNode; qsa('button', sz).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
        selected[i] = { vid: b.getAttribute('data-vid'), label: b.getAttribute('data-label') };
        var lb = qs('.lbl', sz); if (lb) { lb.textContent = 'Beden: ' + b.getAttribute('data-label'); lb.className = 'lbl'; }
        return;
      }
      var act = b.getAttribute('data-act');
      if (act === 'atc') { e.preventDefault(); addToCart(i, b); return; }
      if (act === 'view') { var p = cfg.products[i]; if (p) track('click', { product_id: p.id }); markSeen(); }
    });
    var cp = qs('#cpbtn', root);
    if (cp) cp.addEventListener('click', function () {
      var code = cfg.set.coupon;
      var done = function () { cp.textContent = 'Kopyalandı ✓'; cp.classList.add('ok'); track('coupon', { value: code }); toast('Kupon kodu kopyalandı: ' + code); };
      try { navigator.clipboard.writeText(code).then(done, done); } catch (e) { done(); }
    });
    qs('.ft a[data-act="footer"]', root) && qs('.ft a[data-act="footer"]', root).addEventListener('click', function () { track('click', { value: 'footer' }); });
    // sheet: aşağı kaydırarak kapat (üst tutamaçtan)
    var dr = qs('#dr', root), y0 = null;
    dr.addEventListener('touchstart', function (e) { if (!dr.classList.contains('sheet')) return; var hd = qs('.hd', root); y0 = hd.contains(e.target) ? e.touches[0].clientY : null; }, { passive: true });
    dr.addEventListener('touchmove', function (e) { if (y0 == null) return; var dy = e.touches[0].clientY - y0; if (dy > 0) dr.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
    dr.addEventListener('touchend', function (e) { if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; dr.style.transform = ''; if (dy > 90) close('swipe'); y0 = null; });
    window.addEventListener('resize', function () { var tb = qs('#tab', root); if (tb) tb.classList.toggle('withbar', !!qs('#yunbi-bottombar') && isMobile()); });
  }

  /* ═══ otomatik açılma tetikleri ═══ */
  function armAutoOpen() {
    var r = cfg.rules;
    if (AUTO_OPEN_NOW) { setTimeout(function () { open('api'); }, 350); return; }
    if (r.auto_open === false || wasSeen() || !(cfg.products || []).length) { dbg('auto-open yok', { seen: wasSeen() }); return; }
    if (!FORCE_RULES && (r.no_auto_page_types || []).indexOf(pageType()) >= 0) { dbg('bu sayfa tipinde otomatik açılma yok', pageType()); return; }
    var fire = function (src) { if (!isOpen && !opened && !wasSeen()) open(src); };
    var delay = Math.max(3, parseInt(r.auto_open_delay, 10) || 12) * 1000;
    // gecikme yalnız sekme görünürken işler
    var elapsed = 0, last = Date.now();
    var loop = function () {
      if (!document.hidden) elapsed += Date.now() - last;
      last = Date.now();
      if (elapsed >= delay) { fire('auto'); return; }
      autoTm = setTimeout(loop, 500);
    };
    autoTm = setTimeout(loop, 500);
    if (r.auto_open_scroll > 0) {
      var onScroll = function () {
        var h = document.documentElement.scrollHeight - window.innerHeight; if (h <= 0) return;
        if (window.scrollY / h * 100 >= r.auto_open_scroll) { window.removeEventListener('scroll', onScroll); fire('scroll'); }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    if (r.exit_intent !== false && !isMobile() && !('ontouchstart' in window)) {
      var onLeave = function (e) { if (e.clientY <= 0 && !e.relatedTarget) { document.removeEventListener('mouseout', onLeave); fire('exit'); } };
      setTimeout(function () { document.addEventListener('mouseout', onLeave); }, 3000);
    }
  }

  function mount() {
    var target = MOUNT_SEL ? qs(MOUNT_SEL) : document.body;
    if (!target) return false;
    host = document.createElement('div');
    host.id = 'yunbi-hero';
    host.style.cssText = 'display:block;position:static;width:0;height:0';
    target.appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style'); st.textContent = css(cfg.theme); root.appendChild(st);
    var wrap = document.createElement('div'); wrap.innerHTML = tabHTML() + (isPanel() ? panelHTML() : isMini() ? miniHTML() : drawerHTML());
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
    if (MOUNT_SEL) { ['#tab', '#ov', '#dr', '#mn', '#pn', '#toast'].forEach(function (s) { var el = qs(s, root); if (el) el.style.position = 'absolute'; }); }
    return true;
  }

  function start() {
    fetch(API + '/config', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (c) {
      cfg = c || {}; cfg.rules = cfg.rules || {}; cfg.theme = cfg.theme || {};
      if (FORCE_THEME) cfg.theme = Object.assign({}, cfg.theme, FORCE_THEME);
      if (FORCE_RULES) cfg.rules = Object.assign({}, cfg.rules, FORCE_RULES);
      if (cfg.now) clockOffset = cfg.now - Date.now();
      if (!cfg.set || !(cfg.products || []).length) { dbg('bugün için set/ürün yok'); if (!FORCE) return; }
      if (shouldHide()) { dbg('bu sayfada gizli'); return; }
      // Ürün sayfası: bu ürünün kendi sayfasındaysa otomatik açılma anlamsız (kulakçık kalır)
      if (!mount()) return;
      if (isPanel()) bindPanel(); else if (isMini()) bindMini(); else bind();
      tickTm = setInterval(tick, 1000);
      track('view');
      armAutoOpen();
      window.YunbiHero = { open: function () { open('api'); }, close: close, version: VERSION, config: function () { return cfg; } };
    }).catch(function (e) { dbg('config error', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
