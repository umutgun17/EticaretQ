import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Trash2, Plus, GripVertical, Copy, Check, Palette, SlidersHorizontal, Play, BarChart3, Ticket } from 'lucide-react'
import clsx from 'clsx'
import {
  wheelApi,
  PRIZE_TYPE_LABELS,
  SLICE_COLORS,
  type WheelCampaign,
  type WheelCampaignRow,
  type WheelSlice,
  type WheelPrizeType,
} from '@/lib/wheelApi'
import WheelPreview from './WheelPreview'
import { WHEEL_TEMPLATES, applyTemplate, type WheelTemplate } from '@/lib/wheelTemplates'

type Tab = 'design' | 'ab' | 'scratch' | 'behavior'
// A/B kampanyasında varsayılan sekme 'ab' (tasarım yok); oyun kampanyasında 'design'.

export default function WheelCampaignEditPage() {
  const { id } = useParams<{ id: string }>()
  const campaignId = Number(id)
  const navigate = useNavigate()

  const [c, setC] = useState<WheelCampaign | null>(null)
  const [tab, setTab] = useState<Tab>('design')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setC(await wheelApi.get(campaignId))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  const patch = (p: Partial<WheelCampaign>) => setC((prev) => (prev ? { ...prev, ...p } : prev))
  const patchDesign = (p: Partial<WheelCampaign['design']>) => setC((prev) => (prev ? { ...prev, design: { ...prev.design, ...p } } : prev))
  const patchTrigger = (p: Partial<WheelCampaign['trigger_rules']>) => setC((prev) => (prev ? { ...prev, trigger_rules: { ...prev.trigger_rules, ...p } } : prev))
  const patchForm = (p: Partial<WheelCampaign['form_fields']>) => setC((prev) => (prev ? { ...prev, form_fields: { ...prev.form_fields, ...p } } : prev))

  const save = async () => {
    if (!c) return
    setSaving(true)
    setError(null)
    try {
      const updated = await wheelApi.update(c.id, {
        name: c.name,
        status: c.status,
        design: c.design,
        trigger_rules: c.trigger_rules,
        form_fields: c.form_fields,
        coupon_provider: c.coupon_provider,
        coupon_valid_hours: c.coupon_valid_hours,
        settings: c.settings,
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        slices: c.slices,
      })
      setC(updated)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      setError(err.response?.data?.message ?? 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  // variant: 'wheel' (çark) | 'scratch' (kazı kazan) — önizlemede A/B kurası yerine zorlanır
  const preview = async (variant: 'wheel' | 'scratch' | 'a' | 'b' = 'wheel') => {
    if (!c) return
    await save() // önizleme kayıtlı durumu yansıtır
    try {
      const { token, tenant, campaign } = await wheelApi.previewToken(c.id)
      const url = `/widget/wheel-preview.html?tenant=${encodeURIComponent(tenant ?? '')}&campaign=${encodeURIComponent(campaign)}&token=${encodeURIComponent(token)}&variant=${variant}`
      window.open(url, '_blank', 'noopener')
    } catch {
      setError('Önizleme açılamadı.')
    }
  }

  const remove = async () => {
    if (!c || !confirm(`“${c.name}” kampanyası silinsin mi? Bu işlem geri alınamaz.`)) return
    await wheelApi.remove(c.id)
    navigate('/wheel')
  }

  if (!c) {
    return <div className="p-6 text-gray-400">Yükleniyor…</div>
  }

  const totalWeight = c.slices.reduce((s, x) => s + (x.weight || 0), 0)
  const isScratch = c.game_type === 'scratch'
  const isAb = c.game_type === 'ab'
  const effTab: Tab = isAb && tab === 'design' ? 'ab' : (!isAb && tab === 'ab' ? 'design' : tab)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Üst bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/wheel')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={18} />
          </button>
          <input
            value={c.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="text-lg font-semibold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-rose-500 focus:outline-none bg-transparent"
          />
          <span className="text-xs text-gray-400 font-mono">/{c.slug}</span>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', isScratch ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700')}>
            {isAb ? '⚖️ A/B Testi' : isScratch ? '🎫 Kazı Kazan' : '🎡 Çark'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={c.status}
            onChange={(e) => patch({ status: e.target.value as WheelCampaign['status'] })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="draft">Taslak</option>
            <option value="active">Yayında</option>
            <option value="paused">Duraklatıldı</option>
            <option value="ended">Bitti</option>
          </select>
          <button
            onClick={() => navigate(`/wheel/${c.id}/istatistik`)}
            className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
            title="Çark istatistikleri & katılımcılar"
          >
            <BarChart3 size={15} /> İstatistikler
          </button>
          <button
            onClick={() => preview('wheel')}
            disabled={saving}
            className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            title="Kaydedip yeni sekmede çarkı önizle"
          >
            <Play size={15} /> Test Et
          </button>

          <button onClick={remove} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg" title="Sil">
            <Trash2 size={18} />
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
          >
            <Save size={16} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{error}</div>}

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {([
          ...(isAb ? [['ab', 'A/B Ayarları', Ticket]] : [['design', isScratch ? 'Kart & Ödüller' : 'Tasarım & Dilimler', Palette]]),
          ...(isScratch ? [['scratch', 'Kazı Kazan Ayarları', Ticket]] : []),
          ['behavior', isAb ? 'Tetik (gömülüyse)' : 'Tetik & Form', SlidersHorizontal],
        ] as [Tab, string, typeof Palette][]).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              effTab === key ? 'border-rose-600 text-rose-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {effTab === 'design' && !isAb && (
            <DesignTab c={c} setC={setC} patchDesign={patchDesign} totalWeight={totalWeight} />
          )}
          {effTab === 'ab' && isAb && <AbTab c={c} patch={patch} onPreview={(side) => preview(side)} saving={saving} />}
          {effTab === 'scratch' && isScratch && <ScratchSettingsTab c={c} patch={patch} />}
          {effTab === 'behavior' && <BehaviorTab c={c} patch={patch} patchTrigger={patchTrigger} patchForm={patchForm} />}
        </div>

        {/* Sağ: canlı önizleme + gömme kodu */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500 mb-3 uppercase">Önizleme</div>
            <div
              className="rounded-lg p-4 flex flex-col items-center"
              style={{ background: c.design.primary_color || '#ede9fe' }}
            >
              <div className="text-center mb-2" style={{ color: c.design.text_color }}>
                <div className="font-bold">{c.design.title}</div>
                <div className="text-xs opacity-90">{c.design.subtitle}</div>
              </div>
              {isAb
                ? <AbSummary c={c} />
                : isScratch
                  ? <ScratchCardPreview design={c.design} minutes={c.settings.scratch_valid_minutes} />
                  : <WheelPreview slices={c.slices} design={c.design} size={240} />}
            </div>
          </div>
          <EmbedSnippet slug={c.slug} tenantSlug={c.tenant_slug} copied={copied} setCopied={setCopied} />
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Tasarım & Dilimler ─────────────────────────

function DesignTab({
  c,
  setC,
  patchDesign,
  totalWeight,
}: {
  c: WheelCampaign
  setC: React.Dispatch<React.SetStateAction<WheelCampaign | null>>
  patchDesign: (p: Partial<WheelCampaign['design']>) => void
  totalWeight: number
}) {
  const updateSlice = (i: number, p: Partial<WheelSlice>) =>
    setC((prev) => {
      if (!prev) return prev
      const slices = [...prev.slices]
      slices[i] = { ...slices[i], ...p }
      return { ...prev, slices }
    })

  // Şablon seç → renkleri design'a uygula + dilimleri paletten renklendir.
  const applyTpl = (t: WheelTemplate) =>
    setC((prev) => {
      if (!prev) return prev
      const { design, slices } = applyTemplate(t, prev.design, prev.slices)
      return { ...prev, design, slices }
    })

  const addSlice = () =>
    setC((prev) => {
      if (!prev) return prev
      if (prev.slices.length >= 12) return prev
      const color = SLICE_COLORS[prev.slices.length % SLICE_COLORS.length]
      return {
        ...prev,
        slices: [...prev.slices, { label: 'Yeni Ödül', prize_type: 'discount_percent', prize_value: 10, weight: 10, color, coupon_code_template: '', stock_limit: null, min_basket: 0 }],
      }
    })

  const removeSlice = (i: number) =>
    setC((prev) => {
      if (!prev || prev.slices.length <= 2) return prev
      return { ...prev, slices: prev.slices.filter((_, idx) => idx !== i) }
    })

  const move = (i: number, dir: -1 | 1) =>
    setC((prev) => {
      if (!prev) return prev
      const j = i + dir
      if (j < 0 || j >= prev.slices.length) return prev
      const slices = [...prev.slices]
      ;[slices[i], slices[j]] = [slices[j], slices[i]]
      return { ...prev, slices }
    })

  return (
    <div className="space-y-5">
      {/* Hazır tasarım şablonları */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-1">Tasarım şablonu</div>
        <p className="text-xs text-gray-400 mb-3">Hazır bir şablon seç — renkler otomatik uygulanır. Logo ve metinleri aşağıdan özelleştir.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {WHEEL_TEMPLATES.map((t) => {
            const selected = (c.design.template ?? 'festive') === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTpl(t)}
                title={t.description}
                className={clsx(
                  'rounded-lg border-2 p-2 text-left transition',
                  selected ? 'border-rose-500 ring-2 ring-rose-200' : 'border-gray-200 hover:border-gray-300',
                )}
              >
                <div
                  className="h-12 rounded-md mb-2 flex items-center justify-center gap-1 overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${t.design.primary_color}, ${t.design.primary_2})` }}
                >
                  {t.palette.slice(0, 4).map((col, idx) => (
                    <span key={idx} className="w-3 h-3 rounded-full" style={{ background: col, boxShadow: `0 0 0 2px ${t.design.accent_color}` }} />
                  ))}
                </div>
                <div className="text-xs font-medium text-gray-700 truncate">{t.name}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* İçerik (metinler + logo) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">İçerik</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <TextField label="Başlık" value={c.design.title} onChange={(v) => patchDesign({ title: v })} />
          <TextField label="Alt başlık" value={c.design.subtitle} onChange={(v) => patchDesign({ subtitle: v })} />
          <TextField label="Buton yazısı" value={c.design.button_label} onChange={(v) => patchDesign({ button_label: v })} />
          <TextField label="Logo URL (çark ortasında görünür)" value={c.design.logo_url ?? ''} onChange={(v) => patchDesign({ logo_url: v || null })} />
          <TextField label="Kazandı mesajı" value={c.design.win_message} onChange={(v) => patchDesign({ win_message: v })} />
          <TextField label="Kaybetti mesajı" value={c.design.lose_message} onChange={(v) => patchDesign({ lose_message: v })} />
          <TextField label="Kulakçık etiketi" value={c.design.tab_label} onChange={(v) => patchDesign({ tab_label: v })} />
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Kulakçık konumu</span>
            <select
              value={c.design.tab_position}
              onChange={(e) => patchDesign({ tab_position: e.target.value as 'left' | 'right' })}
              className="px-2 py-1.5 border border-gray-300 rounded"
            >
              <option value="left">Solda</option>
              <option value="right">Sağda</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">Kulakçık: müşteri çarkı kapatınca sitenin kenarında beliren, tıklayınca kupon/çark açan sekme.</p>
      </div>

      {/* Dilimler */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-gray-700">Ödüller / Dilimler ({c.slices.length})</div>
          <button onClick={addSlice} disabled={c.slices.length >= 12} className="inline-flex items-center gap-1 text-sm text-rose-600 hover:text-rose-700 disabled:opacity-40">
            <Plus size={15} /> Dilim ekle
          </button>
        </div>

        <div className="space-y-2">
          {c.slices.map((s, i) => {
            const prob = totalWeight > 0 ? ((s.weight || 0) / totalWeight) * 100 : 0
            const needsValue = s.prize_type === 'discount_percent' || s.prize_type === 'discount_amount'
            return (
              <div key={i} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} className="text-gray-300 hover:text-gray-600 leading-none">▲</button>
                    <button onClick={() => move(i, 1)} className="text-gray-300 hover:text-gray-600 leading-none">▼</button>
                  </div>
                  <GripVertical size={14} className="text-gray-300" />
                  <input
                    type="color"
                    value={s.color ?? '#e5e7eb'}
                    onChange={(e) => updateSlice(i, { color: e.target.value })}
                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer"
                  />
                  <input
                    value={s.label}
                    onChange={(e) => updateSlice(i, { label: e.target.value })}
                    placeholder="Dilim etiketi"
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                  <button onClick={() => removeSlice(i)} disabled={c.slices.length <= 2} className="text-gray-300 hover:text-rose-600 disabled:opacity-30">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Ödül tipi</span>
                    <select
                      value={s.prize_type}
                      onChange={(e) => updateSlice(i, { prize_type: e.target.value as WheelPrizeType })}
                      className="px-2 py-1 border border-gray-300 rounded"
                    >
                      {Object.entries(PRIZE_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Değer {needsValue ? '' : '(yok)'}</span>
                    <input
                      type="number"
                      value={s.prize_value}
                      disabled={!needsValue}
                      onChange={(e) => updateSlice(i, { prize_value: Number(e.target.value) })}
                      className="px-2 py-1 border border-gray-300 rounded disabled:bg-gray-50"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Olasılık ağırlığı</span>
                    <input
                      type="number"
                      min={0}
                      value={s.weight}
                      onChange={(e) => updateSlice(i, { weight: Number(e.target.value) })}
                      className="px-2 py-1 border border-gray-300 rounded"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Kupon ön eki</span>
                    <input
                      value={s.coupon_code_template ?? ''}
                      onChange={(e) => updateSlice(i, { coupon_code_template: e.target.value })}
                      placeholder="CARK10"
                      className="px-2 py-1 border border-gray-300 rounded"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-gray-500">
                    Kazanma şansı: <span className="font-semibold text-gray-700">%{prob.toFixed(1)}</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-gray-500" title="Kuponun geçerli olması için gereken min. sepet tutarı (Ticimax MinimumUrunTutari). Boş = koşulsuz.">
                      Min. sepet ₺:
                      <input
                        type="number"
                        min={0}
                        value={s.min_basket ? s.min_basket : ''}
                        disabled={!needsValue}
                        onChange={(e) => updateSlice(i, { min_basket: e.target.value === '' ? 0 : Number(e.target.value) })}
                        placeholder="yok"
                        className="w-24 px-2 py-1 border border-gray-300 rounded disabled:bg-gray-50"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-gray-500">
                      Stok limiti:
                      <input
                        type="number"
                        min={0}
                        value={s.stock_limit ?? ''}
                        onChange={(e) => updateSlice(i, { stock_limit: e.target.value === '' ? null : Number(e.target.value) })}
                        placeholder="∞"
                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                      />
                      {s.stock_used !== undefined && s.stock_limit != null && (
                        <span className="text-gray-400">({s.stock_used} verildi)</span>
                      )}
                    </label>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 text-xs text-gray-400">
          Toplam ağırlık: {totalWeight}. Ağırlık 0 olan dilim hiç çıkmaz; “Kaybeden” tipinde kupon üretilmez.
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Tetik & Form ─────────────────────────

function BehaviorTab({
  c,
  patch,
  patchTrigger,
  patchForm,
}: {
  c: WheelCampaign
  patch: (p: Partial<WheelCampaign>) => void
  patchTrigger: (p: Partial<WheelCampaign['trigger_rules']>) => void
  patchForm: (p: Partial<WheelCampaign['form_fields']>) => void
}) {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Ne zaman gösterilsin?</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Tetik</span>
            <select value={c.trigger_rules.type} onChange={(e) => patchTrigger({ type: e.target.value as WheelCampaign['trigger_rules']['type'] })} className="px-2 py-1.5 border border-gray-300 rounded">
              <option value="delay">Girişte (saniye sonra)</option>
              <option value="exit_intent">Çıkış niyeti</option>
              <option value="manual">Manuel buton</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Gecikme (sn)</span>
            <input type="number" min={0} value={c.trigger_rules.delay_seconds} onChange={(e) => patchTrigger({ delay_seconds: Number(e.target.value) })} className="px-2 py-1.5 border border-gray-300 rounded" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Cihaz</span>
            <select value={c.trigger_rules.device} onChange={(e) => patchTrigger({ device: e.target.value as WheelCampaign['trigger_rules']['device'] })} className="px-2 py-1.5 border border-gray-300 rounded">
              <option value="all">Hepsi</option>
              <option value="desktop">Masaüstü</option>
              <option value="mobile">Mobil</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Tekrar gösterme (gün) — 0 = bir kez</span>
            <input type="number" min={0} value={c.trigger_rules.frequency_days} onChange={(e) => patchTrigger({ frequency_days: Number(e.target.value) })} className="px-2 py-1.5 border border-gray-300 rounded" />
          </label>
          <label className="flex items-center gap-2 col-span-2">
            <input type="checkbox" checked={c.trigger_rules.show_once_per_win} onChange={(e) => patchTrigger({ show_once_per_win: e.target.checked })} />
            <span className="text-gray-600">Kazanan ziyaretçiye bir daha gösterme</span>
          </label>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Hangi bilgileri toplayalım?</div>
        <div className="space-y-2 text-sm">
          <FieldRow label="Ad Soyad" collect={c.form_fields.collect_name} require={c.form_fields.require_name} onCollect={(v) => patchForm({ collect_name: v })} onRequire={(v) => patchForm({ require_name: v })} />
          <FieldRow label="E-posta" collect={c.form_fields.collect_email} require={c.form_fields.require_email} onCollect={(v) => patchForm({ collect_email: v })} onRequire={(v) => patchForm({ require_email: v })} />
          <FieldRow label="Telefon" collect={c.form_fields.collect_phone} require={c.form_fields.require_phone} onCollect={(v) => patchForm({ collect_phone: v })} onRequire={(v) => patchForm({ require_phone: v })} />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={c.form_fields.kvkk_required} onChange={(e) => patchForm({ kvkk_required: e.target.checked })} />
            <span className="text-gray-700 font-medium">KVKK açık rıza onayı zorunlu</span>
          </label>
          <textarea
            value={c.form_fields.kvkk_text}
            onChange={(e) => patchForm({ kvkk_text: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded text-xs text-gray-600"
            placeholder="KVKK açık rıza metni…"
          />
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={c.form_fields.comms_required} onChange={(e) => patchForm({ comms_required: e.target.checked })} />
            <span className="text-gray-700 font-medium">İleti izni (SMS/e-posta/WhatsApp) zorunlu</span>
          </label>
          <textarea
            value={c.form_fields.comms_text}
            onChange={(e) => patchForm({ comms_text: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded text-xs text-gray-600"
            placeholder="Ticari ileti izni metni…"
          />
          <p className="mt-1 text-xs text-gray-400">KVKK'dan ayrı, ikinci onay kutusu. İleti gönderimi (Faz 4) için yasal izin buradan toplanır.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Kupon</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Kupon kaynağı</span>
            <select value={c.coupon_provider} onChange={(e) => patch({ coupon_provider: e.target.value as WheelCampaign['coupon_provider'] })} className="px-2 py-1.5 border border-gray-300 rounded">
              <option value="ticimax">Ticimax'ta gerçek kupon oluştur</option>
              <option value="display">Sadece ekranda göster (Ticimax'a yazma)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">Geçerlilik (saat)</span>
            <input type="number" min={1} value={c.coupon_valid_hours} onChange={(e) => patch({ coupon_valid_hours: Number(e.target.value) })} className="px-2 py-1.5 border border-gray-300 rounded" />
          </label>
        </div>
        {c.coupon_provider === 'ticimax' ? (
          <div className="mt-2 text-xs text-emerald-600">
            Her çevirmede Ticimax'ta gerçek, tek kullanımlık kupon oluşturulur ve müşteriye gösterilir.
          </div>
        ) : (
          <div className="mt-2 text-xs text-amber-600">
            Kod yalnızca ekranda gösterilir, Ticimax'a yazılmaz. Müşterinin kodu kullanabilmesi için Ticimax'a kupon tanımlanmış olmalı.
          </div>
        )}
      </div>

    </div>
  )
}

// ───────────────────────── A/B Testi (çark kampanyası) ─────────────────────────

/**
 * Çark kampanyası, ziyaretçilerin %N'ine kendisi yerine seçilen KAZI KAZAN kampanyasını gösterir.
 * Tek gömme kodu (çarkınki) yeter; kura ziyaretçi bazında kalıcıdır. Kayıt/kupon/istatistik
 * seçilen kazı kazan kampanyasına düşer; karşılaştırma İstatistikler → A/B tablosunda.
 */
function AbTab({ c, patch, onPreview, saving }: { c: WheelCampaign; patch: (p: Partial<WheelCampaign>) => void; onPreview: (side: 'a' | 'b') => void; saving: boolean }) {
  const s = c.settings
  const set = (p: Partial<WheelCampaign['settings']>) => patch({ settings: { ...s, ...p } })
  const pct = Number(s.ab_percent) || 0
  const [games, setGames] = useState<WheelCampaignRow[]>([])
  useEffect(() => {
    wheelApi.list({ per_page: 100 }).then((r) => setGames(r.data.filter((g) => g.game_type !== 'ab'))).catch(() => setGames([]))
  }, [])
  const a = games.find((g) => g.id === s.ab_campaign_a_id)
  const b = games.find((g) => g.id === s.ab_campaign_b_id)
  const on = !!a && !!b && a.id !== b.id && pct > 0
  const icon = (g?: WheelCampaignRow) => (g?.game_type === 'scratch' ? '🎫' : '🎡')

  const Select = ({ side, value, onChange }: { side: 'A' | 'B'; value: number | null; onChange: (v: number | null) => void }) => (
    <label className="flex flex-col gap-1">
      <span className="text-gray-500 text-xs">{side} kampanyası {side === 'A' ? '(varsayılan, ziyaretçilerin çoğu)' : '(test edilen)'}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className="px-2 py-1.5 border border-gray-300 rounded">
        <option value="">— seçin —</option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>{icon(g)} {g.name}{g.status !== 'active' ? ` (${g.status === 'draft' ? 'taslak' : g.status})` : ''}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-violet-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-gray-700">A/B Testi ayarları</div>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded', on ? 'bg-violet-100 text-violet-800' : 'bg-gray-100 text-gray-500')}>
            {on ? `%${100 - pct} A / %${pct} B` : 'EKSİK · iki kampanya seçin'}
          </span>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Ziyaretçi ilk görüşte A ya da B'ye atanır ve hep aynısını görür. Kayıt, kupon ve ciro ilgili oyun kampanyasına yazılır;
          karşılaştırma bu kampanyanın İstatistikler sayfasında. Sitede A'nın gömme kodu varsa yeterlidir; bu kampanya yayına alınınca kura devreye girer.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Select side="A" value={s.ab_campaign_a_id} onChange={(v) => set({ ab_campaign_a_id: v })} />
          <Select side="B" value={s.ab_campaign_b_id} onChange={(v) => set({ ab_campaign_b_id: v })} />
        </div>
        {a && b && a.id === b.id && <div className="mt-2 text-xs text-rose-600">A ve B aynı kampanya olamaz.</div>}
        {((a && a.status !== 'active') || (b && b.status !== 'active')) && <div className="mt-2 text-xs text-rose-600">Seçilen kampanya yayında değil; yayına alınana kadar o taraf gösterilmez.</div>}
        <div className="mt-4">
          <span className="text-gray-500 text-xs">B'yi görecek ziyaretçi (%)</span>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {[10, 25, 50, 75].map((p) => (
              <button key={p} type="button" onClick={() => set({ ab_percent: p })}
                className={clsx('px-3 py-1.5 rounded-lg border text-xs font-medium', pct === p ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
                %{p}
              </button>
            ))}
            <input type="number" min={0} max={100} value={pct} onChange={(e) => set({ ab_percent: Math.max(0, Math.min(100, Number(e.target.value))) })} className="w-20 px-2 py-1.5 border border-gray-300 rounded" />
          </div>
        </div>
        {a && b && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={() => onPreview('a')} disabled={saving} className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-60"><Play size={12} /> A'yı test et ({icon(a)} {a.name})</button>
            <button type="button" onClick={() => onPreview('b')} disabled={saving} className="inline-flex items-center gap-1.5 border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800 px-3 py-1.5 rounded-lg font-medium disabled:opacity-60"><Play size={12} /> B'yi test et ({icon(b)} {b.name})</button>
            <span className="text-gray-400 ml-auto"><Link to={`/wheel/${a.id}`} className="underline">A'yı düzenle</Link> · <Link to={`/wheel/${b.id}`} className="underline">B'yi düzenle</Link></span>
          </div>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-xs text-gray-500">
        📊 Sonuçlar: bu kampanyanın İstatistikler sayfasında "A/B Testi" tablosu (oynanma, kupon, kullanım %, ciro, kupon başı ciro). Karar için her iki tarafta birkaç yüz kupon bekleyin.
        Kazı kazan formsuz olduğu için kartı gören herkes kupon alır; kıyası kullanılan kupon sayısı ve ciro üzerinden yapın.
      </div>
    </div>
  )
}

/** A/B kampanyası özeti (panel sağ kolon). */
function AbSummary({ c }: { c: WheelCampaign }) {
  const pct = Number(c.settings.ab_percent) || 0
  return (
    <div className="text-center text-sm space-y-2">
      <div className="text-3xl">⚖️</div>
      <div className="font-bold text-gray-900">{c.ab_a_name ?? 'A seçilmedi'} <span className="text-gray-400 font-normal">%{100 - pct}</span></div>
      <div className="text-gray-400 text-xs">vs</div>
      <div className="font-bold text-gray-900">{c.ab_b_name ?? 'B seçilmedi'} <span className="text-gray-400 font-normal">%{pct}</span></div>
    </div>
  )
}

// ───────────────────────── Kazı Kazan Ayarları (kazı kazan kampanyası) ─────────────────────────

function ScratchSettingsTab({ c, patch }: { c: WheelCampaign; patch: (p: Partial<WheelCampaign>) => void }) {
  const s = c.settings
  const set = (p: Partial<WheelCampaign['settings']>) => patch({ settings: { ...s, ...p } })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-amber-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Kupon süresi</div>
        <label className="flex flex-col gap-1 text-sm max-w-xs">
          <span className="text-gray-500 text-xs">Geçerlilik (dakika)</span>
          <input type="number" min={5} max={1440} value={s.scratch_valid_minutes} onChange={(e) => set({ scratch_valid_minutes: Number(e.target.value) })} className="px-2 py-1.5 border border-gray-300 rounded" />
        </label>
        <p className="mt-2 text-xs text-gray-400">Kısa süre = aciliyet. Sayaç kartın sağında "Sana Özel Hediye" kutusunda ve kulakçıkta akar. Süre dolunca kupon Ticimax'ta otomatik pasifleşir.</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={!!s.scratch_skip_form} onChange={(e) => set({ scratch_skip_form: e.target.checked })} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium text-gray-800">Form sorma, herkese direkt kazıt</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              Açıkken kart belirir belirmez kazınır; ad/e-posta/telefon ve KVKK onayı istenmez (lead toplanmaz, SMS hatırlatması gidemez).
              Hile kilidi: aynı tarayıcı + aynı IP 24 saatte bir kupon. Kapalıyken Tetik &amp; Form'daki form sorulur.
            </span>
          </span>
        </label>
      </div>

      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-xs text-gray-500 space-y-1">
        <div className="text-sm font-medium text-gray-700 mb-1">Arka planda otomatik çalışanlar</div>
        <div>⏱ Süresi dolan kullanılmamış kupon Ticimax'ta pasifleştirilir (her dakika). Ticimax çekleri gün sonuna kadar yaşadığı için "{s.scratch_valid_minutes} dakika" sözü böyle tutar.</div>
        <div>📩 Formlu modda süre bitmeden ~10 dk önce SMS hatırlatma gider (Pazarlama → Otomasyonlar → "Çark Entegrasyonu" anahtarıyla).</div>
        <div>🎡 Bu kampanyayı bir çark kampanyasının "A/B Testi" sekmesinden eş seçerseniz ayrı gömme kodu gerekmez; tek başına kullanacaksanız sağdaki gömme kodunu siteye ekleyin.</div>
      </div>
    </div>
  )
}

/** Kazı kazan kartı statik önizlemesi (panel sağ kolon). */
function ScratchCardPreview({ design, minutes }: { design: WheelCampaign['design']; minutes: number }) {
  return (
    <div className="w-[240px] rounded-2xl overflow-hidden bg-white text-gray-900 shadow-xl border border-black/10 -rotate-1">
      <div className="text-center text-[11px] font-black tracking-[4px] py-2" style={{ background: design.accent_color, color: '#fff' }}>SANA ÖZEL</div>
      {design.logo_url && <img src={design.logo_url} alt="" className="block max-h-7 max-w-[60%] mx-auto mt-2 object-contain" />}
      <div className="m-2 rounded-xl h-[120px] bg-gradient-to-br from-zinc-300 via-zinc-100 to-zinc-400 flex flex-col items-center justify-center">
        <div className="text-base font-extrabold text-zinc-700">👆 BURAYI KAZI</div>
        <div className="text-[11px] text-zinc-600">sana özel indirimin burada</div>
      </div>
      <div className="text-center text-[11px] font-bold text-amber-700 pb-3">👆 Hemen kazı, {minutes} dakika içinde kullan</div>
    </div>
  )
}


function FieldRow({ label, collect, require, onCollect, onRequire }: { label: string; collect: boolean; require: boolean; onCollect: (v: boolean) => void; onRequire: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-700">{label}</span>
      <div className="flex items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={collect} onChange={(e) => onCollect(e.target.checked)} /> Topla
        </label>
        <label className={clsx('flex items-center gap-1.5', !collect && 'opacity-40')}>
          <input type="checkbox" checked={require} disabled={!collect} onChange={(e) => onRequire(e.target.checked)} /> Zorunlu
        </label>
      </div>
    </div>
  )
}


// ───────────────────────── Gömme kodu ─────────────────────────

function EmbedSnippet({ slug, tenantSlug: tenantSlugProp, copied, setCopied }: { slug: string; tenantSlug?: string; copied: boolean; setCopied: (v: boolean) => void }) {
  const origin = window.location.origin
  const tenantSlug = tenantSlugProp || '<TENANT_SLUG>'
  const v = '8' // cache sürümü — wheel.js değişince artır (8: kazı kazan A/B, 14 Eki 2026)
  // SRI (integrity) BİLEREK YOK: wheel.js sık güncelleniyor; sabit hash her deploy'da
  // tüm sitelerde script'i bloke etti (2-5 Tem 2026 kesintisi). Eklenecekse her deploy'da
  // embed de güncellenmeli: openssl dgst -sha384 -binary wheel.js | openssl base64 -A
  // TEK async script — host sitede render-blocking <link>/defer YOK; CSS'i wheel.js kendi enjekte eder.
  const snippet = `<script
  src="${origin}/widget/wheel.js?v=${v}"
  data-tenant="${tenantSlug}"
  data-campaign="${slug}"
  async></script>`

  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-500 uppercase">Siteye Gömme Kodu</div>
        <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-[11px] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
      <div className="mt-2 text-[11px] text-gray-400">
        <code>data-tenant</code> firmanın slug’ı ile otomatik dolu — kodu olduğu gibi siteye yapıştırın. Çalışması için Ayarlar’da bu kampanyanın gösterileceği site alan adını <code>wheel_widget_domains</code> listesine ekleyin ve widget’ı açın.
      </div>
    </div>
  )
}

// ───────────────────────── küçük alanlar ─────────────────────────

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-500 text-xs">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded" />
    </label>
  )
}

