import { describe, expect, test } from 'bun:test'
import { getNodeSemanticRef } from '../registry/registry'
import { SemanticRefSchema } from './semantic-ref'

describe('SemanticRef boundary', () => {
  test('parses stable Pack/class/version ids and rejects unstable values', () => {
    expect(
      SemanticRefSchema.parse({
        packId: 'pascal-architecture-core',
        classId: 'pascal:architecture/wall',
        version: '1.0.0',
      }),
    ).toEqual({
      packId: 'pascal-architecture-core',
      classId: 'pascal:architecture/wall',
      version: '1.0.0',
    })
    expect(() =>
      SemanticRefSchema.parse({
        packId: 'pascal architecture core',
        classId: 'pascal:architecture/wall',
        version: 'v1',
      }),
    ).toThrow()
  })

  test('resolves built-in node mappings through the registry SSOT', () => {
    expect(getNodeSemanticRef('body')).toEqual(
      expect.objectContaining({ classId: 'pascal:architecture/body', version: '1.0.0' }),
    )
    expect(getNodeSemanticRef('wall')).toEqual(
      expect.objectContaining({ classId: 'pascal:architecture/wall', version: '1.0.0' }),
    )
    expect(getNodeSemanticRef('unmapped-kind')).toBeUndefined()
  })
})
