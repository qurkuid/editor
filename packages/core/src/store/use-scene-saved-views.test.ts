import { beforeEach, describe, expect, test } from 'bun:test'
import type { SavedView } from '../schema/saved-views'
import useScene from './use-scene'

const VIEW: SavedView = {
  id: 'view-1',
  name: 'Kitchen corner',
  pose: {
    position: [4, 1.6, 2],
    target: [0, 1.6, 0],
    projection: 'perspective',
    fov: 55,
  },
}

describe('saved views', () => {
  beforeEach(() => {
    useScene.getState().unloadScene()
    useScene.setState({ readOnly: false })
  })

  test('add / update / remove round-trip', () => {
    useScene.getState().addSavedView(VIEW)
    expect(useScene.getState().savedViews).toEqual([VIEW])

    useScene.getState().updateSavedView('view-1', { name: 'Renamed' })
    expect(useScene.getState().savedViews[0]!.name).toBe('Renamed')
    expect(useScene.getState().savedViews[0]!.pose).toEqual(VIEW.pose)

    useScene.getState().removeSavedView('view-1')
    expect(useScene.getState().savedViews).toEqual([])
  })

  test('readOnly blocks all saved-view writes', () => {
    useScene.getState().addSavedView(VIEW)
    useScene.setState({ readOnly: true })

    useScene.getState().addSavedView({ ...VIEW, id: 'view-2' })
    useScene.getState().updateSavedView('view-1', { name: 'Nope' })
    useScene.getState().removeSavedView('view-1')

    expect(useScene.getState().savedViews).toEqual([VIEW])
  })

  test('setScene loads savedViews from extra and defaults to empty', () => {
    useScene.getState().setScene({}, [], { savedViews: [VIEW] })
    expect(useScene.getState().savedViews).toEqual([VIEW])

    // An older payload without the field clears them — views belong to
    // the loaded document.
    useScene.getState().setScene({}, [], {})
    expect(useScene.getState().savedViews).toEqual([])
  })

  test('geometry undo does not touch saved views', () => {
    useScene.getState().setScene({}, [], {})
    useScene.temporal.getState().clear()

    useScene.getState().addSavedView(VIEW)
    // A tracked write (collections participate in history), then undo it.
    useScene.getState().createCollection('Sofa wall')
    expect(Object.keys(useScene.getState().collections)).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(Object.keys(useScene.getState().collections)).toHaveLength(0)
    // The saved view survives — it is outside the temporal snapshot.
    expect(useScene.getState().savedViews).toEqual([VIEW])
  })
})
