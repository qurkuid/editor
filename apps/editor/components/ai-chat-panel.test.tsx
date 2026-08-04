import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import useAiChatHistory from '@/lib/ai-chat-history'
import {
  AI_CHAT_IMAGE_ACCEPT,
  AI_CHAT_MAX_IMAGE_BYTES,
  AI_CHAT_MAX_IMAGES,
  AiChatPanel,
  operationLabel,
  validateAiChatImageFile,
} from './ai-chat-panel'

test('exposes a visible multi-image picker with the approved limits', () => {
  const markup = renderToStaticMarkup(<AiChatPanel />)

  expect(markup).toContain('type="file"')
  expect(markup).toContain('multiple')
  expect(markup).toContain(`accept="${AI_CHAT_IMAGE_ACCEPT}"`)
  // Default locale is Korean — see packages/editor/src/i18n.
  expect(markup).toContain('참고 이미지 첨부')
  expect(markup).toContain(`${AI_CHAT_MAX_IMAGES}`)
  expect(markup).toContain('PNG/JPEG/WebP')
  expect(markup).toContain('파일당 5MB')
})

test('renders a reset button, disabled while there is no conversation to clear', () => {
  // renderToStaticMarkup is a pure SSR pass — React's useSyncExternalStore
  // reads zustand's getServerSnapshot (the store's initial state) here
  // rather than live state, so this can only assert the empty-history
  // render; the enabled state after a real append is covered at the store
  // level in ai-chat-history.test.ts.
  useAiChatHistory.getState().reset()
  const markup = renderToStaticMarkup(<AiChatPanel />)

  const resetButton = markup.match(/<button[^>]*aria-label="대화 초기화"[^>]*>/)?.[0]
  expect(resetButton).toBeDefined()
  expect(resetButton).toContain('disabled=""')
})

test('rejects unsupported or oversized image files before reading them', () => {
  expect(validateAiChatImageFile({ size: 1, type: 'image/gif' })).not.toBeNull()
  expect(
    validateAiChatImageFile({ size: AI_CHAT_MAX_IMAGE_BYTES + 1, type: 'image/png' }),
  ).not.toBeNull()
  expect(validateAiChatImageFile({ size: 1, type: 'image/webp' })).toBeNull()
})

test('uses a human-readable preview label for tier interior operations', () => {
  expect(
    operationLabel({
      message: 'Interior ready.',
      patches: [
        {
          op: 'setFurnitureTierInterior',
          id: 'cabinet_1',
          bayId: 'bay-0',
          tierId: 'bay-0-tier-0',
          shelfCount: 3,
          hanger: true,
        },
      ],
    }),
  ).toBe('가구 내부 구성 1')
})

test('uses human-readable preview labels for structural furniture operations', () => {
  expect(
    operationLabel({
      message: 'Structure ready.',
      patches: [
        { op: 'insertFurnitureBay', id: 'cabinet_1', afterBayId: 'bay-0' },
        {
          op: 'resizeFurnitureTier',
          id: 'cabinet_1',
          bayId: 'bay-0',
          tierId: 'bay-0-tier-0',
          height: 1.2,
        },
      ],
    }),
  ).toBe('가구 Bay 추가 1 · 가구 Tier 치수 1')
})
