import { chromium } from 'playwright';
const S=process.env.S||".", T='sa-test-magaza', H='https://eticaretq.com/widget/';
const mock = (script, body='') => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fff}header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eee;font-weight:800;letter-spacing:2px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px}.g div{aspect-ratio:3/4;background:#f1f2f4;border-radius:8px}.hero{margin:12px;height:150px;border-radius:12px;background:#e9e6e1}</style></head>
<body><header>MAĞAZANIZ<span>☰</span></header><div class="hero"></div><div class="g"><div></div><div></div><div></div><div></div></div>${body}${script}</body></html>`;
const cfg = {
  app:      { u:`app-demo.html?tenant=${T}&open=1&note=0` },
  hero:     { u:`hero-demo.html?tenant=${T}&note=0` },
  menu:     { u:`menu-demo.html?tenant=${T}&open=1` },
  filter:   { u:`filter-demo.html?tenant=${T}&path=/kategori/cilt-bakimi&template=drawer` },
  flash:    { u:`flash-demo.html?tenant=${T}&note=0&ctl=0`, flash: true },
  cart:     { u:`cart-demo.html?tenant=${T}` },
  badge:    { u:`badge-demo.html?tenant=${T}` },
  bottombar:{ u:`bottombar-demo.html?tenant=${T}&cart=2&active=home` },
  announce: { u:`announce-demo.html?tenant=${T}` },
  notfound: { u:`notfound-demo.html?tenant=${T}` },
  gallery:  { u:`gallery-demo.html?tenant=${T}` },
  shipping: { u:`shipping-test.html?tenant=${T}` },
  search:   { u:`search-demo.html?tenant=${T}`, act: async p => { await p.evaluate(()=>window.YunbiSearch && window.YunbiSearch.open('serum')); } },
  wheel:    { u:`__shot.html`, html: mock(`<script src="${H}wheel.js" data-tenant="${T}" data-campaign="lumea-sans-carki"></script>`), wait: 15000 },
  foryou:   { u:`__shot.html`, html: mock(`<script src="${H}foryou.js" data-tenant="${T}"></script>`), act: async p => { await p.locator('.tab').first().click({timeout:8000}); } },
  welcome:  { u:`__shot.html?yunbi_welcome=1`, html: mock(`<script src="${H}welcome.js" data-tenant="${T}"></script>`), wait: 5000 },
};
const only=(process.env.ONLY||Object.keys(cfg).join(',')).split(',');
const b=await chromium.launch();
for (const k of only) {
  const c=cfg[k]; const ctx=await b.newContext({viewport:{width:390,height:780},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,100)));
  if (c.flash) await p.route(/\/flash\/config/, async r => {
    const cfg = await (await r.fetch()).json();
    const sr = await (await fetch('https://eticaretq.com/w/sa-test-magaza/search?q=bak%C4%B1m', {headers:{Origin:'https://eticaretq.com'}})).json();
    cfg.products = (sr.results||[]).slice(0,8).map((x,i)=>{ const pr=+x.price, d=+(x.discounted_price||x.price); return { id:String(x.id), pid:String(x.id), name:x.name, url:x.url, price:pr, dprice:d<pr?d:null, discount_pct:d<pr?Math.round((1-d/pr)*100):0, img:x.image, imgs:x.images||[x.image], stock:20-i, sold:40+i*7, segment:'', variants:[], auto:false, first:i===0 }; });
    cfg.set = { id:'demo', title:'Bu Geceye Özel Fiyatlar', eyebrow:'Flaş İndirim', subtitle:'Seçili ürünlerde gece yarısına kadar' };
    await r.fulfill({status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body: JSON.stringify(cfg)});
  });
  if (c.html) await p.route(/__shot\.html/, r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:c.html}));
  try { await p.goto(H+c.u,{waitUntil:'networkidle',timeout:30000}); } catch(e){ errs.push('goto'); }
  await p.waitForTimeout(c.wait||2500); if (c.act) { try { await c.act(p) } catch(e){ errs.push('act '+e.message.slice(0,80)) } await p.waitForTimeout(c.wait2||2500); }
  await p.screenshot({path:`${S}/eshots/${k}.png`}); console.log(k, JSON.stringify(errs)); await ctx.close();
}
await b.close();
