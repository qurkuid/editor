'use client'

import { emitter, type SavedView, useScene } from '@pascal-app/core'
import { DEFAULT_FOV, useViewer } from '@pascal-app/viewer'
import { Camera, Footprints, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cameraPoseStore } from '../../../../store/camera-pose-store'
import { useWalkToPoint } from '../../../editor/walk-to-point'
import { SliderControl } from '../../controls/slider-control'
import { Button } from '../../primitives/button'

/**
 * Views panel — SketchUp-style scenes. Save the current camera viewpoint
 * under a name, jump back to it later (smoothly interpolated through
 * `camera-controls:apply-pose`), adjust the perspective FOV, and arm the
 * one-shot walk-to-point mode.
 */
export function ViewsPanel() {
  const savedViews = useScene((s) => s.savedViews)
  const readOnly = useScene((s) => s.readOnly)
  const fov = useViewer((s) => s.fov)
  const setFov = useViewer((s) => s.setFov)
  const cameraMode = useViewer((s) => s.cameraMode)
  const walkArmed = useWalkToPoint((s) => s.armed)
  const setWalkArmed = useWalkToPoint((s) => s.setArmed)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const handleSaveView = useCallback(() => {
    const pose = cameraPoseStore.getState().pose
    if (!pose) return
    const count = useScene.getState().savedViews.length
    useScene.getState().addSavedView({
      id: crypto.randomUUID(),
      name: `View ${count + 1}`,
      pose,
    })
  }, [])

  const handleApply = useCallback((view: SavedView) => {
    emitter.emit('camera-controls:apply-pose', view.pose)
  }, [])

  const handleUpdateToCurrent = useCallback((id: string) => {
    const pose = cameraPoseStore.getState().pose
    if (!pose) return
    useScene.getState().updateSavedView(id, { pose })
  }, [])

  const handleDelete = useCallback((id: string) => {
    useScene.getState().removeSavedView(id)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId) {
      const name = draftName.trim()
      if (name) useScene.getState().updateSavedView(editingId, { name })
    }
    setEditingId(null)
  }, [draftName, editingId])

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div>
        <h2 className="mb-2 font-semibold text-sidebar-foreground text-sm">Camera</h2>
        <SliderControl
          label="Field of view"
          max={120}
          min={20}
          onChange={setFov}
          precision={0}
          step={1}
          unit="°"
          value={fov}
        />
        <div className="mt-1 flex items-center justify-between px-2">
          <span className="text-[11px] text-sidebar-foreground/50">
            {cameraMode === 'orthographic'
              ? 'Applies in perspective projection'
              : `${DEFAULT_FOV}° ≈ human eye`}
          </span>
          {fov !== DEFAULT_FOV && (
            <button
              className="text-[11px] text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={() => setFov(DEFAULT_FOV)}
              type="button"
            >
              Reset to {DEFAULT_FOV}°
            </button>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold text-sidebar-foreground text-sm">Move</h2>
        <Button
          className="w-full justify-start gap-2"
          onClick={() => setWalkArmed(!walkArmed)}
          size="sm"
          variant={walkArmed ? 'default' : 'outline'}
        >
          <Footprints className="h-4 w-4" />
          {walkArmed ? 'Click a spot in the 3D view…' : 'Walk to point'}
        </Button>
        <p className="mt-1 px-1 text-[11px] text-sidebar-foreground/50">
          {walkArmed
            ? 'Esc to cancel'
            : 'Then click anywhere in the scene to stand there at eye height.'}
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-sidebar-foreground text-sm">Saved views</h2>
          <Button
            className="gap-1.5"
            disabled={readOnly}
            onClick={handleSaveView}
            size="sm"
            variant="outline"
          >
            <Plus className="h-3.5 w-3.5" />
            Save view
          </Button>
        </div>

        {savedViews.length === 0 ? (
          <div className="rounded-lg border border-sidebar-foreground/10 border-dashed px-3 py-6 text-center text-sidebar-foreground/50 text-xs">
            No saved views yet. Frame a shot, then “Save view” — click a saved view any time to
            fly back to it.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {savedViews.map((view) => (
              <div
                className="group flex items-center gap-1 rounded-lg border border-transparent p-1.5 transition-colors hover:bg-accent/40"
                key={view.id}
              >
                {editingId === view.id ? (
                  <input
                    autoFocus
                    className="h-7 min-w-0 flex-1 rounded-md bg-background/60 px-2 text-sidebar-foreground text-xs outline-none ring-1 ring-primary/40"
                    onBlur={commitRename}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    value={draftName}
                  />
                ) : (
                  <button
                    className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left"
                    onClick={() => handleApply(view)}
                    onDoubleClick={() => {
                      if (readOnly) return
                      setEditingId(view.id)
                      setDraftName(view.name)
                    }}
                    title="Click to fly to this view · double-click to rename"
                    type="button"
                  >
                    <Camera className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
                    <span className="truncate text-sidebar-foreground text-xs">{view.name}</span>
                  </button>
                )}
                <button
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 opacity-0 transition-opacity hover:bg-accent hover:text-sidebar-foreground group-hover:opacity-100"
                  disabled={readOnly}
                  onClick={() => handleUpdateToCurrent(view.id)}
                  title="Update to current view"
                  type="button"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                  disabled={readOnly}
                  onClick={() => handleDelete(view.id)}
                  title="Delete view"
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
