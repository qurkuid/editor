import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { HostSettingsSection, HostSettingsSectionView } from './host-settings-section'

test('renders Korean labels by default', () => {
  // Given: a user who has not touched the language preference yet.

  // When: the host settings section mounts with its default (ko) language.
  const markup = renderToStaticMarkup(<HostSettingsSection />)

  // Then: the section's own labels read in Korean.
  expect(markup).toContain('언어')
  expect(markup).toContain('한국어')
  expect(markup).toContain('자재')
})

test('shows the AI provider as connected with its model once configured', () => {
  const markup = renderToStaticMarkup(
    <HostSettingsSectionView
      aiProvider="codex"
      aiState={{ status: 'connected', model: 'gpt-5-codex' }}
      language="ko"
      materialsState="loading"
      onAiProviderChange={() => {}}
      onLanguageChange={() => {}}
    />,
  )

  expect(markup).toContain('gpt-5-codex')
})

test('shows Materials as unavailable when the RawPainter catalog fails', () => {
  const markup = renderToStaticMarkup(
    <HostSettingsSectionView
      aiProvider="codex"
      aiState={{ status: 'loading' }}
      language="ko"
      materialsState="unavailable"
      onAiProviderChange={() => {}}
      onLanguageChange={() => {}}
    />,
  )

  expect(markup).toContain('사용 불가')
})

test('shows Claude as the AI source label when Claude is selected', () => {
  const markup = renderToStaticMarkup(
    <HostSettingsSectionView
      aiProvider="claude"
      aiState={{ status: 'not-connected' }}
      language="ko"
      materialsState="loading"
      onAiProviderChange={() => {}}
      onLanguageChange={() => {}}
    />,
  )

  expect(markup).toContain('Claude CLI')
})
