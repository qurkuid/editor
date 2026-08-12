'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { PanelSection } from '@pascal-app/editor'

type AttributeValue = string | number | boolean | null
type AttributeDictionaries = Record<string, Record<string, AttributeValue>>

function attributeDictionaries(metadata: unknown): AttributeDictionaries {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const attributes = Reflect.get(metadata, 'attributes')
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {}
  const result: AttributeDictionaries = {}
  for (const [dictionary, values] of Object.entries(attributes)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue
    result[dictionary] = {}
    for (const [key, value] of Object.entries(values)) {
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[dictionary][key] = value
      }
    }
  }
  return result
}

export default function SketchUpAttributes() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const node = useScene((state) => Object.values(state.nodes).find((candidate) => candidate.id === selectedId))
  const dictionaries = attributeDictionaries(node?.metadata)
  if (!node || Object.keys(dictionaries).length === 0) return null

  const update = (dictionary: string, key: string, value: AttributeValue) => {
    const next = structuredClone(dictionaries)
    const values = next[dictionary]
    if (!values) return
    values[key] = value
    const metadata = node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? node.metadata
      : {}
    useScene.getState().updateNode(node.id, {
      metadata: { ...metadata, attributes: next },
    })
  }

  return (
    <PanelSection title="SketchUp 속성">
      {Object.entries(dictionaries).flatMap(([dictionary, values]) =>
        Object.entries(values).map(([key, value]) => (
          <label className="mb-2 block" key={`${dictionary}:${key}`}>
            <span className="mb-1 block text-xs text-zinc-400">{dictionary} · {key}</span>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              defaultValue={String(value ?? '')}
              onBlur={(event) => update(dictionary, key, event.target.value)}
            />
          </label>
        )),
      )}
    </PanelSection>
  )
}
