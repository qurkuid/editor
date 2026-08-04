'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { BuildTab } from './build-tab'
import { BuildWorkflowGuide } from './build-workflow-guide'

export function GuidedBuildTab() {
  const activeTool = useEditor((state) => state.tool)
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const mode = useEditor((state) => state.mode)
  const guideMode = mode === 'build' || mode === 'material-paint' ? mode : 'hidden'
  const activeLabel =
    mode === 'build' && activeTool
      ? (nodeRegistry.get(activeTool)?.presentation?.label ?? activeTool)
      : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-20 shrink-0 bg-sidebar/95 px-3 pt-3 pb-2 backdrop-blur">
        <BuildWorkflowGuide
          activeLabel={activeLabel}
          activeTool={mode === 'build' ? activeTool : null}
          hasPaintMaterial={activePaintMaterial !== null}
          mode={guideMode}
        />
      </div>
      <div className="min-h-0 flex-1">
        <BuildTab />
      </div>
    </div>
  )
}
