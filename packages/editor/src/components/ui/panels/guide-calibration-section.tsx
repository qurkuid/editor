'use client'

import type { GuideNode } from '@pascal-app/core'
import { Crosshair, ScanLine } from 'lucide-react'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { useGuidePerspectiveCalibration } from './use-guide-perspective-calibration'
import { useGuideSurfacePlacement } from './use-guide-surface-placement'
import { useT } from '../../../i18n/use-t'

export function GuideCalibrationSection({
  guide,
  onUpdate,
}: {
  readonly guide: GuideNode
  readonly onUpdate: (patch: Partial<GuideNode>) => void
}) {
  const t = useT()
  const perspective = useGuidePerspectiveCalibration(guide, onUpdate)
  const surface = useGuideSurfacePlacement(guide, onUpdate)
  const startPerspective = () => {
    surface.cancel()
    perspective.start()
  }
  const startSurfacePlacement = () => {
    perspective.cancel()
    surface.start()
  }

  return (
    <PanelSection title={t('panel.imageCorrection')}>
      <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-muted-foreground text-xs leading-snug">
        {perspective.isCalibrating
          ? `Click the ${perspective.nextCorner} corner on the image (${perspective.pointsCollected + 1}/4).`
          : guide.perspectiveCorners
            ? 'Perspective corrected with four image corners.'
            : 'Straighten a photographed plan by selecting its four corners.'}
      </div>
      <ActionGroup>
        <ActionButton
          icon={<ScanLine className="h-3.5 w-3.5" />}
          label={
            perspective.isCalibrating
              ? 'Cancel 4-Point'
              : guide.perspectiveCorners
                ? 'Recalibrate'
                : '4-Point Correct'
          }
          onClick={perspective.isCalibrating ? perspective.cancel : startPerspective}
        />
        {guide.perspectiveCorners && !perspective.isCalibrating && (
          <ActionButton
            label={t('panel.reset')}
            onClick={() => onUpdate({ perspectiveCorners: null })}
          />
        )}
      </ActionGroup>

      <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-muted-foreground text-xs leading-snug">
        {surface.isPlacing
          ? 'Click a wall, floor, slab, ceiling, roof, or object surface.'
          : 'Place and align this image directly on any model surface.'}
      </div>
      <ActionGroup>
        <ActionButton
          icon={<Crosshair className="h-3.5 w-3.5" />}
          label={surface.isPlacing ? 'Cancel Placement' : 'Place on Surface'}
          onClick={surface.isPlacing ? surface.cancel : startSurfacePlacement}
        />
      </ActionGroup>
    </PanelSection>
  )
}
