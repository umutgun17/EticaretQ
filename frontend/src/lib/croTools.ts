import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  PanelBottom,
  Ghost,
  BadgePercent,
  Ruler,
  Images,
  Truck,
  ShoppingBasket,
  Gift,
  Smartphone,
  Disc3,
  Zap,
  Flame,
  BellRing,
  Sparkles,
  FolderTree,
  Rotate3d,
  Shirt,
  ShoppingCart,
  PartyPopper,
  Store,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* CRO "Site Araçları" kataloğu — menü (ProductNav) ve /cro/tools sayfası aynı listeyi kullanır.
   Araçlar müşterinin alışveriş yolculuğuna göre gruplanır; her aracın kendi ayar sayfası değişmedi.
   Çark/kargo/duyuru/kategori sayfaları backend'de hâlâ 'marketing' yetkisiyle açılır. */

export interface CroTool {
  key: string // /cro/tools/status anahtarı
  shotPos?: string // kart küçük görselinde ekran görüntüsünün hangi kısmı görünsün (CSS object-position)
  to: string
  icon: LucideIcon
  label: string
  desc: string
  prefixes: string[] // bu araca ait alt sayfalar (menüde "Site Araçları" aktif kalır)
  links?: { to: string; label: string }[]
  hasStatus: boolean
  shotWide?: boolean // ekran görüntüsü panel sayfasından (yatay); diğerleri telefon görünümü
  noShot?: boolean // demo verisiyle anlamlı görüntü yok → ⓘ yalnız açıklama gösterir
  show: boolean
}

export interface CroToolGroup {
  key: string
  title: string
  navTitle: string // sol menüdeki kısa ad
  icon: LucideIcon
  desc: string
  tools: CroTool[]
}

export function useCroToolGroups(): CroToolGroup[] {
  const { t } = useTranslation()
  const { user, hasPermission } = useAuth()
  const su = !!user?.is_super_admin
  const cro = hasPermission('cro')
  const mkt = hasPermission('marketing')

  const groups: CroToolGroup[] = [
    {
      key: 'find',
      title: 'Aradığını bulsun',
      navTitle: 'Ürünü bulma',
      icon: Search,
      desc: 'Arama, filtre ve menü: müşteri ürüne en kısa yoldan ulaşır.',
      tools: [
        { key: 'search', shotPos: 'top', to: '/search-insights', icon: Search, label: t('nav.smartSearch'), desc: 'Yazarken ürün öneren arama kutusu ve arama raporları.', prefixes: ['/search-insights'], hasStatus: true, show: cro },
        { key: 'filter', shotPos: '50% 45%', to: '/cro/filter', icon: SlidersHorizontal, label: t('nav.croFilter'), desc: 'Kategori sayfasında renk, beden, fiyat filtreleri.', prefixes: ['/cro/filter'], hasStatus: true, show: cro },
        { key: 'menu', shotPos: 'top', to: '/cro/menu', icon: LayoutGrid, label: t('nav.croMenu'), desc: 'Mobil menüyü ürün görselli kartlara çevirir.', prefixes: ['/cro/menu'], hasStatus: true, show: cro },
        { key: 'bottombar', shotPos: 'bottom', to: '/cro/bottombar', icon: PanelBottom, label: t('nav.croBottomBar'), desc: 'Mobilde ekranın altında sabit gezinme çubuğu.', prefixes: ['/cro/bottombar'], hasStatus: true, show: cro },
        { key: 'notfound', shotPos: 'top', to: '/cro/notfound', icon: Ghost, label: t('nav.croNotFound'), desc: 'Kırık linkte "Bunu mu arıyordunuz?" ürünleri.', prefixes: ['/cro/notfound'], hasStatus: true, show: cro },
      ],
    },
    {
      key: 'product',
      title: 'Ürün sayfasında ikna etsin',
      navTitle: 'Ürün sayfası',
      icon: Shirt,
      desc: 'Rozet, galeri, beden seçimi ve kargo bilgisiyle güven verir.',
      tools: [
        { key: 'badges', shotPos: '50% 20%', to: '/cro/badges', icon: BadgePercent, label: t('nav.croBadges'), desc: 'Çok satan, son adet, kampanya rozetleri.', prefixes: ['/cro/badges'], hasStatus: true, show: cro },
        { key: 'variant', shotPos: 'top', to: '/cro/variant', icon: Ruler, label: t('nav.croVariant'), desc: 'Beden ve renk seçimini kolaylaştıran panel.', prefixes: ['/cro/variant'], hasStatus: true, noShot: true, show: cro },
        { key: 'gallery', shotPos: 'top', to: '/cro/gallery', icon: Images, label: t('nav.croGallery'), desc: 'Büyük görseller ve tam ekran yakınlaştırma.', prefixes: ['/cro/gallery'], hasStatus: true, show: cro },
        { key: 'shipping', shotPos: 'top', to: '/shipping-widget', icon: Truck, label: t('nav.shippingWidget'), desc: '"Şimdi alırsan bugün kargoda" sayacı.', prefixes: ['/shipping-widget'], hasStatus: true, show: mkt },
      ],
    },
    {
      key: 'cart',
      title: 'Sepeti büyütsün, satın aldırsın',
      navTitle: 'Sepet ve satın alma',
      icon: ShoppingCart,
      desc: 'Sepette kademeli kampanya, ilk alışveriş ve uygulama indirimleri.',
      tools: [
        { key: 'cart', shotPos: 'top', to: '/cro/cart', icon: ShoppingBasket, label: t('nav.croCart'), desc: '"Ücretsiz kargo için 300 TL daha" çubuğu ve sepet önerileri.', prefixes: ['/cro/cart'], hasStatus: true, show: cro },
        { key: 'welcome', shotPos: 'bottom', to: '/cro/welcome', icon: Gift, label: t('nav.croWelcome'), desc: 'İlk kez gelen ziyaretçiye indirim kodu kartı.', prefixes: ['/cro/welcome'], hasStatus: true, show: cro },
        { key: 'app', shotPos: 'bottom', to: '/cro/app', icon: Smartphone, label: t('nav.croAppPromo'), desc: 'Uygulamayı indirene özel indirim kodu.', prefixes: ['/cro/app'], hasStatus: true, show: cro },
      ],
    },
    {
      key: 'campaign',
      title: 'Kampanya ve oyunlar',
      navTitle: 'Kampanya ve oyunlar',
      icon: PartyPopper,
      desc: 'Çark, kazı kazan, flaş indirim ve duyurularla ilgi çeker.',
      tools: [
        { key: 'wheel', shotPos: '50% 35%', to: '/wheel', icon: Disc3, label: t('nav.wheel'), desc: 'Şans çarkı, kazı kazan ve A/B testi.', prefixes: ['/wheel'], hasStatus: true, show: mkt },
        { key: 'flash', shotPos: 'top', to: '/cro/flash', icon: Zap, label: t('nav.croFlash'), desc: 'Ana sayfada süreli flaş indirim bölümü.', prefixes: ['/cro/flash'], hasStatus: true, show: cro },
        { key: 'hero', shotPos: '50% 45%', to: '/cro/hero', icon: Flame, label: t('nav.croHero'), desc: 'Kenarda günün öne çıkan ürünleri kulakçığı.', prefixes: ['/cro/hero'], hasStatus: true, show: cro },
        { key: 'announce', shotPos: 'top', to: '/announce-widget', icon: BellRing, label: 'Duyuru Bandı', desc: 'Üst duyuru bandı, kayan yazı ve güven rozetleri.', prefixes: ['/announce-widget'], hasStatus: true, show: mkt },
      ],
    },
    {
      key: 'personal',
      title: 'Kişisel öneri',
      navTitle: 'Kişisel öneri',
      icon: Sparkles,
      desc: 'Ziyaretçiye gezdiği ürünlere göre öneri sunar.',
      tools: [
        { key: 'foryou', shotPos: 'top', to: '/cro/foryou', icon: Sparkles, label: t('nav.croForYou'), desc: 'Gezdikçe kişiselleşen öneri kulakçığı.', prefixes: ['/cro/foryou'], hasStatus: true, show: cro },
      ],
    },
    {
      key: 'merch',
      title: 'Vitrin düzeni',
      navTitle: 'Vitrin düzeni',
      icon: Store,
      desc: 'Kategorilerde hangi ürün önde dursun.',
      tools: [
        { key: 'category', shotPos: 'top', to: '/category-intelligence', icon: FolderTree, label: t('nav.categoryIntelligence'), desc: 'Kategori denetimi ve akıllı ürün sıralaması.', prefixes: ['/category-intelligence'], hasStatus: true, shotWide: true, show: mkt },
        { key: 'product360', shotPos: 'top', to: '/product-360/demo', icon: Rotate3d, label: t('nav.product360'), desc: 'Ürünü 360° döndürerek gösterme (demo).', prefixes: ['/product-360'], hasStatus: false, noShot: true, show: su },
      ],
    },
  ]

  return groups
    .map((g) => ({ ...g, tools: g.tools.filter((x) => x.show) }))
    .filter((g) => g.tools.length > 0)
}

/** Yoldaki sayfa hangi kategoriye ait (menüde o kategori aktif görünür). */
export function findCroGroup(groups: CroToolGroup[], path: string): CroToolGroup | undefined {
  return groups.find((g) => g.tools.some((tool) => tool.prefixes.some((p) => path === p || path.startsWith(p + '/'))))
}

/** Yoldaki sayfa hangi araca ait (menüde "Site Araçları" altında gösterilir). */
export function findCroTool(groups: CroToolGroup[], path: string): CroTool | undefined {
  for (const g of groups) {
    for (const tool of g.tools) {
      if (tool.prefixes.some((p) => path === p || path.startsWith(p + '/'))) return tool
    }
  }
  return undefined
}

export const croToolsApi = {
  status: async () => (await api.get<{ status: Record<string, boolean> }>('/cro/tools/status')).data.status,
}
