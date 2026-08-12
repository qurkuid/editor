import {
  type AnyNodeId,
  type BodyCircularArrayInput,
  type BodyLinearArrayInput,
  type BodyNode,
  createBodyCircularArray,
  createBodyLinearArray,
  useScene,
} from '@pascal-app/core'

export type BodyArrayRequest =
  | { readonly kind: 'linear'; readonly input: BodyLinearArrayInput }
  | { readonly kind: 'circular'; readonly input: BodyCircularArrayInput }

export function commitBodyArray(body: BodyNode, request: BodyArrayRequest): AnyNodeId[] {
  const clones =
    request.kind === 'linear'
      ? createBodyLinearArray(body, request.input)
      : createBodyCircularArray(body, request.input)

  useScene.getState().createNodes(
    clones.map((node) => ({
      node,
      parentId: body.parentId as AnyNodeId | undefined,
    })),
  )

  return clones.map((node) => node.id)
}
