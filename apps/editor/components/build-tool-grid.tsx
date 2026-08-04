import { useTLabel } from '@pascal-app/editor'
import Image from 'next/image'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import { cn } from '@/lib/utils'

export type BuildToolGridItem = {
  readonly iconSrc: string
  readonly id: string
  readonly label: string
}

type BuildToolGridProps = {
  readonly activeId: string | null
  readonly items: readonly BuildToolGridItem[]
  readonly onSelect: (id: string) => void
}

export function BuildToolGrid({ activeId, items, onSelect }: BuildToolGridProps) {
  const tLabel = useTLabel()
  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((item) => {
          const active = activeId === item.id
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  aria-label={tLabel(item.label)}
                  className={cn(
                    'group flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-all duration-200',
                    active
                      ? 'bg-primary/10 text-foreground ring-1 ring-primary/50'
                      : 'bg-muted/40 text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground hover:opacity-100',
                  )}
                  onClick={() => onSelect(item.id)}
                  type="button"
                >
                  <Image
                    alt=""
                    aria-hidden
                    className={cn(
                      'h-10 w-10 object-contain transition-all duration-200 group-hover:scale-105',
                      active ? 'grayscale-0' : 'grayscale group-hover:grayscale-0',
                    )}
                    height={40}
                    src={item.iconSrc}
                    width={40}
                  />
                  <span className="w-full truncate text-center font-medium text-[10px] leading-3">
                    {tLabel(item.label)}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none" side="top">
                {tLabel(item.label)}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
