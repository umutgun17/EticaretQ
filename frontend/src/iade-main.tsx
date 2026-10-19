/**
 * PUBLIC İADE — ayrı, hafif giriş noktası (2026-07-30).
 *
 * Müşteri iade sayfası (hub.yunbi.ai/iade/{slug}, mağaza sitesine iframe ile gömülü)
 * önceden TÜM hub SPA'sını (~1.7 MB JS: admin panel, analytics, CRM...) yüklüyordu;
 * mobil Safari'de tema + widget'larla birleşince bellek yüzünden sayfa çöküyordu
 * ("birçok kez sorun oluştu"). Bu entry yalnız PublicReturnPage ve bağımlılıklarını içerir.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import PublicReturnPage from '@/pages/returns/PublicReturnPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/iade/:slug" element={<PublicReturnPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
