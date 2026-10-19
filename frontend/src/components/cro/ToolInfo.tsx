import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import clsx from 'clsx'
import type { CroTool } from '@/lib/croTools'

/* Aracın yanındaki ⓘ: üzerine gelince (mobilde dokununca) aracın mağazada nasıl göründüğünü gösteren
   ekran görüntüsü + tek cümle. Görseller frontend/public/tool-shots/{key}.webp (scripts/tool-shots ile üretilir). */
export default function ToolInfo({ tool, className }: { tool: CroTool; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const w = tool.shotWide ? 360 : tool.noShot ? 260 : 240

  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    // sağa sığmazsa sola aç; dikeyde ekrandan taşmasın
    const x = r.right + 10 + w > window.innerWidth ? Math.max(8, r.left - 10 - w) : r.right + 10
    const h = tool.noShot ? 90 : tool.shotWide ? 330 : 520
    const y = Math.min(Math.max(8, r.top - 40), window.innerHeight - h - 8)
    setPos({ x, y })
  }
  const hide = () => setPos(null)

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`${tool.label} nedir?`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show() }}
        className={clsx('inline-flex items-center justify-center w-5 h-5 rounded-full text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 shrink-0', className)}
      >
        <Info size={14} />
      </button>
      {pos && createPortal(
        <div
          style={{ left: pos.x, top: pos.y, width: w }}
          className="fixed z-[100] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden pointer-events-none"
        >
          {!tool.noShot && (
            <img
              src={`${import.meta.env.BASE_URL}tool-shots/${tool.key}.webp`}
              alt=""
              className={clsx('w-full bg-gray-50 object-cover object-top', tool.shotWide ? 'h-[250px]' : 'h-[440px]')}
            />
          )}
          <div className={clsx('px-3 py-2.5', !tool.noShot && 'border-t border-gray-100')}>
            <p className="text-[13px] font-semibold text-gray-900">{tool.label}</p>
            <p className="text-[12px] text-gray-500 leading-snug">{tool.desc}</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
