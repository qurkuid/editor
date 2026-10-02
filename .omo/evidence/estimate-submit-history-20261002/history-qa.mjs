import { chromium } from '/Users/changseok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'

const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3104'
const sceneId = `estimate-history-${Date.now()}`
const evidenceDir = new URL('./', import.meta.url)

const graph = {
  nodes: {
    site_fixture: {
      object: 'node',
      id: 'site_fixture',
      type: 'site',
      children: ['building_fixture'],
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
    },
    building_fixture: {
      object: 'node',
      id: 'building_fixture',
      type: 'building',
      parentId: 'site_fixture',
      children: ['level_fixture'],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    level_fixture: {
      object: 'node',
      id: 'level_fixture',
      type: 'level',
      parentId: 'building_fixture',
      level: 0,
      height: 2.5,
      children: ['slab_fixture', 'slab_fixture_b'],
    },
    slab_fixture: {
      object: 'node',
      id: 'slab_fixture',
      type: 'slab',
      parentId: 'level_fixture',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [],
      holeMetadata: [],
      construction: [],
      elevation: 0.05,
      thickness: 0.05,
      recessed: false,
      slots: { surface: 'library:mat_fixture_b' },
    },
    slab_fixture_b: {
      object: 'node',
      id: 'slab_fixture_b',
      type: 'slab',
      parentId: 'level_fixture',
      polygon: [
        [5, 0],
        [9, 0],
        [9, 3],
        [5, 3],
      ],
      holes: [],
      holeMetadata: [],
      construction: [],
      elevation: 0.05,
      thickness: 0.05,
      recessed: false,
      slots: { surface: 'library:mat_fixture' },
    },
  },
  rootNodeIds: ['site_fixture'],
}

const catalogue = {
  connected: true,
  account: 'fixture@example.test',
  intmBaseUrl: 'https://intm.kr',
  materials: [
      {
        id: 'mat_fixture',
      name: 'Fixture floor finish',
      unit: '㎡',
      unitPrice: 100,
      coverageValue: 1,
      coverageUnit: 'm2',
      wasteRate: 0,
      productCategoryId: 'cat_fixture',
        companyId: 'fixture-company',
      },
      {
        id: 'mat_fixture_b',
        name: 'Fixture wall finish',
        unit: '㎡',
        unitPrice: 150,
        coverageValue: 1,
        coverageUnit: 'm2',
        wasteRate: 0,
        productCategoryId: 'cat_fixture_b',
        companyId: 'fixture-company',
      },
  ],
  categories: [],
}

const projects = [
  {
    id: 'project_fixture_a',
    name: 'Fixture project A',
    customerName: 'Fixture customer A',
    address: 'Fixture address A',
  },
  {
    id: 'project_fixture_b',
    name: 'Fixture project B',
    customerName: 'Fixture customer B',
    address: 'Fixture address B',
  },
]

const submitResponse = {
  ok: true,
  estimateId: 'fixture-history-partial',
  itemCount: 1,
  failedItems: 1,
  estimateUrl: 'https://intm.kr/newportal/estimates/fixture-history-partial/edit',
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitFor(predicate, label, timeout = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function openStatsAfterEditorHydration() {
  const statsPanel = page.getByText('통계 · 산출', { exact: true })
  const statsButton = page.getByRole('button', { name: '통계', exact: true }).first()
  await statsButton.waitFor()
  await waitFor(
    async () => {
      if (await statsPanel.isVisible().catch(() => false)) return true
      if (!(await page.getByText('Ground Floor', { exact: true }).isVisible().catch(() => false))) {
        return false
      }
      try {
        await statsButton.click()
      } catch {
        return false
      }
      await page.waitForTimeout(500)
      return statsPanel.isVisible().catch(() => false)
    },
    'the hydrated stats panel',
  )
  await waitFor(
    async () => {
      const statsVisible = await statsButton.isVisible().catch(() => false)
      const canvasVisible = await page.locator('canvas').first().isVisible().catch(() => false)
      return statsVisible && canvasVisible
    },
    'the hydrated editor surface',
  )
  await page.waitForTimeout(500)
}

function graphHistory(savedBody) {
  const nodes = savedBody?.graph?.nodes ?? savedBody?.nodes ?? {}
  const building = Object.values(nodes).find((node) => node?.type === 'building')
  return {
    metadata: building?.metadata ?? {},
    records: building?.metadata?.intmEstimateSubmissions ?? [],
  }
}

const createResponse = await fetch(`${baseUrl}/api/scenes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    id: sceneId,
    name: 'Estimate history fixture',
    projectId: 'fixture-project',
    graph,
  }),
})
assert(createResponse.ok, `fixture scene creation failed: ${createResponse.status}`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)

const consoleErrors = []
const pageErrors = []
const externalRequests = []
const externalMutations = []
const expectedNetworkFailures = []
const savedBodies = []
const estimateRequestBodies = []
const sceneResponses = []
let estimateCall = 0
let expectingNetworkFailure = false

page.on('console', (message) => {
  if (message.type() !== 'error') return
  if (expectingNetworkFailure && /Failed to fetch|ERR_FAILED|Failed to load resource/i.test(message.text())) {
    return
  }
  consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('requestfailed', (request) => {
  if (expectingNetworkFailure && new URL(request.url()).pathname === '/api/intm/estimates') {
    expectedNetworkFailures.push({ method: request.method(), url: request.url(), failure: request.failure() })
  }
})
page.on('request', (request) => {
  const url = request.url()
  const parsedUrl = new URL(url)
  const isLocalRequest = parsedUrl.port === new URL(baseUrl).port &&
    (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost')
  if (isLocalRequest) {
    if (request.method() === 'PUT' && parsedUrl.pathname === `/api/scenes/${sceneId}`) {
      try {
        savedBodies.push(request.postDataJSON())
      } catch {
        // The request body is expected to be JSON; leave malformed evidence visible in the result.
      }
    }
    return
  }
  const record = { method: request.method(), url }
  externalRequests.push(record)
  if (/^(POST|PUT|PATCH|DELETE)$/i.test(request.method())) externalMutations.push(record)
})
page.on('response', (response) => {
  const parsedUrl = new URL(response.url())
  const localPort = new URL(baseUrl).port
  const isLocalScene = parsedUrl.port === localPort &&
    (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost') &&
    parsedUrl.pathname === `/api/scenes/${sceneId}`
  if (isLocalScene && /^(GET|PUT)$/i.test(response.request().method())) {
    sceneResponses.push({ method: response.request().method(), status: response.status(), url: response.url() })
  }
})

await page.route('**/api/intm/materials', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue) }),
)
await page.route('**/api/intm/projects', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ connected: true, projects }),
  }),
)
await page.route('**/api/intm/estimates', (route) => {
  if (route.request().method() !== 'POST') return route.continue()
  try {
    estimateRequestBodies.push(route.request().postDataJSON())
  } catch {
    estimateRequestBodies.push(null)
  }
  const currentCall = estimateCall++
  if (currentCall === 0) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(submitResponse),
    })
  }
  if (currentCall === 1) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'fixture API rejected' }),
    })
  }
  return route.abort()
})

// Static icon/texture GETs are allowed editor traffic and are mocked so they do
// not obscure the zero external mutation claim.
await page.route('https://api.iconify.design/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"prefix":"fixture","icons":{}}' }),
)
await page.route('https://api.unisvg.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"prefix":"fixture","icons":{}}' }),
)
await page.route('https://editor.pascal.app/material/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  }),
)

const result = {
  baseUrl,
  sceneId,
  savedGraph: null,
  reload: null,
  projectSwitch: null,
  untrusted: null,
  noPricedItems: null,
  apiFailure: null,
  networkFailure: null,
  estimateRequestBodies,
  sceneResponses,
  consoleErrors,
  pageErrors,
  externalRequests,
  externalMutations,
  expectedNetworkFailures,
}

try {
  await page.goto(`${baseUrl}/scene/${sceneId}`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  const statsRailButton = page.getByRole('button', { name: '통계', exact: true }).first()
  await statsRailButton.waitFor()
  await statsRailButton.click()
  await page.getByText('통계 · 산출', { exact: true }).waitFor()
  await page.getByText('견적서 작성', { exact: true }).waitFor()

  const projectSearch = page.getByPlaceholder('프로젝트 검색 (이름 · 고객 · 주소)')
  await projectSearch.fill('Fixture project A')
  await page.getByRole('button', { name: /Fixture project A/ }).last().click()
  await page.getByPlaceholder('견적서 제목').fill('Fixture history partial')

  const submitButton = page.getByRole('button', { name: 'INTM에 견적서 생성' })
  await submitButton.click()
  const resultRegion = page.locator('[aria-live="polite"]').last()
  await resultRegion.getByText('1개 항목이 추가됐고 1개가 실패했습니다', { exact: false }).waitFor()
  await waitFor(
    () => savedBodies.some((body) => graphHistory(body).records.length === 1),
    'the autosaved history record',
  )

  const saved = savedBodies.find((body) => graphHistory(body).records.length === 1)
  const savedHistory = graphHistory(saved)
  assert(savedHistory.metadata.intmProjectId === 'project_fixture_a', 'project link was not preserved')
  assert(savedHistory.records[0].schemaVersion === 1, 'saved record schema is not v1')
  assert(savedHistory.records[0].projectId === 'project_fixture_a', 'saved record project is wrong')
  assert(savedHistory.records[0].estimateId === submitResponse.estimateId, 'saved estimate id is wrong')
  assert(savedHistory.records[0].estimateUrl === submitResponse.estimateUrl, 'saved estimate URL is wrong')
  assert(savedHistory.records[0].itemCount === 1, 'saved successful item count is wrong')
  assert(savedHistory.records[0].failedItems === 1, 'saved failed item count is wrong')
  assert(
    savedHistory.records[0].items.length === savedHistory.records[0].itemCount + savedHistory.records[0].failedItems,
    'saved attempted items do not match counts',
  )
  result.savedGraph = {
    putCount: savedBodies.length,
    metadataKeys: Object.keys(savedHistory.metadata).sort(),
    record: savedHistory.records[0],
  }

  await submitButton.click()
  await resultRegion.getByText('fixture API rejected', { exact: true }).waitFor()
  result.apiFailure = {
    text: await resultRegion.innerText(),
    linkCount: await resultRegion.locator('a').count(),
  }
  assert(result.apiFailure.linkCount === 0, 'API refusal showed a link')
  await waitFor(
    () => savedBodies.filter((body) => graphHistory(body).records.length === 1).length >= 1,
    'history to remain unchanged after API refusal',
  )

  expectingNetworkFailure = true
  await submitButton.click()
  await resultRegion.getByText(/Failed to fetch|fetch failed|네트워크|Network/i).waitFor()
  expectingNetworkFailure = false
  result.networkFailure = {
    text: await resultRegion.innerText(),
    linkCount: await resultRegion.locator('a').count(),
  }
  assert(result.networkFailure.linkCount === 0, 'network failure showed a link')

  await page.screenshot({
    path: new URL('history-before-reload.png', evidenceDir).pathname,
    fullPage: true,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  await openStatsAfterEditorHydration()
  const historyHeading = page.getByText('이 프로젝트의 이전 견적서', { exact: true })
  await historyHeading.waitFor()
  const historyRow = page.locator(`[data-estimate-id="${submitResponse.estimateId}"]`)
  await historyRow.waitFor()
  const historyLink = historyRow.locator('a')
  result.reload = {
    heading: await historyHeading.innerText(),
    rowText: await historyRow.innerText(),
    href: await historyLink.getAttribute('href'),
    target: await historyLink.getAttribute('target'),
    rel: await historyLink.getAttribute('rel'),
  }
  assert(result.reload.href === submitResponse.estimateUrl, 'trusted history href was not canonical')
  assert(result.reload.target === '_blank', 'history link target is wrong')
  assert(result.reload.rel === 'noopener noreferrer', 'history link rel is wrong')
  assert(/성공 1 · 실패 1 · 전체 2/.test(result.reload.rowText), 'history counts are wrong after reload')
  await page.screenshot({
    path: new URL('history-reloaded.png', evidenceDir).pathname,
    fullPage: true,
  })

  await projectSearch.fill('Fixture project B')
  await page.getByRole('button', { name: /Fixture project B/ }).last().click()
  await waitFor(() => historyRow.count().then((count) => count === 0), 'project A history to hide')
  result.projectSwitch = { projectBRows: await historyRow.count() }
  assert(result.projectSwitch.projectBRows === 0, 'project A history remained under project B')
  await page.screenshot({
    path: new URL('history-project-b.png', evidenceDir).pathname,
    fullPage: true,
  })

  await projectSearch.fill('Fixture project A')
  await page.getByRole('button', { name: /Fixture project A/ }).last().click()
  await historyRow.waitFor()

  const storedResponse = await fetch(`${baseUrl}/api/scenes/${sceneId}`)
  const storedScene = await storedResponse.json()
  const storedGraph = structuredClone(storedScene.graph)
  const building = Object.values(storedGraph.nodes).find((node) => node.type === 'building')
  building.metadata.intmEstimateSubmissions.unshift({
    schemaVersion: 1,
    projectId: 'project_fixture_a',
    title: 'Corrupt URL fixture',
    estimateId: 'evil-history',
    estimateUrl: 'https://evil.example/newportal/estimates/evil-history/edit',
    submittedAt: '2026-10-02T00:00:00.000Z',
    itemCount: 0,
    failedItems: 1,
    items: [
      {
        description: 'failed fixture item',
        quantity: 1,
        unitPrice: 100,
      },
    ],
  })
  building.metadata.intmEstimateSubmissions.unshift({
    schemaVersion: 1,
    projectId: 'project_fixture_b',
    title: 'Project B persisted fixture',
    estimateId: 'project-b-history',
    estimateUrl: 'https://intm.kr/newportal/estimates/project-b-history/edit',
    submittedAt: '2026-10-02T00:01:00.000Z',
    itemCount: 1,
    failedItems: 0,
    items: [
      {
        description: 'project B fixture item',
        quantity: 1,
        unitPrice: 100,
      },
    ],
  })
  const corruptionResponse = await fetch(`${baseUrl}/api/scenes/${sceneId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': `"${storedScene.version}"` },
    body: JSON.stringify({ graph: storedGraph, expectedVersion: storedScene.version }),
  })
  assert(corruptionResponse.ok, `untrusted fixture save failed: ${corruptionResponse.status}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  await openStatsAfterEditorHydration()
  const badRow = page.locator('[data-estimate-id="evil-history"]')
  await badRow.waitFor()
  result.untrusted = {
    rowText: await badRow.innerText(),
    linkCount: await badRow.locator('a').count(),
    unavailable: await badRow.getByText('INTM 링크를 확인할 수 없습니다.', { exact: true }).count(),
  }
  assert(result.untrusted.linkCount === 0, 'arbitrary-origin history URL became a link')
  assert(result.untrusted.unavailable === 1, 'untrusted history URL lacked unavailable label')
  const projectBRow = page.locator('[data-estimate-id="project-b-history"]')
  await projectSearch.fill('Fixture project B')
  await page.getByRole('button', { name: /Fixture project B/ }).last().click()
  await projectBRow.waitFor()
  assert(await historyRow.count() === 0, 'project A history remained visible for project B')
  result.projectSwitch = {
    ...(result.projectSwitch ?? {}),
    persistedProjectBRows: await projectBRow.count(),
    projectARowsWhileBSelected: await historyRow.count(),
  }
  await projectSearch.fill('Fixture project A')
  await page.getByRole('button', { name: /Fixture project A/ }).last().click()
  await historyRow.waitFor()
  await page.screenshot({
    path: new URL('history-untrusted.png', evidenceDir).pathname,
    fullPage: true,
  })

  for (const material of catalogue.materials) material.unitPrice = 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  await openStatsAfterEditorHydration()
  await historyRow.waitFor()
  const noPricedSubmitButton = page.getByRole('button', { name: 'INTM에 견적서 생성' })
  await waitFor(
    () => noPricedSubmitButton.isDisabled(),
    'the create button to disable with no priced items',
  )
  result.noPricedItems = {
    historyRowVisible: await historyRow.isVisible(),
    createButtonDisabled: await noPricedSubmitButton.isDisabled(),
  }
  assert(result.noPricedItems.historyRowVisible, 'history disappeared with no priced items')
  assert(result.noPricedItems.createButtonDisabled, 'create button stayed enabled with no priced items')
  await page.screenshot({
    path: new URL('history-empty-draft.png', evidenceDir).pathname,
    fullPage: true,
  })
} catch (error) {
  result.failure = String(error)
  await page.screenshot({
    path: new URL('history-failure.png', evidenceDir).pathname,
    fullPage: true,
  }).catch(() => {})
  throw error
} finally {
  expectingNetworkFailure = false
  result.consoleErrors = consoleErrors
  result.pageErrors = pageErrors
  result.externalRequests = externalRequests
  result.externalMutations = externalMutations
  result.expectedNetworkFailures = expectedNetworkFailures
  writeFileSync(new URL('history-qa-result.json', evidenceDir), `${JSON.stringify(result, null, 2)}\n`)
  await browser.close()
}

console.log(JSON.stringify(result, null, 2))
if (result.consoleErrors.length > 0 || result.pageErrors.length > 0 || result.externalMutations.length > 0) {
  process.exitCode = 1
}
