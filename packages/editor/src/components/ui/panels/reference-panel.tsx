'use client'

import {
  type AnyNode,
  type GuideNode,
  loadAssetUrl,
  type ScanNode,
  saveAsset,
  useScene,
} from '@pascal-app/core'
import {
  Eye,
  EyeOff,
  Lock,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { guideEmitter } from '../../../lib/guide-events'
import { getGuideImageName } from '../../../lib/local-guide-image'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { GuideCalibrationSection } from './guide-calibration-section'
import { PanelWrapper } from './panel-wrapper'
import { ReferenceScaleSection } from './reference-scale-section'
import { ReferenceTransformSections } from './reference-transform-sections'
import { useT } from '../../../i18n/use-t'

type ReferenceNode = ScanNode | GuideNode

export function ReferencePanel() {
  const t = useT()
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const guideUi = useEditor((s) =>
    selectedReferenceId ? s.guideUi[selectedReferenceId] : undefined,
  )
  const setGuideLocked = useEditor((s) => s.setGuideLocked)
  const setGuideScaleReferenceVisible = useEditor((s) => s.setGuideScaleReferenceVisible)
  const clearGuideUi = useEditor((s) => s.clearGuideUi)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [isReplacing, setIsReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [isAssetMissing, setIsAssetMissing] = useState(false)

  const node = useScene((s) =>
    selectedReferenceId
      ? (s.nodes[selectedReferenceId as AnyNode['id']] as ReferenceNode | undefined)
      : undefined,
  )
  const isScaleFlowActive = useEditor(
    (s) => s.referenceScaleActiveGuideId !== null && s.referenceScaleActiveGuideId === node?.id,
  )

  const handleUpdate = useCallback(
    (updates: Partial<ReferenceNode>) => {
      if (!selectedReferenceId) return
      updateNode(selectedReferenceId as AnyNode['id'], updates)
    },
    [selectedReferenceId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelectedReferenceId(null)
  }, [setSelectedReferenceId])

  const handleReplaceFile = useCallback(
    async (file: File) => {
      if (!(selectedReferenceId && node?.type === 'guide')) {
        return
      }

      if (!file.type.startsWith('image/')) {
        setReplaceError('Choose a PNG, JPEG, or WebP image.')
        return
      }

      setIsReplacing(true)
      setReplaceError(null)

      try {
        const assetUrl = await saveAsset(file)
        updateNode(
          selectedReferenceId as AnyNode['id'],
          {
            name: getGuideImageName(file.name),
            url: assetUrl,
            scaleReference: null,
            perspectiveCorners: null,
          } as Partial<GuideNode>,
        )
        setGuideScaleReferenceVisible(selectedReferenceId, true)
        // The new image starts uncalibrated — drop the calibration auto-lock
        // so it can be resized/rotated right away.
        setGuideLocked(selectedReferenceId, false)
      } catch {
        setReplaceError('Could not replace that image.')
      } finally {
        setIsReplacing(false)
      }
    },
    [node?.type, selectedReferenceId, setGuideScaleReferenceVisible, updateNode],
  )

  const handleDeleteGuide = useCallback(() => {
    if (!(selectedReferenceId && node?.type === 'guide')) {
      return
    }

    deleteNode(selectedReferenceId as AnyNode['id'])
    guideEmitter.emit('guide:deleted', { guideId: selectedReferenceId as GuideNode['id'] })
    clearGuideUi(selectedReferenceId)
    setSelectedReferenceId(null)
  }, [clearGuideUi, deleteNode, node?.type, selectedReferenceId, setSelectedReferenceId])

  useEffect(() => {
    if (node?.type !== 'guide' || !node.url.startsWith('asset://')) {
      setIsAssetMissing(false)
      return
    }

    let cancelled = false
    loadAssetUrl(node.url).then((resolvedUrl) => {
      if (!cancelled) {
        setIsAssetMissing(!resolvedUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [node])

  if (!node || (node.type !== 'scan' && node.type !== 'guide')) return null

  const isScan = node.type === 'scan'
  const guideLocked = !isScan && guideUi?.locked === true
  const scaleReferenceVisible = !isScan && guideUi?.scaleReferenceVisible !== false
  return (
    <PanelWrapper
      onClose={handleClose}
      title={node.name || (isScan ? '3D Scan' : 'Guide Image')}
      width={300}
    >
      {!isScan && (
        <>
          <PanelSection title={t('panel.image')}>
            <input
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) {
                  void handleReplaceFile(file)
                }
              }}
              ref={replaceInputRef}
              type="file"
            />

            <ActionGroup>
              <ActionButton
                disabled={isReplacing}
                icon={<Upload className="h-3.5 w-3.5" />}
                label={isReplacing ? 'Replacing...' : 'Replace'}
                onClick={() => replaceInputRef.current?.click()}
              />
              <ActionButton
                className="text-destructive hover:bg-destructive/10"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t('common.delete')}
                onClick={handleDeleteGuide}
              />
            </ActionGroup>

            <ActionGroup>
              <ActionButton
                icon={
                  node.visible === false ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )
                }
                label={node.visible === false ? 'Show' : 'Hide'}
                onClick={() => handleUpdate({ visible: node.visible === false })}
              />
              <ActionButton
                icon={
                  guideLocked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )
                }
                label={guideLocked ? 'Unlock' : 'Lock'}
                onClick={() => setGuideLocked(node.id, !guideLocked)}
              />
            </ActionGroup>

            {replaceError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
                {replaceError}
              </div>
            )}

            {isAssetMissing && (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-300">
                Overlay image unavailable. Replace the image to restore it.
              </div>
            )}
          </PanelSection>

          <ReferenceScaleSection
            guide={node}
            isActive={isScaleFlowActive}
            onUpdate={(patch) => handleUpdate(patch)}
            referenceVisible={scaleReferenceVisible}
            setLocked={(locked) => setGuideLocked(node.id, locked)}
            setReferenceVisible={(visible) => setGuideScaleReferenceVisible(node.id, visible)}
          />
          <GuideCalibrationSection guide={node} onUpdate={(patch) => handleUpdate(patch)} />
        </>
      )}
      <ReferenceTransformSections node={node} onUpdate={handleUpdate} />
    </PanelWrapper>
  )
}
