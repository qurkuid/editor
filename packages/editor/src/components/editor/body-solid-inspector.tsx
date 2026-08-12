'use client'

import { type BodyNode, type BodySolidInspection, inspectBodySolid } from '@pascal-app/core'
import { useT } from '../../i18n/use-t'

type BodySolidInspectorProps = {
  body: BodyNode
  inspection?: BodySolidInspection
}

export function BodySolidInspector({
  body,
  inspection = inspectBodySolid(body),
}: BodySolidInspectorProps) {
  const t = useT()
  const rows = [
    [t('bodyModeling.solidValid'), inspection.validSolid],
    [t('bodyModeling.closed'), inspection.closed],
    [t('bodyModeling.manifold'), inspection.manifold],
    [t('bodyModeling.connected'), inspection.connected],
  ] as const
  return (
    <section
      aria-label={t('bodyModeling.inspectSolid')}
      className="pointer-events-auto mt-1 w-64 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-xl backdrop-blur-md"
      data-testid="body-solid-inspector"
    >
      <div className="mb-2 flex items-center justify-between font-medium">
        <span>{t('bodyModeling.inspectSolid')}</span>
        <span className={inspection.validSolid ? 'text-emerald-500' : 'text-destructive'}>
          {inspection.validSolid ? 'OK' : '!'}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value ? '✓' : '—'}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t('bodyModeling.volume')}</dt>
        <dd>{inspection.volume === null ? '—' : `${inspection.volume.toFixed(4)} m³`}</dd>
      </dl>
      {inspection.diagnostics.length > 0 ? (
        <div className="mt-2 border-t border-border/60 pt-2">
          <div className="mb-1 text-muted-foreground">{t('bodyModeling.diagnostics')}</div>
          <ul className="space-y-1" aria-label={t('bodyModeling.diagnostics')}>
            {inspection.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`}>
                <span className="font-medium">{diagnostic.code}</span>
                {diagnostic.featureIds.length > 0 ? ` · ${diagnostic.featureIds.join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
