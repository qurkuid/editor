import { chromium } from '/Users/changseok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3102'
const evidenceDir = new URL('./', import.meta.url)
const scene = {
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
      children: ['slab_fixture'],
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
      slots: { surface: 'library:mat_fixture' },
    },
  },
  rootNodeIds: ['site_fixture'],
}

const catalogue = {
  connected: true,
  account: 'fixture@example.test',
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
  ],
  categories: [],
}

const project = {
  id: 'project_fixture',
  name: 'Fixture project',
  customerName: 'Fixture customer',
  address: 'Fixture address',
}

const submitResponses = [
  {
    ok: true,
    estimateId: 'fixture-complete',
    itemCount: 3,
    failedItems: 0,
    estimateUrl: 'https://intm.example.test/newportal/estimates/fixture-complete/edit',
  },
  {
    ok: true,
    estimateId: 'fixture-partial',
    itemCount: 2,
    failedItems: 1,
    estimateUrl: 'https://intm.example.test/newportal/estimates/fixture-partial/edit',
  },
  {
    ok: true,
    estimateId: 'fixture-empty',
    itemCount: 0,
    failedItems: 3,
    estimateUrl: 'https://intm.example.test/newportal/estimates/fixture-empty/edit',
  },
  { ok: false, error: 'fixture API rejected' },
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const consoleErrors = []
const pageErrors = []
const externalRequests = []
const externalMutations = []
const expectedNetworkConsoleErrors = []
const expectedNetworkFailures = []
let submitIndex = 0
let networkFailureUsed = false
let expectingNetworkFailure = false

page.on('console', (message) => {
  if (message.type() !== 'error') return
  if (expectingNetworkFailure && /Failed to fetch|ERR_FAILED|Failed to load resource/i.test(message.text())) {
    expectedNetworkConsoleErrors.push(message.text())
  } else {
    consoleErrors.push(message.text())
  }
})
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('requestfailed', (request) => {
  if (expectingNetworkFailure && request.url() === `${baseUrl}/api/intm/estimates`) {
    expectedNetworkFailures.push({ method: request.method(), url: request.url(), failure: request.failure() })
  }
})
page.on('request', (request) => {
  const url = request.url()
  if (!url.startsWith(baseUrl)) {
    const requestRecord = { method: request.method(), url }
    externalRequests.push(requestRecord)
    if (/^(POST|PUT|PATCH|DELETE)$/i.test(request.method())) externalMutations.push(requestRecord)
  }
})

await context.addInitScript((sceneGraph) => {
  window.localStorage.setItem('pascal-editor-scene', JSON.stringify(sceneGraph))
}, scene)

await page.route('**/api/intm/materials', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue) }),
)
await page.route('**/api/intm/projects', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ connected: true, projects: [project] }),
  }),
)
await page.route('**/api/intm/estimates', (route) => {
  if (route.request().method() !== 'POST') return route.continue()
  if (networkFailureUsed) return route.abort()
  const response = submitResponses[submitIndex] ?? submitResponses.at(-1)
  submitIndex += 1
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
})
// The editor's icon and material texture loaders use public static GETs. Keep
// this QA deterministic while preserving their request records as allowed
// non-mutating external traffic.
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
  branches: [],
  errorBranch: null,
  networkThrowBranch: null,
  consoleErrors,
  pageErrors,
  externalRequests,
  externalMutations,
  expectedNetworkConsoleErrors,
  expectedNetworkFailures,
}

try {
  await page.goto(`${baseUrl}/editor`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  const statsRailButton = page.getByRole('button', { name: '통계', exact: true }).first()
  await statsRailButton.waitFor()
  await statsRailButton.click()
  await page.getByText('통계 · 산출', { exact: true }).waitFor()
  await page.getByText('견적서 작성', { exact: true }).waitFor()
  await page.getByPlaceholder('프로젝트 검색 (이름 · 고객 · 주소)').fill('Fixture')
  await page.getByRole('button', { name: /Fixture project/ }).last().click()
  await page.getByPlaceholder('견적서 제목').fill('Fixture estimate')

  const submitButton = page.getByRole('button', { name: 'INTM에 견적서 생성' })
  const resultRegion = page.locator('[aria-live="polite"]').last()
  const expectedBranches = [
    {
      text: '견적서를 만들었습니다 (3개 항목).',
      href: 'https://intm.example.test/newportal/estimates/fixture-complete/edit',
      warningTone: false,
    },
    {
      text: '2개 항목이 추가됐고 1개가 실패했습니다',
      href: 'https://intm.example.test/newportal/estimates/fixture-partial/edit',
      warningTone: true,
    },
    {
      text: '빈 견적서는 생성됐지만 항목 추가에 전부 실패했습니다',
      href: 'https://intm.example.test/newportal/estimates/fixture-empty/edit',
      warningTone: true,
    },
  ]

  for (const [index, expected] of expectedBranches.entries()) {
    await submitButton.click()
    await resultRegion.getByText(expected.text, { exact: false }).waitFor()
    const link = resultRegion.locator('a')
    const branch = {
      index: index + 1,
      text: await resultRegion.innerText(),
      href: await link.getAttribute('href'),
      target: await link.getAttribute('target'),
      rel: await link.getAttribute('rel'),
      warningTone: (await resultRegion.getAttribute('class'))?.includes('amber') ?? false,
    }
    if (
      branch.href !== expected.href ||
      branch.target !== '_blank' ||
      branch.rel !== 'noopener noreferrer' ||
      branch.warningTone !== expected.warningTone
    ) {
      throw new Error(`Unexpected visible success branch: ${JSON.stringify(branch)}`)
    }
    result.branches.push(branch)
    await page.screenshot({
      path: new URL(`stats-${index === 0 ? 'complete' : index === 1 ? 'partial' : 'all-failed'}.png`, evidenceDir).pathname,
      fullPage: true,
    })
  }

  await submitButton.click()
  await resultRegion.getByText('fixture API rejected', { exact: true }).waitFor()
  result.errorBranch = {
    text: await resultRegion.innerText(),
    linkCount: await resultRegion.locator('a').count(),
    errorTone: (await resultRegion.getAttribute('class'))?.includes('red') ?? false,
  }
  if (result.errorBranch.linkCount !== 0 || !result.errorBranch.errorTone) {
    throw new Error(`Unexpected API error branch: ${JSON.stringify(result.errorBranch)}`)
  }

  networkFailureUsed = true
  expectingNetworkFailure = true
  await submitButton.click()
  await resultRegion.getByText(/Failed to fetch|fetch failed|네트워크|Network/i).waitFor()
  await page.waitForTimeout(100)
  expectingNetworkFailure = false
  result.networkThrowBranch = {
    text: await resultRegion.innerText(),
    linkCount: await resultRegion.locator('a').count(),
    errorTone: (await resultRegion.getAttribute('class'))?.includes('red') ?? false,
  }
  if (result.networkThrowBranch.linkCount !== 0 || !result.networkThrowBranch.errorTone) {
    throw new Error(`Unexpected network error branch: ${JSON.stringify(result.networkThrowBranch)}`)
  }
} catch (error) {
  result.failure = String(error)
  await page.screenshot({
    path: new URL('stats-failure.png', evidenceDir).pathname,
    fullPage: true,
  }).catch(() => {})
  throw error
} finally {
  result.consoleErrors = consoleErrors
  result.pageErrors = pageErrors
  result.externalRequests = externalRequests
  result.externalMutations = externalMutations
  result.expectedNetworkConsoleErrors = expectedNetworkConsoleErrors
  result.expectedNetworkFailures = expectedNetworkFailures
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(new URL('stats-qa-result.json', evidenceDir), `${JSON.stringify(result, null, 2)}\n`)
  await browser.close()
}

console.log(JSON.stringify(result, null, 2))

if (
  result.consoleErrors.length > 0 ||
  result.pageErrors.length > 0 ||
  result.externalMutations.length > 0
) {
  process.exitCode = 1
}
