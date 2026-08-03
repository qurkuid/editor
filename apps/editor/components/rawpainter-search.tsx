'use client'

import { useT } from '@pascal-app/editor'
import { Search, X } from 'lucide-react'
import type { FormEvent } from 'react'

type RawPainterSearchProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onClear: () => void
}

export function RawPainterSearch({ value, onChange, onSubmit, onClear }: RawPainterSearchProps) {
  const t = useT()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form className="relative mt-2 flex items-center" onSubmit={submit}>
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <input
        aria-label={t('rawpainter.search.ariaLabel')}
        className="h-8 w-full rounded-lg border border-border/70 bg-background/80 pr-16 pl-8 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:ring-2 focus:ring-foreground/8"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('rawpainter.search.placeholder')}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label={t('rawpainter.search.clearAriaLabel')}
          className="absolute right-8 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClear}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
      <button
        aria-label={t('rawpainter.search.submit')}
        className="absolute right-1.5 rounded-md bg-foreground px-1.5 py-1 text-[9px] font-semibold text-background"
        type="submit"
      >
        {t('rawpainter.search.submit')}
      </button>
    </form>
  )
}
