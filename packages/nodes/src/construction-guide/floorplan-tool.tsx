'use client'

import {
  type AnyNodeId,
  ConstructionGuideNode,
  type ConstructionGuideNode as ConstructionGuideNodeType,
  type WallNode,
} from '@pascal-app/core'
import {
  type FloorplanToolContext,
  formatLinearMeasurement,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useDraftLengthInput,
  useFloorplanRender,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import {
  CONSTRUCTION_GUIDE_COLOR,
  CONSTRUCTION_GUIDE_DASH,
  type GuideFrame,
  guideFrame,
  guideLineEndpoints,
} from './floorplan'

// SketchUp tape-measure guide flow: click a reference edge (a wall's
// centerline or an existing guide), slide the dashed parallel preview to the
// wanted offset — grid-snapped, or typed for an exact distance — then click
// or Enter to commit. The tool stays armed for the next guide; Escape steps
// back to the reference pick, then exits.

type Draft = { reference: GuideFrame } | null

function clientToPlan(group: SVGGElement, clientX: number, clientY: number) {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y] as [number, number]
}

function registryTargetNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return (
    target.closest<SVGGElement>('.floorplan-registry-entry[data-node-id]')?.dataset.nodeId ?? null
  )
}

export default function ConstructionGuideFloorplanTool({
  sceneApi,
  activeLevelId,
  unit,
  metricNotation,
  gridSnapStep,
  selectNode,
  finishTool,
}: FloorplanToolContext) {
  const [draft, setDraft] = useState<Draft>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const renderContext = useFloorplanRender()
  const groupRef = useRef<SVGGElement>(null)
  const draftRef = useRef<Draft>(null)
  const cursorRef = useRef<[number, number] | null>(null)
  draftRef.current = draft
  cursorRef.current = cursor

  const draftLength = useDraftLengthInput(() => draftRef.current !== null)
  const draftLengthRef = useRef(draftLength)
  draftLengthRef.current = draftLength

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const resolveOffset = (plan: [number, number], reference: GuideFrame): number => {
      const raw =
        (plan[0] - reference.origin[0]) * reference.normal[0] +
        (plan[1] - reference.origin[1]) * reference.normal[1]
      const typed = draftLengthRef.current.getLengthMeters()
      if (typed !== null) return (raw < 0 ? -1 : 1) * typed
      if (isGridSnapActive() && gridSnapStep > 0) {
        return Math.round(raw / gridSnapStep) * gridSnapStep
      }
      return raw
    }

    const commit = (offset: number) => {
      const reference = draftRef.current?.reference
      if (!reference || !activeLevelId) return
      const node = ConstructionGuideNode.parse({
        parentId: activeLevelId,
        name: 'Guide Line',
        origin: [
          reference.origin[0] + reference.normal[0] * offset,
          reference.origin[1] + reference.normal[1] * offset,
        ],
        direction: [reference.direction[0], reference.direction[1]],
      }) satisfies ConstructionGuideNodeType
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id as AnyNodeId)
      triggerSFX('sfx:structure-build')
      draftLengthRef.current.clear()
      setDraft(null)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      consume(event)
    }
    const onPointerMove = (event: PointerEvent) => {
      const plan = clientToPlan(group, event.clientX, event.clientY)
      if (plan) setCursor(plan)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      const plan = clientToPlan(group, event.clientX, event.clientY)
      if (!plan) return

      const current = draftRef.current
      if (current) {
        consume(event)
        commit(resolveOffset(plan, current.reference))
        return
      }

      // Reference pick: a wall's centerline or an existing guide's line.
      const targetId = registryTargetNodeId(event.target)
      const target = targetId ? sceneApi.get(targetId as AnyNodeId) : null
      if (target?.type === 'wall') {
        consume(event)
        const wall = target as WallNode
        setDraft({
          reference: guideFrame(wall.start, [
            wall.end[0] - wall.start[0],
            wall.end[1] - wall.start[1],
          ]),
        })
        triggerSFX('sfx:grid-snap')
      } else if (target?.type === 'construction-guide') {
        consume(event)
        const guide = target as ConstructionGuideNodeType
        setDraft({ reference: guideFrame(guide.origin, guide.direction) })
        triggerSFX('sfx:grid-snap')
      } else {
        // Not a usable reference — swallow so nothing re-selects mid-tool.
        consume(event)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        const current = draftRef.current
        const plan = cursorRef.current
        if (!(current && plan)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        commit(resolveOffset(plan, current.reference))
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      if (draftRef.current) {
        draftLengthRef.current.clear()
        setDraft(null)
        return
      }
      finishTool()
    }

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('click', onClick, true)
    svg.addEventListener('dblclick', consume, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('dblclick', consume, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, finishTool, gridSnapStep, sceneApi, selectNode])

  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0

  let preview: {
    a: [number, number]
    b: [number, number]
    offset: number
    label: [number, number]
  } | null = null
  if (draft && cursor) {
    const { reference } = draft
    const raw =
      (cursor[0] - reference.origin[0]) * reference.normal[0] +
      (cursor[1] - reference.origin[1]) * reference.normal[1]
    const typed = draftLength.getLengthMeters()
    let offset: number
    if (typed !== null) offset = (raw < 0 ? -1 : 1) * typed
    else if (isGridSnapActive() && gridSnapStep > 0)
      offset = Math.round(raw / gridSnapStep) * gridSnapStep
    else offset = raw
    const frame = guideFrame(
      [
        reference.origin[0] + reference.normal[0] * offset,
        reference.origin[1] + reference.normal[1] * offset,
      ],
      reference.direction,
    )
    const { a, b } = guideLineEndpoints(frame)
    preview = { a, b, offset, label: cursor }
  }

  return (
    <g pointerEvents="none" ref={groupRef}>
      {draft
        ? // Reference line echo: a faint solid line so the picked edge reads
          // as the measuring base while the offset preview follows the cursor.
          (() => {
            const { a, b } = guideLineEndpoints(draft.reference)
            return (
              <line
                stroke={CONSTRUCTION_GUIDE_COLOR}
                strokeOpacity={0.35}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                x1={a[0]}
                x2={b[0]}
                y1={a[1]}
                y2={b[1]}
              />
            )
          })()
        : null}
      {preview ? (
        <>
          <line
            stroke={CONSTRUCTION_GUIDE_COLOR}
            strokeDasharray={CONSTRUCTION_GUIDE_DASH}
            strokeOpacity={0.95}
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
            x1={preview.a[0]}
            x2={preview.b[0]}
            y1={preview.a[1]}
            y2={preview.b[1]}
          />
          <text
            dominantBaseline="central"
            fill={CONSTRUCTION_GUIDE_COLOR}
            fontSize={12 * unitsPerPixel}
            fontWeight="700"
            paintOrder="stroke"
            stroke="rgba(255, 255, 255, 0.85)"
            strokeWidth={3 * unitsPerPixel}
            textAnchor="middle"
            transform={`rotate(${-sceneRotationDeg} ${preview.label[0]} ${preview.label[1]})`}
            x={preview.label[0]}
            y={preview.label[1] - 16 * unitsPerPixel}
          >
            {formatLinearMeasurement(Math.abs(preview.offset), unit, metricNotation)}
          </text>
        </>
      ) : null}
    </g>
  )
}
