import { lazy, Suspense, useState } from 'react'
import { Pencil, Eye } from 'lucide-react'
import { emailTemplatesApi, type EmailTemplate } from '@/lib/emailTemplatesApi'

const EmailEditor = lazy(() => import('@/components/marketing/EmailEditor'))

/**
 * Bir otomasyonun e-posta şablonunu (key ile) yerinde düzenlemek için buton.
 * Tıklayınca şablonu yükler, GrapesJS editörünü açar; kaydedince günceller.
 */
export default function TemplateEditButton({ templateKey, label = 'Şablonu düzenle' }: { templateKey: string; label?: string }) {
  const [tpl, setTpl] = useState<EmailTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function findId(): Promise<number | null> {
    const list = await emailTemplatesApi.list()
    return list.find((t) => t.key === templateKey)?.id ?? null
  }

  async function openEdit() {
    setLoading(true)
    try {
      const id = await findId()
      if (id) setTpl(await emailTemplatesApi.get(id))
    } finally { setLoading(false) }
  }

  async function openPreview() {
    setLoading(true)
    try {
      const id = await findId()
      if (id) { const p = await emailTemplatesApi.preview(id); setPreview({ subject: p.subject, html: p.html }) }
    } finally { setLoading(false) }
  }

  async function handleSave(html: string, design: Record<string, unknown>) {
    if (!tpl) return
    setSaving(true)
    try {
      await emailTemplatesApi.update(tpl.id, {
        name: tpl.name, subject: tpl.subject, category: tpl.category,
        preheader: tpl.preheader, variables: tpl.variables, is_active: tpl.is_active,
        html, design,
      })
      setTpl(null)
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <button onClick={openEdit} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50">
          <Pencil size={13} /> {loading ? 'Yükleniyor…' : label}
        </button>
        <button onClick={openPreview} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <Eye size={13} /> Önizle
        </button>
      </div>

      {tpl && (
        <Suspense fallback={<div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center text-white text-sm">Editör yükleniyor…</div>}>
          <EmailEditor
            title={tpl.name}
            initialHtml={tpl.html}
            initialDesign={tpl.design}
            variables={tpl.variables ?? []}
            saving={saving}
            onSave={handleSave}
            onClose={() => setTpl(null)}
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
    </>
  )
}
