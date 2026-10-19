import { useMemo } from 'react'
import type { WheelSlice, WheelDesign } from '@/lib/wheelApi'

/** Dilim doluluğuna göre okunur yazı rengi (mono temada şart). */
function contrastText(hex: string): string {
  try {
    let h = hex.replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111111' : '#ffffff'
  } catch {
    return '#ffffff'
  }
}

/**
 * Çarkın statik SVG önizlemesi (panel için). Dilimleri eşit açılarla çizer; gerçek
 * çevirme animasyonu embeddable widget'ta (public/widget/wheel.js) yapılır.
 */
export default function WheelPreview({
  slices,
  design,
  size = 280,
}: {
  slices: WheelSlice[]
  design: WheelDesign
  size?: number
}) {
  const segments = useMemo(() => {
    const n = Math.max(slices.length, 1)
    const angle = 360 / n
    const r = size / 2
    const cx = r
    const cy = r

    return slices.map((slice, i) => {
      const start = i * angle - 90
      const end = start + angle
      const startRad = (start * Math.PI) / 180
      const endRad = (end * Math.PI) / 180
      const x1 = cx + r * Math.cos(startRad)
      const y1 = cy + r * Math.sin(startRad)
      const x2 = cx + r * Math.cos(endRad)
      const y2 = cy + r * Math.sin(endRad)
      const largeArc = angle > 180 ? 1 : 0
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`

      // Etiket konumu (dilimin orta açısı, merkezden %62 uzakta)
      const midRad = ((start + angle / 2) * Math.PI) / 180
      const lr = r * 0.62
      const lx = cx + lr * Math.cos(midRad)
      const ly = cy + lr * Math.sin(midRad)
      const rotation = start + angle / 2

      return {
        path,
        color: slice.color || '#e5e7eb',
        label: slice.label,
        lx,
        ly,
        rotation,
      }
    })
  }, [slices, size])

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Üst gösterge oku */}
        <div
          className="absolute left-1/2 -translate-x-1/2 z-10"
          style={{
            top: -6,
            width: 0,
            height: 0,
            borderLeft: '12px solid transparent',
            borderRight: '12px solid transparent',
            borderTop: `20px solid ${design.pointer_color || '#111827'}`,
          }}
        />
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow">
          {segments.map((seg, i) => (
            <g key={i}>
              <path d={seg.path} fill={seg.color} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
              <text
                x={seg.lx}
                y={seg.ly}
                fill={contrastText(seg.color)}
                fontSize={slices.length > 8 ? 9 : 11}
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${seg.rotation}, ${seg.lx}, ${seg.ly})`}
              >
                {seg.label.length > 14 ? seg.label.slice(0, 13) + '…' : seg.label}
              </text>
            </g>
          ))}
          {/* Dış halka (düz) + eşit aralıklı beyaz noktalar */}
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 7} fill="none" stroke={design.accent_color || '#111111'} strokeWidth={12} />
          {Array.from({ length: Math.max(24, slices.length * 6) }).map((_, i, arr) => {
            const a = (i / arr.length) * Math.PI * 2
            const rr = size / 2 - 7
            return <circle key={`d${i}`} cx={size / 2 + rr * Math.cos(a)} cy={size / 2 + rr * Math.sin(a)} r={1.8} fill={contrastText(design.accent_color || '#111111')} />
          })}
          {/* Merkez göbek + logo */}
          <circle cx={size / 2} cy={size / 2} r={size * 0.12} fill="#ffffff" stroke="rgba(0,0,0,0.12)" strokeWidth={2} />
          {design.logo_url && (
            <>
              <clipPath id="yw-hub-clip">
                <circle cx={size / 2} cy={size / 2} r={size * 0.1} />
              </clipPath>
              <image
                href={design.logo_url}
                x={size / 2 - size * 0.1}
                y={size / 2 - size * 0.1}
                width={size * 0.2}
                height={size * 0.2}
                clipPath="url(#yw-hub-clip)"
                preserveAspectRatio="xMidYMid meet"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  )
}
