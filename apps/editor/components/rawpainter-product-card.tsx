import { useT } from '@pascal-app/editor'
import { BadgeDollarSign, Check } from 'lucide-react'
import type { RawPainterProduct } from '@/lib/rawpainter-contract'

type RawPainterProductCardProps = {
  readonly product: RawPainterProduct
  readonly selected: boolean
  readonly onSelect: (product: RawPainterProduct) => void
}

// Real vendor pricing in KRW — locale-invariant, not UI copy.
function productPrice(product: RawPainterProduct, priceInquiryLabel: string): string {
  const value = product.price ?? product.options?.[0]?.price
  const price = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(price) ? `${price.toLocaleString('ko-KR')}원` : priceInquiryLabel
}

export function RawPainterProductCard({ product, selected, onSelect }: RawPainterProductCardProps) {
  const t = useT()
  const image = product.thumbnailUrl ?? product.image ?? product.img
  const brand = product.brand?.trim() || t('rawpainter.card.unbrandedLabel')
  const store = product.store?.trim() || t('rawpainter.card.unlistedStore')
  const size = product.options?.[0]?.size?.trim() || t('rawpainter.card.noSizeInfo')

  return (
    <button
      aria-label={t('rawpainter.card.selectAriaLabel').replace(
        '{name}',
        product.name ?? t('rawpainter.card.unnamedMaterial'),
      )}
      className={`group overflow-hidden rounded-xl border text-left transition-all ${
        selected
          ? 'border-primary bg-primary/8 shadow-[0_0_0_1px_var(--primary)]'
          : 'border-border/70 bg-background/65 hover:border-foreground/35 hover:bg-sidebar-accent'
      }`}
      onClick={() => onSelect(product)}
      type="button"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {image ? (
          <img
            alt={product.name ?? t('rawpainter.card.altFallback')}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            src={image}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            {t('rawpainter.card.noImage')}
          </div>
        )}
        {selected ? (
          <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white backdrop-blur">
          {product.category || t('rawpainter.card.otherCategory')}
        </span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="line-clamp-2 min-h-8 font-semibold text-xs leading-4">
          {product.name || `RawPainter ${product.id}`}
        </p>
        <div className="space-y-0.5 text-[10px] text-muted-foreground">
          <p className="truncate">{brand}</p>
          <p className="truncate">{store}</p>
          <p className="truncate">{size}</p>
        </div>
        <p className="flex items-center gap-1 font-semibold text-[11px] text-foreground">
          <BadgeDollarSign className="h-3 w-3" />
          {productPrice(product, t('rawpainter.card.priceInquiry'))}
        </p>
      </div>
    </button>
  )
}
