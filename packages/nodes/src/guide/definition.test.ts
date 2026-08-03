import { describe, expect, test } from 'bun:test'
import { guideDefinition } from './definition'

describe('guide image interaction ownership', () => {
  test('keeps guide clicks out of ordinary scene selection', () => {
    expect(guideDefinition.capabilities?.selectable).toBeUndefined()
  })
})
