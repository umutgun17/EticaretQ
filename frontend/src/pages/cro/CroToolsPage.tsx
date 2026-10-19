import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutGrid, Search } from 'lucide-react'
import clsx from 'clsx'
import { croToolsApi, useCroToolGroups } from '@/lib/croTools'
import ToolInfo from '@/components/cro/ToolInfo'

type Filter = 'all' | 'on' | 'off'

/* Site Araçları — CRO altındaki tüm widget'lar tek ekranda, alışveriş yolculuğuna göre gruplu.
   Kart = mağazadaki görünümün küçük ekran görüntüsü + ad + tek cümle + açık/kapalı; tıklayınca aracın ayar sayfası.
   Sol menüdeki kategori bağlantıları /cro/tools#<grup> ile gelir → ilgili bölüme kaydırılır. */
export default function CroToolsPage() {
  const groups = useCroToolGroups()
  const loc = useLocation()
  const top = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Record<string, boolean> | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    croToolsApi.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Menüden kategori seçilince: filtreyi sıfırla (bölüm gizli kalmasın) ve o bölüme kaydır
  useEffect(() => {
    const key = loc.hash.slice(1)
    setFilter('all')
    setQ('')
    requestAnimationFrame(() => {
      const el = key ? document.getElementById(`grp-${key}`) : top.current
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [loc.hash])

  const all = groups.flatMap((g) => g.tools)
  const withStatus = all.filter((t) => t.hasStatus)
  const onCount = status ? withStatus.filter((t) => status[t.key]).length : 0

  const visible = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    return groups
      .map((g) => ({
        ...g,
        tools: g.tools.filter((t) => {
          if (needle && !(t.label + ' ' + t.desc).toLocaleLowerCase('tr').includes(needle)) return false
          if (filter !== 'all' && status) {
            if (!t.hasStatus) return false
            return filter === 'on' ? !!status[t.key] : !status[t.key]
          }
          return true
        }),
      }))
      .filter((g) => g.tools.length > 0)
  }, [groups, q, filter, status])

  return (
    <div ref={top} className="p-6 max-w-7xl mx-auto scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2"><LayoutGrid size={24} /> Site Araçları</h1>
          <p className="text-sm text-gray-500 mt-1">Mağazanızda satışı artıran tüm araçlar burada. Bir araca tıklayın, ayarlayın ve açın.</p>
        </div>
        {status && (
          <p className="text-sm text-gray-600">
            <b className="text-emerald-600">{onCount}</b> / {withStatus.length} araç açık
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Araç ara…"
            className="pl-9 pr-3 py-2 w-64 text-sm bg-white border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        {status && (
          <div className="flex items-center gap-1 rounded-full bg-[var(--app-bg)] p-1">
            {([['all', 'Tümü'], ['on', 'Açık'], ['off', 'Kapalı']] as [Filter, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={clsx('px-3 py-1 text-[13px] rounded-full', filter === k ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-800')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 && <p className="text-sm text-gray-500">Bu aramaya uyan araç yok.</p>}

      <div className="space-y-10">
        {visible.map((g) => (
          <section key={g.key} id={`grp-${g.key}`} className="scroll-mt-20">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                <g.icon size={16} />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-gray-900 leading-tight">{g.title}</h2>
                <p className="text-[13px] text-gray-500">{g.desc}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.tools.map((t) => {
                const on = status ? !!status[t.key] : null
                return (
                  <div key={t.key} className="group bg-white rounded-xl shadow-sm border border-gray-100 hover:border-indigo-200 hover:shadow-md transition overflow-hidden flex flex-col">
                    <Link to={t.to} className="block">
                      <div className="relative h-44 bg-[var(--app-bg)] border-b border-gray-100 overflow-hidden">
                        {t.noShot ? (
                          <div className="w-full h-full flex items-center justify-center text-orange-300">
                            <t.icon size={40} strokeWidth={1.5} />
                          </div>
                        ) : (
                          <img
                            src={`${import.meta.env.BASE_URL}tool-shots/${t.key}.webp`}
                            alt={t.label}
                            loading="lazy"
                            style={{ objectPosition: t.shotPos || 'top' }}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        )}
                        {t.hasStatus && on !== null && (
                          <span className={clsx('absolute top-2 right-2 text-[10px] font-bold rounded-full px-2 py-0.5 shadow-sm', on ? 'bg-emerald-500 text-white' : 'bg-white/90 text-gray-500')}>
                            {on ? 'AÇIK' : 'KAPALI'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-start gap-2.5 p-3.5">
                        <div className="w-8 h-8 shrink-0 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                          <t.icon size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[14px] font-semibold text-gray-900 truncate">{t.label}</p>
                            <ToolInfo tool={t} />
                          </div>
                          <p className="text-[12.5px] text-gray-500 mt-0.5 leading-snug">{t.desc}</p>
                        </div>
                      </div>
                    </Link>
                    {t.links && (
                      <div className="flex gap-3 px-3.5 pb-3 -mt-1 pl-[3.25rem]">
                        {t.links.map((l) => (
                          <Link key={l.to} to={l.to} className="text-[12px] font-medium text-indigo-600 hover:underline">{l.label}</Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
