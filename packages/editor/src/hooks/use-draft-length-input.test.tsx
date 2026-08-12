import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDraftLengthHud } from '../store/use-draft-length-hud'
import { useDraftLengthInput } from './use-draft-length-input'

class FakeElement extends EventTarget {
  readonly nodeType = 1
  readonly nodeName = 'DIV'
  readonly tagName = 'DIV'
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  readonly style: Record<string, string> = {}
  readonly ownerDocument: FakeDocument

  constructor(ownerDocument: FakeDocument) {
    super()
    this.ownerDocument = ownerDocument
  }

  appendChild(): void {}
  removeChild(): void {}
}

class FakeDocument extends EventTarget {
  readonly nodeType = 9
  readonly defaultView = globalThis
  readonly activeElement = null
  readonly documentElement: FakeElement
  readonly body: FakeElement

  constructor() {
    super()
    this.documentElement = new FakeElement(this)
    this.body = new FakeElement(this)
  }
}

class FakeKeyboardEvent extends Event {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, { bubbles: true, cancelable: true })
    this.altKey = init.altKey ?? false
    this.ctrlKey = init.ctrlKey ?? false
    this.key = init.key ?? ''
    this.metaKey = init.metaKey ?? false
  }
}

const fakeDocument = new FakeDocument()
const fakeWindow = new EventTarget()
let root: Root | null = null

function Probe({ onEscape }: { readonly onEscape?: () => void }) {
  useDraftLengthInput(() => true, { signed: true, onEscape })
  return null
}

async function mount(onEscape?: () => void): Promise<void> {
  const container = new FakeElement(fakeDocument)
  root = createRoot(container as never)
  await act(async () => root?.render(<Probe onEscape={onEscape} />))
}

async function press(key: string): Promise<void> {
  await act(async () => fakeWindow.dispatchEvent(new KeyboardEvent('keydown', { key })))
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'HTMLIFrameElement', {
    configurable: true,
    value: class HTMLIFrameElement {},
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  Object.defineProperty(globalThis, 'KeyboardEvent', {
    configurable: true,
    value: FakeKeyboardEvent,
  })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
})

beforeEach(() => useDraftLengthHud.getState().clear())

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
})

describe('useDraftLengthInput mounted lifecycle', () => {
  test('populated Escape clears the HUD and calls the interaction cancel owner once', async () => {
    let cancellations = 0
    await mount(() => {
      cancellations += 1
    })
    await press('-')
    await press('2')

    await press('Escape')

    expect(cancellations).toBe(1)
    expect(useDraftLengthHud.getState()).toMatchObject({ raw: '', signedMode: false })
  })

  test('unmount clears populated HUD state and removes the key listener', async () => {
    let cancellations = 0
    await mount(() => {
      cancellations += 1
    })
    await press('-')
    await press('2')
    await act(async () => root?.unmount())
    root = null

    await press('Escape')

    expect(cancellations).toBe(0)
    expect(useDraftLengthHud.getState()).toMatchObject({ raw: '', signedMode: false })
  })
})
