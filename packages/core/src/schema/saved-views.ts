import type { CameraPose } from '../events/bus'

export type SavedViewId = string

/**
 * A named camera viewpoint saved with the document — SketchUp-style
 * "scene". Applying one replays its `CameraPose` (position / target /
 * projection / fov / viewWidth) through `camera-controls:apply-pose`.
 * Deliberately outside undo history: camera bookmarks shouldn't be
 * swept away by geometry undo.
 */
export type SavedView = {
  id: SavedViewId
  name: string
  pose: CameraPose
}
