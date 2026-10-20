import type { ReactNode } from 'react'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  title?: string
  testid?: string
}

/** One joined row of square buttons. The active segment uses the accent colour. */
export function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Segment<T>[]
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div className="paint-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" className={value === o.value ? 'on' : ''} title={o.title} data-testid={o.testid} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}
