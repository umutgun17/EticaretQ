import { Fragment } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { crmBrand } from '@/lib/tenant'
import {
  Activity,
  LayoutDashboard,
  PackageCheck,
  PackageX,
  Undo2,
  MessagesSquare,
  Rocket,
  Settings,
  RotateCcw,
  MessageSquareText,
  FileBarChart2,
  Star,
  Scale,
  BarChart3,
  Package,
  Sparkles,
  Zap,
  Users2,
  Send,
  Settings2,
  BellRing,
  AlarmClock,
  Users,
  UserRound,
  Building2,
  Store,
  UserCheck,
  ShoppingBag,
  Heart,
  ShieldCheck,
  Gauge,
  LayoutGrid,
  X,
  CreditCard,
} from 'lucide-react'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import BrandMark from '@/components/saas/BrandMark'
import { BRAND } from '@/lib/brand'
import { findCroGroup, findCroTool, useCroToolGroups, type CroTool } from '@/lib/croTools'
import ToolInfo from '@/components/cro/ToolInfo'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
  show: boolean
  active?: boolean // tanımlıysa NavLink eşleşmesi yerine bu kullanılır (ör. /cro/tools#kategori bağlantıları)
  sub?: boolean // bir üst öğenin altında girintili gösterilir
  tool?: CroTool // CRO aracı: yanında ⓘ (ekran görüntüsü) gösterilir
}

interface NavGroup {
  title?: string
  items: NavItem[]
}

interface Product {
  key: string
  label: string
  kicker?: string // ürün adının üst satırı; varsayılan "Yunbi" (CRM'de "Ticimax")
  icon: LucideIcon
  chip: string // panel başlığındaki renkli ikon çipi (Base SaaS stili)
  subscription?: string // abonelik kontrolünde kullanılacak ürün anahtarı (store → comments)
  alsoFor?: string[] // bu ürünlerden birine sahip tenant da görür (CRO: eski Pazarlama widget'ları)
  prefixes: string[]
  groups: NavGroup[]
}

export function useProducts(): Product[] {
  const { t } = useTranslation()
  const { user, hasPermission, hasProduct } = useAuth()
  const su = !!user?.is_super_admin
  const loc = useLocation()
  const path = loc.pathname
  const croGroups = useCroToolGroups()
  const croTool = findCroTool(croGroups, path)
  const croGroup = findCroGroup(croGroups, path)
  const onTools = path === '/cro/tools'
  const croToolPrefixes = croGroups.flatMap((g) => g.tools.flatMap((x) => x.prefixes))

  const products: Product[] = [
    {
      key: 'overview',
      label: t('products.overview'),
      icon: LayoutDashboard,
      chip: 'bg-indigo-100 text-indigo-600',
      prefixes: ['/'],
      groups: [
        {
          items: [
            { to: '/', icon: LayoutDashboard, label: t('nav.dashboard'), end: true, show: true },
          ],
        },
      ],
    },
    {
      key: 'return',
      label: t('products.return'),
      icon: PackageCheck,
      chip: 'bg-amber-100 text-amber-600',
      prefixes: ['/returns', '/reports/returns'],
      groups: [
        {
          title: t('nav.managementGroup'),
          items: [
            { to: '/returns', icon: RotateCcw, label: t('nav.returnsRequests'), end: true, show: hasPermission('returns') },
            // Personel kaynaklı iade: depo siparişi çıkaramıyor (eksik/hatalı/stok hatası) → para iadesi
            { to: '/returns/shortage', icon: PackageX, label: t('nav.returnsShortage'), show: hasPermission('returns_shortage') },
            // Firmadan çıkıp teslim edilemeyen, depoya geri dönen siparişler → bildirimsiz para iadesi
            { to: '/returns/returned', icon: Undo2, label: t('nav.returnsReturned'), show: hasPermission('returns_returned') },
            { to: '/returns/sms', icon: MessageSquareText, label: t('nav.returnsSms'), show: hasPermission('returns') },
          ],
        },
        {
          title: t('nav.analysisGroup'),
          items: [
            { to: '/returns/insights', icon: FileBarChart2, label: t('nav.returnsInsights'), show: hasPermission('returns') },
            { to: '/reports/returns', icon: BarChart3, label: t('nav.returnCancel'), show: hasPermission('reports') },
          ],
        },
        // Genel Ayarlar'dan taşınan iade kuralları + entegrasyonları (ürün-bazlı ayar)
        {
          title: t('products.settings'),
          items: [
            { to: '/returns/settings', icon: Settings2, label: t('nav.returnsSettings'), show: hasPermission('settings') },
          ],
        },
      ],
    },
    {
      key: 'comments',
      label: t('products.comments'),
      icon: MessagesSquare,
      chip: 'bg-rose-100 text-rose-500',
      prefixes: ['/crm/reviews', '/crm/price-comparison', '/settings/review-widget'],
      groups: [
        {
          title: t('nav.managementGroup'),
          items: [
            { to: '/crm/reviews', icon: Star, label: t('nav.reviews'), show: hasPermission('crm') },
            { to: '/crm/price-comparison', icon: Scale, label: t('nav.priceComparison'), show: hasPermission('crm') },
          ],
        },
        {
          title: t('products.settings'),
          items: [
            { to: '/settings/review-widget', icon: Settings2, label: t('nav.trendyolReview'), show: hasPermission('settings') },
          ],
        },
      ],
    },
    {
      // Ticimax CRM — kendi ürün anahtarı 'store' ile tenant'a ayrıca atanır (sayfa yetkisi 'crm' ortak)
      key: 'store',
      label: t('products.store'),
      kicker: crmBrand(user),
      icon: Store,
      chip: 'bg-emerald-100 text-emerald-600',
      prefixes: ['/crm'],
      groups: [
        {
          title: t('nav.managementGroup'),
          items: [
            { to: '/crm/products', icon: Package, label: t('nav.products'), show: hasPermission('crm') },
            { to: '/crm/customers', icon: UserCheck, label: t('nav.members'), show: hasPermission('crm') },
            { to: '/crm/orders', icon: ShoppingBag, label: t('nav.orders'), show: hasPermission('crm') },
            { to: '/crm/delays', icon: AlarmClock, label: 'Gecikmeler', show: hasPermission('crm_delays') },
            { to: '/crm/favorites', icon: Heart, label: t('nav.favorites'), show: hasPermission('crm') },
            { to: '/crm/stock-alerts', icon: BellRing, label: 'Gelince Haber Ver', show: hasPermission('crm') },
          ],
        },
      ],
    },
    {
      // Pazarlama = müşteriye giden mesajlar: WhatsApp / SMS / e-posta toplu gönderim, otomasyonlar, raporlar, İYS.
      // Site widget'ları (oyun, kargo, duyuru, kategori zekâsı, 360) CRO > Site Araçları'nda.
      key: 'marketing',
      label: t('products.marketing'),
      icon: Rocket,
      chip: 'bg-emerald-100 text-emerald-600',
      prefixes: ['/marketing'],
      groups: [
        {
          items: [
            { to: '/marketing', icon: Sparkles, label: t('nav.marketingOverview'), end: true, show: hasPermission('marketing') },
          ],
        },
        {
          title: t('nav.marketingSendGroup'),
          items: [
            { to: '/marketing/campaigns', icon: Send, label: t('nav.marketingCampaigns'), show: hasPermission('marketing') },
            { to: '/marketing/automations', icon: Zap, label: t('nav.automations'), show: hasPermission('marketing') },
          ],
        },
        {
          title: t('nav.marketingAudienceGroup'),
          items: [
            { to: '/marketing/segments', icon: Users2, label: t('nav.segments'), show: hasPermission('marketing') },
            { to: '/marketing/iys', icon: ShieldCheck, label: t('nav.iys'), show: hasPermission('marketing') },
          ],
        },
        {
          title: t('nav.marketingReportGroup'),
          items: [
            { to: '/marketing/analytics', icon: BarChart3, label: t('nav.marketingAnalytics'), show: hasPermission('marketing') },
          ],
        },
        {
          title: t('products.settings'),
          items: [
            { to: '/marketing/settings', icon: Settings2, label: t('nav.marketingSettings'), show: hasPermission('marketing') },
          ],
        },
      ],
    },
    {
      // CRO — sade menü: Özet · Site Araçları (tüm widget'lar tek katalog sayfasında, /cro/tools) · Denetim · Aksiyon Planı.
      // Bir araç sayfasındayken menüde Site Araçları altında o araç girintili görünür (yanında ⓘ).
      key: 'cro',
      label: t('products.cro'),
      icon: Gauge,
      chip: 'bg-orange-100 text-orange-600',
      alsoFor: ['marketing'],
      prefixes: ['/cro', ...croToolPrefixes],
      groups: [
        {
          items: [
            { to: '/cro', icon: Gauge, label: t('nav.croOverview'), end: true, show: hasPermission('cro') },
          ],
        },
        // Site Araçları: kategori bağlantıları /cro/tools sayfasındaki ilgili bölüme kaydırır; araç sayfasındayken
        // kategorisi aktif görünür ve araç altında girintili durur (yanında ⓘ)
        {
          title: t('nav.croTools'),
          items: [
            {
              to: '/cro/tools', icon: LayoutGrid, label: t('nav.croToolsAll'), active: onTools && !loc.hash,
              show: hasPermission('cro') || hasPermission('marketing'),
            },
            ...croGroups.flatMap((g) => [
              {
                to: `/cro/tools#${g.key}`, icon: g.icon, label: g.navTitle,
                active: (onTools && loc.hash === `#${g.key}`) || croGroup?.key === g.key, show: true,
              },
              ...(croTool && croGroup?.key === g.key
                ? [{ to: croTool.to, icon: croTool.icon, label: croTool.label, sub: true, active: true, show: true, tool: croTool }]
                : []),
            ]),
          ],
        },
      ],
    },
    {
      key: 'settings',
      label: t('products.settings'),
      icon: Settings,
      chip: 'bg-gray-200 text-gray-600',
      prefixes: ['/settings', '/admin', '/profile', '/billing'],
      groups: [
        {
          title: t('nav.accountGroup'),
          items: [
            { to: '/profile', icon: UserRound, label: t('nav.myProfile'), show: true },
          ],
        },
        {
          title: t('nav.platformGroup'),
          items: [
            { to: '/settings/general', icon: Settings, label: t('nav.general'), show: hasPermission('settings') },
            { to: '/settings/users', icon: Users, label: t('nav.users'), show: hasPermission('settings') },
            { to: '/settings/users/activity', icon: Activity, label: t('nav.userActivity'), show: hasPermission('settings') && !!user?.is_admin },
            { to: '/billing', icon: CreditCard, label: t('nav.billing'), show: !!user?.is_owner || !!user?.is_admin || su },
          ],
        },
        {
          title: t('superAdmin'),
          items: [
            { to: '/admin/tenants', icon: Building2, label: t('nav.tenants'), show: su },
            { to: '/admin/subscriptions', icon: CreditCard, label: t('nav.subscriptions'), show: su },
          ],
        },
      ],
    },
  ]

  // Tenant ürün aboneliği: 7 üründen yalnızca sahip olunanlar görünür
  const subscribed = products.filter(
    (p) => p.key === 'overview' || p.key === 'settings' || hasProduct(p.subscription ?? p.key) || !!p.alsoFor?.some(hasProduct)
  )

  // Görünür öğesi olmayan ürünler ray'de gizlenir
  return subscribed
    .map((p) => ({
      ...p,
      groups: p.groups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((p) => p.groups.length > 0)
}

export function useActiveProduct(products: Product[]): Product | undefined {
  const location = useLocation()
  const path = location.pathname
  // Tanım sırası önemli: comments '/crm/reviews'u store'dan, review-widget'ı settings'ten önce yakalar
  return products.find((p) =>
    p.prefixes.some((prefix) => (prefix === '/' ? path === '/' : path.startsWith(prefix)))
  )
}

// 'store' (Ticimax CRM) bilinçli olarak üst listede değil: alt bölümde Ayarlar'ın hemen üstünde durur
const RAIL_TOP_KEYS = ['overview', 'return', 'comments', 'marketing', 'cro']

interface ProductNavProps {
  mobileOpen: boolean
  onClose: () => void
}

export default function ProductNav({ mobileOpen, onClose }: ProductNavProps) {
  const navigate = useNavigate()
  const products = useProducts()
  const active = useActiveProduct(products)
  const topProducts = RAIL_TOP_KEYS.map((k) => products.find((p) => p.key === k)).filter(Boolean) as Product[]
  const bottomProducts = products.filter((p) => !RAIL_TOP_KEYS.includes(p.key))

  const openProduct = (p: Product) => {
    const first = p.groups[0]?.items[0]
    if (first) navigate(first.to)
  }

  const railButton = (p: Product) => {
    const isActive = active?.key === p.key
    return (
      <button
        key={p.key}
        onClick={() => openProduct(p)}
        title={p.label}
        className={clsx(
          'flex flex-col items-center gap-1 w-20 py-2.5 rounded-2xl transition-colors',
          isActive
            ? 'bg-[var(--primary-soft)] text-[var(--primary-strong)]'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        )}
      >
        <p.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
        {p.kicker && (
          <span className="text-[10px] leading-none opacity-70 -mb-0.5">{p.kicker}</span>
        )}
        <span className={clsx('text-[11px] leading-none', isActive ? 'font-bold' : 'font-medium')}>
          {p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label}
        </span>
      </button>
    )
  }

  const showPanel = active && !(active.key === 'overview')

  return (
    <div
      className={clsx(
        'z-40 h-screen shrink-0 flex',
        // Mobil: overlay çekmece; masaüstü: yapışkan çift kolon
        'fixed inset-y-0 left-0 md:sticky md:top-0 md:translate-x-0 transition-transform duration-300',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      {/* İkon ray — 7 ürün */}
      <aside className="w-24 bg-[var(--surface)] border-r border-[var(--line)] flex flex-col items-center py-4 gap-1">
        {/* Marka kilidi — ikon + word-mark, ray genişliğine sığar */}
        <div className="mb-3"><BrandMark size="sm" stacked /></div>
        {/* m-auto: yer varken dikey ortalar, taşarsa kırpmadan kaydırılabilir kalır */}
        <div className="flex-1 overflow-y-auto w-full flex flex-col">
          <div className="m-auto flex flex-col items-center gap-1 py-1">
            {topProducts.map(railButton)}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 pt-2 border-t border-[var(--line)] w-full">
          {bottomProducts.map((p) => (
            <Fragment key={p.key}>
              {railButton(p)}
            </Fragment>
          ))}
        </div>
      </aside>

      {/* Alt menü paneli — aktif ürünün alt başlıkları */}
      {showPanel && (
        <aside className="w-60 bg-[var(--surface)] border-r border-[var(--line)] flex flex-col">
          <div className="px-4 pt-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', active.chip)}>
                <active.icon size={16} />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-400 leading-none">{active.kicker ?? BRAND.name}</p>
                <p className="text-[15px] font-bold text-gray-900 leading-tight">{active.label}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 md:hidden">
              <X size={16} />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col">
            <div className="space-y-1">
            {active.groups.map((group, gi) => (
              <div key={gi}>
                {group.title && (
                  <p className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {group.title}
                  </p>
                )}
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-colors mb-0.5',
                        item.sub && 'ml-5 border-l border-[var(--line)] rounded-l-none',
                        (item.active ?? isActive)
                          ? 'bg-[var(--primary-soft)] text-[var(--primary-strong)] font-semibold'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
                      )
                    }
                  >
                    <item.icon size={item.sub ? 14 : 16} strokeWidth={1.9} />
                    <span className="truncate">{item.label}</span>
                    {item.tool && <ToolInfo tool={item.tool} className="ml-auto" />}
                  </NavLink>
                ))}
              </div>
            ))}
            </div>
          </nav>
        </aside>
      )}
    </div>
  )
}
