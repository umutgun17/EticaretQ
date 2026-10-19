import type { WheelDesign, WheelSlice } from './wheelApi'

/**
 * Hazır çark tasarım şablonları. Müşteri panelden birini seçer; renk ayarlarıyla
 * uğraşmaz. Seçince şablonun renkleri design'a yazılır ve dilimler paletten renklenir.
 * Widget (wheel.js) yalnızca somut renkleri okur — şablon mantığı burada (panelde) kalır.
 */
export interface WheelTemplate {
  id: string
  name: string
  description: string
  /** design'a uygulanan somut renkler (logo/metinler şablondan bağımsız korunur). */
  design: Pick<WheelDesign, 'primary_color' | 'primary_2' | 'accent_color' | 'text_color' | 'pointer_color'>
  /** dilim renkleri — sırayla (cycle) uygulanır. */
  palette: string[]
}

export const WHEEL_TEMPLATES: WheelTemplate[] = [
  {
    id: 'mono',
    name: 'Mono (Siyah-Beyaz)',
    description: 'Minimal lüks (Bambi tarzı): siyah-beyaz dilimler, siyah halka + beyaz noktalar, açık gri modal.',
    design: { primary_color: '#ededed', primary_2: '#e4e4e7', accent_color: '#111111', text_color: '#1f2937', pointer_color: '#111111' },
    palette: ['#111111', '#ffffff'],
  },
  {
    id: 'royal',
    name: 'Royal (Lacivert-Altın)',
    description: 'Asil ve premium: lacivert zemin, altın halka ve gösterge.',
    design: { primary_color: '#1e3a8a', primary_2: '#0f172a', accent_color: '#fbbf24', text_color: '#ffffff', pointer_color: '#fbbf24' },
    palette: ['#1e3a8a', '#fbbf24', '#172554', '#eab308'],
  },
  {
    id: 'festive',
    name: 'Şenlik (Çok Renkli)',
    description: 'Canlı ve eğlenceli: çok renkli dilimler, altın halka.',
    design: { primary_color: '#e11d48', primary_2: '#9f1239', accent_color: '#fbbf24', text_color: '#ffffff', pointer_color: '#111827' },
    palette: ['#e11d48', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
  },
  {
    id: 'pastel',
    name: 'Pastel (Yumuşak)',
    description: 'Modern ve sakin: yumuşak pastel tonlar, açık zemin.',
    design: { primary_color: '#fbcfe8', primary_2: '#ddd6fe', accent_color: '#a78bfa', text_color: '#3f3f46', pointer_color: '#7c3aed' },
    palette: ['#f9a8d4', '#c4b5fd', '#93c5fd', '#86efac', '#fde68a', '#fca5a5'],
  },
  {
    id: 'sunset',
    name: 'Sunset (Turuncu-Pembe)',
    description: 'Sıcak ve dikkat çekici: turuncu-pembe gradyan, açık altın halka.',
    design: { primary_color: '#f97316', primary_2: '#db2777', accent_color: '#fde68a', text_color: '#ffffff', pointer_color: '#7c2d12' },
    palette: ['#fb923c', '#f472b6', '#fbbf24', '#fb7185', '#fdba74', '#f9a8d4'],
  },
]

export function getTemplate(id?: string | null): WheelTemplate {
  return WHEEL_TEMPLATES.find((t) => t.id === id) ?? WHEEL_TEMPLATES[0]
}

/**
 * Şablonu kampanyaya uygular: design renklerini set eder ve dilimleri paletten renklendirir.
 * Etiket/değer/ağırlık gibi içerik DEĞİŞMEZ — yalnızca görsel.
 */
export function applyTemplate(
  template: WheelTemplate,
  design: WheelDesign,
  slices: WheelSlice[],
): { design: WheelDesign; slices: WheelSlice[] } {
  return {
    design: { ...design, ...template.design, template: template.id },
    slices: slices.map((s, i) => ({ ...s, color: template.palette[i % template.palette.length] })),
  }
}
