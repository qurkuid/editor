'use client'

import { useCallback, useRef, useState } from 'react'

type ProfilePoint = [number, number]

const SNAP = 0.005
const MIN_POINTS = 3
const U_MAX = 5
const V_MIN = -3
const V_MAX = 1

/**
 * Inline section editor for a ceiling feature profile — the free-drawing
 * half of the hybrid model. Renders the closed (u, v) section in an SVG:
 * wall on the left (u = 0), ceiling plane on top (v = 0), down is
 * negative v. Drag vertices to move them (5mm snap), click a midpoint
 * dot to insert a vertex, right-click a vertex to remove it.
 */
export function CeilingSectionEditor({
  profile,
  onChange,
}: {
  profile: ProfilePoint[]
  onChange: (profile: ProfilePoint[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // Freeze the view box while dragging so the coordinate system doesn't
  // shift under the pointer as the profile's bounds change mid-drag.
  const frozenViewBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const pad = 0.06
  let minU = 0
  let maxU = 0.3
  let minV = -0.2
  let maxV = 0
  for (const [u, v] of profile) {
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const liveViewBox = {
    x: minU - pad,
    y: -maxV - pad,
    w: maxU - minU + pad * 2,
    h: maxV - minV + pad * 2,
  }
  const liveViewBoxRef = useRef(liveViewBox)
  liveViewBoxRef.current = liveViewBox
  const viewBox = dragIndex != null && frozenViewBox.current ? frozenViewBox.current : liveViewBox

  // Rendered at ~270 CSS px wide; unit-per-px keeps handle sizes and
  // stroke widths visually constant regardless of the profile's extent.
  const upx = viewBox.w / 270

  const toProfilePoint = useCallback(
    (clientX: number, clientY: number): ProfilePoint | null => {
      const svg = svgRef.current
      const vb = frozenViewBox.current
      if (!(svg && vb)) return null
      const rect = svg.getBoundingClientRect()
      const u = vb.x + ((clientX - rect.left) / rect.width) * vb.w
      const y = vb.y + ((clientY - rect.top) / rect.height) * vb.h
      const snap = (value: number) => Math.round(value / SNAP) * SNAP
      return [
        Math.min(U_MAX, Math.max(0, snap(u))),
        Math.min(V_MAX, Math.max(V_MIN, snap(-y))),
      ]
    },
    [],
  )

  const handleVertexPointerDown = useCallback((index: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    frozenViewBox.current = liveViewBoxRef.current
    setDragIndex(index)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback(
    (index: number, e: React.PointerEvent) => {
      if (dragIndex !== index) return
      const point = toProfilePoint(e.clientX, e.clientY)
      if (!point) return
      const current = profile[index]
      if (current && current[0] === point[0] && current[1] === point[1]) return
      const next = profile.slice()
      next[index] = point
      onChange(next)
    },
    [dragIndex, onChange, profile, toProfilePoint],
  )

  const handlePointerUp = useCallback((index: number, e: React.PointerEvent) => {
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    setDragIndex((current) => (current === index ? null : current))
    frozenViewBox.current = null
  }, [])

  const handleInsert = useCallback(
    (edgeIndex: number) => {
      const a = profile[edgeIndex]!
      const b = profile[(edgeIndex + 1) % profile.length]!
      const mid: ProfilePoint = [
        Math.round(((a[0] + b[0]) / 2) / SNAP) * SNAP,
        Math.round(((a[1] + b[1]) / 2) / SNAP) * SNAP,
      ]
      const next = profile.slice()
      next.splice(edgeIndex + 1, 0, mid)
      onChange(next)
    },
    [onChange, profile],
  )

  const handleRemove = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault()
      if (profile.length <= MIN_POINTS) return
      onChange(profile.filter((_, i) => i !== index))
    },
    [onChange, profile],
  )

  const path = profile.map(([u, v], i) => `${i === 0 ? 'M' : 'L'} ${u} ${-v}`).join(' ')
  const dragPoint = dragIndex != null ? profile[dragIndex] : undefined

  return (
    <div className="px-1 pb-1">
      <svg
        className="w-full rounded-md bg-black/30"
        ref={svgRef}
        style={{ height: `${Math.round((viewBox.h / viewBox.w) * 270)}px`, touchAction: 'none' }}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      >
        {/* Ceiling plane (v = 0) and wall (u = 0) guides. */}
        <line
          stroke="#64748b"
          strokeDasharray={`${6 * upx} ${4 * upx}`}
          strokeWidth={upx}
          x1={viewBox.x}
          x2={viewBox.x + viewBox.w}
          y1={0}
          y2={0}
        />
        <line
          stroke="#64748b"
          strokeDasharray={`${6 * upx} ${4 * upx}`}
          strokeWidth={upx}
          x1={0}
          x2={0}
          y1={viewBox.y}
          y2={viewBox.y + viewBox.h}
        />

        <path d={`${path} Z`} fill="#f2eee6" fillOpacity={0.25} stroke="#f2eee6" strokeWidth={1.5 * upx} />

        {/* Midpoint insert dots. */}
        {profile.map(([u, v], i) => {
          const [nu, nv] = profile[(i + 1) % profile.length]!
          return (
            <circle
              className="cursor-copy"
              cx={(u + nu) / 2}
              cy={-(v + nv) / 2}
              fill="#94a3b8"
              fillOpacity={0.7}
              key={`mid-${i}`}
              onClick={() => handleInsert(i)}
              r={3 * upx}
            />
          )
        })}

        {/* Draggable vertices. */}
        {profile.map(([u, v], i) => (
          <circle
            className="cursor-move"
            cx={u}
            cy={-v}
            fill={dragIndex === i ? '#60a5fa' : '#e2e8f0'}
            key={`vtx-${i}`}
            onContextMenu={(e) => handleRemove(i, e)}
            onPointerDown={(e) => handleVertexPointerDown(i, e)}
            onPointerMove={(e) => handlePointerMove(i, e)}
            onPointerUp={(e) => handlePointerUp(i, e)}
            r={4.5 * upx}
            stroke="#0f172a"
            strokeWidth={upx}
          />
        ))}
      </svg>
      <div className="flex items-center justify-between px-1 pt-1 text-[10px] text-muted-foreground">
        <span>Drag to move · click a dot to add · right-click to remove</span>
        {dragPoint && (
          <span className="font-mono">
            {Math.round(dragPoint[0] * 1000)} × {Math.round(-dragPoint[1] * 1000)} mm
          </span>
        )}
      </div>
    </div>
  )
}
