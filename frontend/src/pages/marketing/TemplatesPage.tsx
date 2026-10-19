import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Plus, Pencil, Eye, Trash2, Lock, Mail } from 'lucide-react'
import clsx from 'clsx'
import {
  emailTemplatesApi, CATEGORY_LABELS,
  type EmailTemplate, type EmailTemplateListItem,
} from '@/lib/emailTemplatesApi'

// GrapesJS ağır → yalnızca düzenleyici açılınca ayrı chunk olarak yüklenir
const EmailEditor = lazy(() => import('@/components/marketing/EmailEditor'))

function slugifyKey(name: string): string {
  return name.toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'sablon'
}

export default function TemplatesPage() {
  const [rows, setRows] = useState<EmailTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<string>('all')
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [creating, setCreating] = useState(false)

  async function refresh() {
    setLoading(true)
    try { setRows(await emailTemplatesApi.list()) } finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const categories = useMemo(() => {
    const set = Array.from(new Set(rows.map((r) => r.category)))
    return ['all', ...set]
  }, [rows])
  const filtered = cat === 'all' ? rows : rows.filter((r) => r.category === cat)

  async function openEditor(id: number) {
    const full = await emailTemplatesApi.get(id)
    setEditing(full)
  }

  async function handleSave(html: string, design: Record<string, unknown>) {
    if (!editing) return
    setSaving(true)
    try {
      await emailTemplatesApi.update(editing.id, {
        name: editing.name, subject: editing.subject, category: editing.category,
        preheader: editing.preheader, variables: editing.variables, is_active: editing.is_active,
        html, design,
      })
      setEditing(null)
      await refresh()
    } finally { setSaving(false) }
  }

  async function handlePreview(id: number) {
    const p = await emailTemplatesApi.preview(id)
    setPreview({ subject: p.subject, html: p.html })
  }

  async function handleDelete(t: EmailTemplateListItem) {
    if (t.is_system) return
    if (!confirm(`"${t.name}" şablonunu silmek istediğine emin misin?`)) return
    await emailTemplatesApi.remove(t.id)
    await refresh()
  }

  async function handleToggleActive(t: EmailTemplateListItem) {
    await emailTemplatesApi.update(t.id, { name: t.name, subject: t.subject, is_active: !t.is_active })
    await refresh()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="text-emerald-600" size={26} />
          <h1 className="text-xl font-extrabold text-gray-900">E-posta Şablonları</h1>
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> Yeni Şablon
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Sürükle-bırak editörle HTML e-postalarını düzenle. Değişkenler <code className="bg-gray-100 px-1 rounded">{'{{customer_name}}'}</code> gibi otomatik doldurulur.
      </p>


      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm border transition', cat === c ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}
          >
            {c === 'all' ? 'Tümü' : (CATEGORY_LABELS[c] ?? c)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((t) => (
          <div key={t.id} className={clsx('bg-white rounded-lg border p-4 hover:shadow-sm transition flex flex-col', t.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70')}>
            <div className="flex items-center gap-2 mb-2">
              <Mail size={16} className="text-gray-500" />
              <span className="text-xs text-gray-500">{CATEGORY_LABELS[t.category] ?? t.category}</span>
              {t.is_system && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-gray-400"><Lock size={10} /> Sistem</span>}
            </div>
            <div className="font-medium text-gray-900 text-sm">{t.name}</div>
            <div className="text-xs text-gray-500 mt-1 truncate" title={t.subject}>Konu: {t.subject}</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.variables ?? []).slice(0, 6).map((v) => (
                <span key={v} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-mono">{`{{${v}}}`}</span>
              ))}
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-2">
              <button onClick={() => openEditor(t.id)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline">
                <Pencil size={12} /> Düzenle
              </button>
              <button onClick={() => handlePreview(t.id)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:underline">
                <Eye size={12} /> Önizle
              </button>
              <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer select-none">
                <input type="checkbox" checked={t.is_active} onChange={() => handleToggleActive(t)} className="accent-emerald-600" />
                Aktif
              </label>
              {!t.is_system && (
                <button onClick={() => handleDelete(t)} className="text-gray-400 hover:text-rose-600" title="Sil">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="col-span-full text-center text-gray-400 py-10">Yükleniyor…</div>}
        {!loading && filtered.length === 0 && <div className="col-span-full text-center text-gray-400 py-10">Şablon yok.</div>}
      </div>

      {editing && (
        <Suspense fallback={<div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center text-white text-sm">Editör yükleniyor…</div>}>
          <EmailEditor
            title={editing.name}
            initialHtml={editing.html}
            initialDesign={editing.design}
            variables={editing.variables ?? []}
            saving={saving}
            onSave={handleSave}
            onClose={() => setEditing(null)}
          />
        </Suspense>
      )}

      {preview && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-xl overflow-hidden w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-xs text-gray-400">Konu</div>
              <div className="font-medium text-gray-900 text-sm">{preview.subject}</div>
            </div>
            <iframe title="önizleme" srcDoc={preview.html} className="flex-1 w-full min-h-[60vh] bg-white" />
            <div className="px-4 py-2 border-t border-gray-200 text-right">
              <button onClick={() => setPreview(null)} className="px-4 py-1.5 rounded-lg text-sm bg-gray-100 hover:bg-gray-200">Kapat</button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <CreateTemplateModal
          onClose={() => setCreating(false)}
          onCreated={async (id) => { setCreating(false); await refresh(); await openEditor(id) }}
        />
      )}
    </div>
  )
}

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('general')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    if (!name.trim() || !subject.trim()) { setErr('Ad ve konu zorunlu.'); return }
    setBusy(true)
    try {
      const t = await emailTemplatesApi.create({
        key: slugifyKey(name) + '_' + Math.random().toString(36).slice(2, 6),
        name: name.trim(), subject: subject.trim(), category,
        html: '<div style="padding:24px;font-family:Arial">Yeni şablon — düzenlemeye başla.</div>',
        variables: ['customer_name', 'shop_name', 'unsubscribe_url'],
      })
      onCreated(t.id)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setErr(msg ?? 'Oluşturulamadı.')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[1001] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Yeni E-posta Şablonu</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Şablon adı</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Örn. Bayram Kampanyası" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">E-posta konusu</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Örn. Sana özel bayram indirimi 🎉" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kategori</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-gray-100 hover:bg-gray-200">İptal</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {busy ? 'Oluşturuluyor…' : 'Oluştur ve Düzenle'}
          </button>
        </div>
      </div>
    </div>
  )
}
