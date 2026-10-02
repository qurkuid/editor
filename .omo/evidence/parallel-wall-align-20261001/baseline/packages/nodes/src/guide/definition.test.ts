import { describe, expect, test } from 'bun:test'
import { guideDefinition } from './definition'

describe('guide image interaction ownership', () => {
  test('versions persisted orientation fields', () => {
    expect(guideDefinition.schemaVersion).toBe(2)
  })

  test('keeps guide clicks out of ordinary scene selection', () => {
    expect(guideDefinition.capabilities?.selectable).toBeUndefined()
  })
})
