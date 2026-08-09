'use client'

import { useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { useBodyToolOptions } from './options'

export function useBodyFaceDraftLifecycle(bodyId: string, faceId: string, valid: boolean): void {
  useEffect(() => {
    const draft = { bodyId, faceId }
    return () => useBodyToolOptions.getState().clearFaceDraftIfMatches(draft)
  }, [bodyId, faceId])

  useEffect(() => {
    if (valid) return
    useBodyToolOptions.getState().clearFaceDraftIfMatches({ bodyId, faceId })
    useEditor.getState().setTool(null)
    useEditor.getState().setMode('select')
  }, [bodyId, faceId, valid])
}
