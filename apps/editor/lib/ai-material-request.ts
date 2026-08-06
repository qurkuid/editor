'use client'

import { useEditor, useSidebarStore } from '@pascal-app/editor'
import { create } from 'zustand'

/** Material handed to the modeling agent from a catalog tile's AI button. */
export type AiMaterialContext = {
  readonly name: string
  /** Paintable ref the agent can put in a node's slots, e.g. `library:rawpainter:123`. */
  readonly ref: string
  readonly description?: string
}

type AiMaterialRequestState = {
  pending: AiMaterialContext | null
  clear: () => void
}

const useAiMaterialRequest = create<AiMaterialRequestState>()((set) => ({
  pending: null,
  clear: () => set({ pending: null }),
}))

/** Queue a material for the modeling agent and jump to the AI sidebar tab. */
export function requestAiMaterialApply(context: AiMaterialContext) {
  useAiMaterialRequest.setState({ pending: context })
  useSidebarStore.getState().setIsCollapsed(false)
  useEditor.getState().setActiveSidebarPanel('ai')
}

export default useAiMaterialRequest
