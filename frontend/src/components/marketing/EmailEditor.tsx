import { useEffect, useRef, useState } from 'react'
import grapesjs, { type Editor } from 'grapesjs'
import presetNewsletter from 'grapesjs-preset-newsletter'
import 'grapesjs/dist/css/grapes.min.css'
import { X, Save, Code2, Copy } from 'lucide-react'

interface Props {
  initialHtml?: string | null
  initialDesign?: Record<string, unknown> | null
  variables?: string[]
  onSave: (html: string, design: Record<string, unknown>) => void | Promise<void>
  onClose: () => void
  title?: string
  saving?: boolean
}

/**
 * GrapesJS tabanlı sürükle-bırak e-posta editörü (newsletter preset).
 * Kaydederken inline-stilli HTML + tekrar düzenleme için proje JSON'u döner.
 */
export default function EmailEditor({
  initialHtml, initialDesign, variables = [], onSave, onClose, title = 'E-posta Şablonu', saving = false,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!elRef.current) return

    const editor = grapesjs.init({
      container: elRef.current,
      height: '100%',
      fromElement: false,
      storageManager: false,
      plugins: [presetNewsletter],
      pluginsOpts: {
        'grapesjs-preset-newsletter': {
          modalTitleImport: 'HTML içe aktar',
          modalTitleExport: 'HTML kaynağı',
          codeViewerTheme: 'material',
        },
      },
    })
    editorRef.current = editor

    // İçeriği yükle: önce proje verisi (yeniden düzenleme), yoksa HTML
    if (initialDesign && Object.keys(initialDesign).length > 0) {
      try { editor.loadProjectData(initialDesign) } catch { editor.setComponents(initialHtml ?? '') }
    } else if (initialHtml) {
      editor.setComponents(initialHtml)
    }

    return () => { editor.destroy(); editorRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    const editor = editorRef.current
    if (!editor) return
    // Inline-stilli HTML (e-posta uyumu); preset komutu yoksa css+html birleştir
    let html = ''
    try {
      html = (editor.runCommand('gjs-get-inlined-html') as string) || ''
    } catch { /* yoksa fallback */ }
    if (!html) {
      const css = editor.getCss()
      html = `<style>${css}</style>${editor.getHtml()}`
    }
    const design = editor.getProjectData() as Record<string, unknown>
    onSave(html, design)
  }

  function showCode() {
    editorRef.current?.runCommand('gjs-open-code')
  }

  function copyVar(v: string) {
    const token = `{{${v}}}`
    navigator.clipboard?.writeText(token)
    setCopied(v)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex flex-col">
      <div className="bg-white flex-1 flex flex-col m-0 md:m-4 md:rounded-xl overflow-hidden shadow-2xl">
        {/* Üst bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-gray-50">
          <span className="font-medium text-gray-900 text-sm">{title}</span>
          {variables.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap ml-2">
              <span className="text-[11px] text-gray-400">Değişkenler (kopyala-yapıştır):</span>
              {variables.map((v) => (
                <button
                  key={v}
                  onClick={() => copyVar(v)}
                  title="Kopyala"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-mono hover:bg-indigo-100"
                >
                  {copied === v ? 'kopyalandı ✓' : <>{`{{${v}}}`}<Copy size={9} /></>}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={showCode} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-100">
              <Code2 size={15} /> HTML
            </button>
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
              <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200">
              <X size={18} />
            </button>
          </div>
        </div>
        {/* Editör */}
        <div className="flex-1 min-h-0">
          <div ref={elRef} style={{ height: '100%' }} />
        </div>
      </div>
    </div>
  )
}
