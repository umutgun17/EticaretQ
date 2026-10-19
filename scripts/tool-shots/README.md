# CRO araç ekran görüntüleri (ⓘ ikonu)

Site Araçları kartlarındaki ve menüdeki ⓘ, `frontend/public/tool-shots/{key}.webp` görselini gösterir
(`key` = `frontend/src/lib/croTools.ts` araç anahtarı; `noShot: true` olanlarda yalnız açıklama çıkar).

Yenileme: `S=<klasör> node store-shots.mjs` (Playwright; `ONLY=menu,hero` ile seçmeli). Veri: demo mağaza `sa-test-magaza` (Luméa).
Flaş vitrinde demo set olmadığından config yanıtı yalnız ekran görüntüsünde Luméa ürünleriyle doldurulur (DB'ye yazılmaz).
PNG → WebP: `convert x.png -resize 440x -quality 78 x.webp` (panel görüntüsü 640px); `badge→badges`. Ardından `cd frontend && npm run build`.
Başka markanın (Tonny/Boise/Yunbi) görseli KULLANILMAZ.
