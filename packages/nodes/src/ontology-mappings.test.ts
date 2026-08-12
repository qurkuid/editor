import { describe, expect, test } from 'bun:test'
import { bodyDefinition } from './body'
import { wallDefinition } from './wall'
import { windowDefinition } from './window'

describe('Phase 2 ontology mappings', () => {
  test('maps the three vertical-slice node definitions to Pack v1 classes', () => {
    expect(bodyDefinition.semanticRef).toEqual({
      packId: 'pascal-architecture-core',
      classId: 'pascal:architecture/body',
      version: '1.0.0',
    })
    expect(wallDefinition.semanticRef).toEqual({
      packId: 'pascal-architecture-core',
      classId: 'pascal:architecture/wall',
      version: '1.0.0',
    })
    expect(windowDefinition.semanticRef).toEqual({
      packId: 'pascal-architecture-core',
      classId: 'pascal:architecture/window',
      version: '1.0.0',
    })
  })
})
