'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { formatAreaLabel } from '../../../lib/measurements'
import { resolveRelatedZonesForNode } from '../../../lib/zone-content'
import { PanelSection } from '../controls/panel-section'

const ENCLOSURE_LABEL: Record<string, string> = {
  auto: '자동 감지',
  enclosed: '구획됨',
  open: '개방',
}

export function RelatedZonePanel({ nodeId }: { nodeId: AnyNodeId }) {
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((state) => state.unit)
  const zones = useMemo(() => resolveRelatedZonesForNode(nodes, nodeId), [nodeId, nodes])

  if (zones.length === 0) return null

  return (
    <PanelSection title="소속 구역">
      <div className="grid gap-1.5" data-testid="related-zone-list">
        {zones.map((zone) => (
          <div
            className="rounded-md border border-border/60 bg-background/35 px-2.5 py-2"
            key={zone.id}
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 truncate font-medium text-foreground text-xs">
                {zone.name || '이름 없는 Zone'}
              </span>
              {zone.roomNumber ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {zone.roomNumber}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatAreaLabel(zone.area, unit, 2)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{ENCLOSURE_LABEL[zone.enclosureStatus] ?? zone.enclosureStatus}</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{zone.occupancy || '용도 미지정'}</span>
            </div>
          </div>
        ))}
      </div>
    </PanelSection>
  )
}
