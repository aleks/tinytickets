import { Search, X } from 'lucide-react'

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (s: string) => void
  placeholder: string
}) {
  return (
    <label className="search">
      <Search size={14} />
      <input
        aria-label={placeholder.replace('…', '')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-button" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </label>
  )
}
