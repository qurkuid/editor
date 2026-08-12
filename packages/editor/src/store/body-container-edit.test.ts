import { afterEach, describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import useEditor from './use-editor'

const CONTAINER_ID = 'component_test' as AnyNodeId

afterEach(() => {
  useEditor.getState().exitBodyContainerEdit()
})

describe('Body container edit context', () => {
  test('enters and exits without mutating the persisted editor slice', () => {
    useEditor.getState().enterBodyContainerEdit(CONTAINER_ID)

    expect(useEditor.getState().activeBodyContainerId).toBe(CONTAINER_ID)

    useEditor.getState().exitBodyContainerEdit()
    expect(useEditor.getState().activeBodyContainerId).toBeNull()
  })
})
