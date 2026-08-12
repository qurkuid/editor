import {
  type AnyNodeId,
  cloneComponentInstance,
  createBodyGroupFromBodies,
  createComponentFromBodies,
  explodeComponent,
  isBodyContainerNode,
  makeComponentUnique,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'

export function commitBodyGroup(bodyIds: readonly AnyNodeId[]): AnyNodeId | null {
  const scene = useScene.getState()
  const write = createBodyGroupFromBodies(scene.nodes, bodyIds)
  runAsSingleSceneHistoryStep(useScene, () => {
    scene.createNode(write.container, (write.container.parentId as AnyNodeId | null) ?? undefined)
    scene.updateNodes(
      write.bodyUpdates.map((update) => ({ id: update.id as AnyNodeId, data: update.data })),
    )
  })
  return write.container.id
}

export function commitBodyComponent(bodyIds: readonly AnyNodeId[]): AnyNodeId | null {
  const scene = useScene.getState()
  const write = createComponentFromBodies(scene.nodes, bodyIds)
  runAsSingleSceneHistoryStep(useScene, () => {
    scene.createNode(write.container, (write.container.parentId as AnyNodeId | null) ?? undefined)
    scene.updateNodes(
      write.bodyUpdates.map((update) => ({ id: update.id as AnyNodeId, data: update.data })),
    )
  })
  return write.container.id
}

export function commitComponentInstance(sourceId: AnyNodeId): AnyNodeId | null {
  const scene = useScene.getState()
  const clone = cloneComponentInstance(scene.nodes, sourceId)
  runAsSingleSceneHistoryStep(useScene, () => {
    scene.createNodes(
      clone.nodes.map((node) => ({
        node,
        parentId: (node.parentId as AnyNodeId | null) ?? undefined,
      })),
    )
  })
  return clone.rootId
}

export function commitMakeComponentUnique(componentId: AnyNodeId): void {
  const scene = useScene.getState()
  const update = makeComponentUnique(scene.nodes, componentId)
  runAsSingleSceneHistoryStep(useScene, () => scene.updateNode(update.id, update.data))
}

export function enterBodyContainerEdit(containerId: AnyNodeId): AnyNodeId | null {
  const scene = useScene.getState()
  const container = scene.nodes[containerId]
  if (!isBodyContainerNode(container)) return null

  useEditor.getState().enterBodyContainerEdit(container.id)
  const firstChildId =
    container.children.find((childId) => scene.nodes[childId]?.type === 'body') ?? container.id
  useViewer.getState().setSelection({ selectedIds: [firstChildId] })
  return firstChildId
}

export function exitBodyContainerEdit(): AnyNodeId | null {
  const containerId = useEditor.getState().activeBodyContainerId
  if (!containerId) return null

  useEditor.getState().exitBodyContainerEdit()
  if (useScene.getState().nodes[containerId]) {
    useViewer.getState().setSelection({ selectedIds: [containerId] })
  }
  return containerId
}

export function commitExplodeComponent(componentId: AnyNodeId): readonly AnyNodeId[] {
  const scene = useScene.getState()
  const result = explodeComponent(scene.nodes, componentId)
  runAsSingleSceneHistoryStep(useScene, () => {
    scene.updateNodes(
      result.bodyUpdates.map((update) => ({ id: update.id as AnyNodeId, data: update.data })),
    )
    scene.deleteNode(result.componentId)
  })
  return result.bodyUpdates.map((update) => update.id)
}
