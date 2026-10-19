// İade listesinin "kaldığı yer" durumu (oturum içi): detaydan dönüşte aynı ekran/filtre/sayfa/kaydırma.
export const RETURNS_LIST_KEY = 'yunbi:returns:list'
export const RETURNS_SCROLL_KEY = 'yunbi:returns:scroll'

/** Detaydan listeye dönüş adresi: en son açık olan liste görünümü (filtreler + sayfa dahil). */
export function returnsListPath(): string {
  try {
    const s = sessionStorage.getItem(RETURNS_LIST_KEY)
    if (s && s.startsWith('?')) return `/returns${s}`
  } catch { /* yoksay */ }
  return '/returns'
}
