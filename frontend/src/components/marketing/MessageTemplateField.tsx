/**
 * Düzenlenebilir mesaj şablonu alanı (SMS/WhatsApp) — değişken çipleri + karakter sayacı.
 * Değişkenler tıklanınca metnin sonuna eklenir; boş bırakılırsa varsayılan metin kullanılır.
 */
export default function MessageTemplateField({ value, onChange, placeholder, channel, vars, note }:
  { value: string; onChange: (v: string) => void; placeholder: string; channel: 'sms' | 'whatsapp'; vars: string[]; note?: string }) {
  const max = channel === 'sms' ? 500 : 1000
  const insert = (v: string) => onChange((value || '') + `{{${v}}}`)
  return (
    <div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} maxLength={max}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y" />
      <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1">
          {vars.map((v) => (
            <button key={v} type="button" onClick={() => insert(v)}
              className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-mono hover:bg-indigo-100">{`{{${v}}}`}</button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">
          {(value || '').length} karakter{channel === 'sms' && (value || '').length > 0 ? ` · ~${Math.ceil((value || '').length / 160)} SMS` : ''}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{note ?? 'Boş bırakılırsa varsayılan metin kullanılır. Değişkenler otomatik doldurulur.'}</p>
    </div>
  )
}
