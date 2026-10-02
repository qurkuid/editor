import { chromium } from '/Users/changseok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'

const baseUrl = process.env.QA_BASE_URL ?? 'https://apt.intm.kr'
const pageBaseUrl = process.env.QA_PAGE_BASE_URL ?? baseUrl
const scenePathPrefix = process.env.QA_SCENE_PATH_PREFIX ?? '/scene'
const evidenceDir = '/Users/changseok/editor/.omo/evidence/zone-finish-takeoff-20261002/public-browser'
const initialSceneId = `zone_takeoff_public_${Date.now()}`

if (process.env.QA_ACTIVATED !== '1') {
  throw new Error('Public QA is gated: wait for root activation and matching BUILD_ID, then set QA_ACTIVATED=1')
}

const ownedOrigins = new Set([new URL(baseUrl).origin, new URL(pageBaseUrl).origin, 'https://apt.intm.kr'])

const initialGraph = {
  nodes: {
    site_zone_qa: {
      object: 'node', id: 'site_zone_qa', type: 'site', parentId: null, visible: true,
      metadata: {}, children: ['building_zone_qa'],
      polygon: { type: 'polygon', points: [[-2, -2], [6, -2], [6, 6], [-2, 6]] },
    },
    building_zone_qa: {
      object: 'node', id: 'building_zone_qa', type: 'building', parentId: 'site_zone_qa',
      visible: true, metadata: {}, children: ['level_zone_qa'], position: [0, 0, 0], rotation: [0, 0, 0],
    },
    level_zone_qa: {
      object: 'node', id: 'level_zone_qa', type: 'level', parentId: 'building_zone_qa',
      visible: true, metadata: {}, level: 0, height: 2.5,
      children: ['wall_zone_qa', 'zone_zone_qa'],
    },
    wall_zone_qa: {
      object: 'node', id: 'wall_zone_qa', type: 'wall', parentId: 'level_zone_qa',
      visible: true, metadata: {}, children: [], start: [0, 0], end: [4, 0], thickness: 0.2,
      height: 2.5, frontSide: 'interior', backSide: 'exterior',
      slots: {
        interior: 'library:flooring-rusticbrick',
        lowerInterior: 'library:flooring-rusticbrick',
        upperInterior: 'library:wood-finewood27',
      },
      faceBands: { enabled: true, count: 2, lowerHeight: 1, middleHeight: 0.5, upperHeight: 0.5 },
    },
    zone_zone_qa: {
      object: 'node', id: 'zone_zone_qa', type: 'zone', name: 'Half Wall Zone', parentId: 'level_zone_qa',
      visible: true, metadata: {}, children: [], polygon: [[0, 0], [2, 0], [2, 4], [0, 4]],
      autoFromWalls: false, boundaryWallIds: [], spaceRole: 'room', roomNumber: 'Z-001',
      enclosureStatus: 'open', floorFinish: '', wallFinish: '', ceilingFinish: '', ceilingHeight: 2.5,
      occupancy: '', clearDimensionPolicy: 'inside-faces', color: '#3b82f6',
    },
  },
  rootNodeIds: ['site_zone_qa'],
}

const builtinCatalog = [
  { id: 1, name: '우드', productCount: 1, seamlessProductCount: 1 },
]
const catalogueRequestResponse = {
  products: [], next: null, pageNum: 0, total: 0,
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
function graphNodes(body) {
  return body?.graph?.nodes ?? body?.nodes ?? {}
}
function getWall(body) {
  return Object.values(graphNodes(body)).find((node) => node?.id === 'wall_zone_qa')
}
function finishRegions(body) {
  return getWall(body)?.finishRegions ?? []
}
function statLine(page, ref) {
  const label = page.getByText(new RegExp(`벽 마감 ${ref.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`)).first()
  return label.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
}
async function openStats(page) {
  const panel = page.getByText('통계 · 산출', { exact: true })
  if (!(await panel.isVisible().catch(() => false))) {
    const button = page.getByRole('button', { name: '통계', exact: true }).first()
    await button.click()
  }
  await panel.waitFor()
  await page.waitForTimeout(600)
}

const createResponse = await fetch(`${baseUrl}/api/scenes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: initialSceneId, name: 'Zone takeoff QA', projectId: 'zone-fixture', graph: initialGraph }),
})
const createBody = await createResponse.text()
assert(createResponse.ok, `fixture scene creation failed: ${createResponse.status} ${createBody}`)
const created = JSON.parse(createBody)
const sceneId = created.id

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)
const consoleErrors = []
const pageErrors = []
const externalRequests = []
const externalMutations = []
const saveRequests = []
const sceneResponses = []
const graphSnapshots = []
const failedResponses = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('request', (request) => {
  const parsed = new URL(request.url())
  const local = ownedOrigins.has(parsed.origin)
  if (!local) {
    const record = { method: request.method(), url: request.url() }
    externalRequests.push(record)
    if (/^(POST|PUT|PATCH|DELETE)$/i.test(request.method())) externalMutations.push(record)
  }
  if (local && request.method() === 'PUT' && parsed.pathname === `/api/scenes/${sceneId}`) {
    let body = null
    try { body = request.postDataJSON() } catch {}
    saveRequests.push(body)
  }
})
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push({ method: response.request().method(), status: response.status(), url: response.url() })
  const parsed = new URL(response.url())
  const local = ownedOrigins.has(parsed.origin)
  if (local && parsed.pathname === `/api/scenes/${sceneId}` && /^(GET|PUT)$/i.test(response.request().method())) {
    sceneResponses.push({ method: response.request().method(), status: response.status() })
  }
})

await page.route('**/api/finish-templates**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) }),
)
await page.route('**/api/scenes/**/thumbnail', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
)
await page.route('**/api/intm/materials', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false, materials: [], categories: [], intmBaseUrl: null, reason: 'not-configured' }) }),
)
await page.route('**/api/materials/rawpainter/asset**', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }),
)
await page.route('**/api/materials/rawpainter**', async (route) => {
  const url = new URL(route.request().url())
  if (url.searchParams.get('view') === 'categories') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(builtinCatalog) })
  }
  if (url.searchParams.get('view') === 'brands') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogueRequestResponse) })
})
await page.route('**/api/materials/rawpainter/asset/**', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }),
)
await page.route('https://api.iconify.design/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"prefix":"fixture","icons":{}}' }),
)
await page.route('https://api.unisvg.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"prefix":"fixture","icons":{}}' }),
)
await page.route('https://editor.pascal.app/material/**', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }),
)

const result = {
  baseUrl, pageBaseUrl, scenePathPrefix, sceneId, initialGraph, failedResponses: [],
  apply: null, appliedRef: null, stats: null, undo: null, redo: null, reload: null,
  saveRequests: 0, sceneResponses: [], consoleErrors, pageErrors, externalRequests, externalMutations,
}
try {
  await page.goto(`${pageBaseUrl}${scenePathPrefix}/${sceneId}`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  await page.getByRole('button', { name: '장면', exact: true }).click()
  await page.getByRole('button', { name: /Zones/ }).click()
  await page.getByText('Half Wall Zone', { exact: true }).first().click()
  await page.getByText('실제 마감 자재', { exact: true }).waitFor()
  const allWalls = page.getByRole('button', { name: /^전체 벽면:/ })
  await allWalls.waitFor()
  await allWalls.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const search = dialog.getByPlaceholder('제품명, 브랜드, 판매처 검색')
  await search.fill('Concrete Plate')
  await search.press('Enter')
  const concrete = dialog.getByTitle('Concrete Plate')
  await concrete.waitFor()
  await concrete.click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByText('실제 마감 자재', { exact: true }).waitFor()
  await page.waitForTimeout(2500)
  await waitFor(() => saveRequests.some((body) => finishRegions(body).length === 1 || JSON.stringify(getWall(body)?.slots ?? {}).includes('concrete-plate')), 'autosave after Zone apply')
  const appliedBody = [...saveRequests].reverse().find((body) => finishRegions(body).length === 1 || JSON.stringify(getWall(body)?.slots ?? {}).includes('concrete-plate')) ?? saveRequests.at(-1)
  console.log('save-snapshots', JSON.stringify(saveRequests.map((body) => ({regions: finishRegions(body), slots: getWall(body)?.slots})), null, 2))
  result.apply = { finishRegions: finishRegions(appliedBody), wall: getWall(appliedBody) }
  const selectedRef = result.apply.finishRegions[0]?.slots?.interior
  result.appliedRef = selectedRef
  assert(typeof selectedRef === 'string' && selectedRef.length > 0, 'applied region material ref was not saved')
  assert(result.apply.finishRegions.length === 1, `expected one partial finish region, got ${result.apply.finishRegions.length}`)
  assert(Math.abs(result.apply.finishRegions[0].start - 0) < 1e-6 && Math.abs(result.apply.finishRegions[0].end - 0.5) < 1e-6, 'Zone region was not the expected half wall interval')

  await openStats(page)
  const concreteLine = statLine(page, selectedRef)
  const brickLine = statLine(page, 'library:flooring-rusticbrick')
  const woodLine = statLine(page, 'library:wood-finewood27')
  await concreteLine.waitFor(); await brickLine.waitFor(); await woodLine.waitFor()
  const statsText = await page.locator('body').innerText()
  result.stats = {
    concrete: await concreteLine.innerText(),
    brick: await brickLine.innerText(),
    wood: await woodLine.innerText(),
    bodyIncludesExpected: /5\.00/.test(await concreteLine.innerText()) && /2\.00/.test(await brickLine.innerText()) && /3\.00/.test(await woodLine.innerText()),
  }
  assert(/5\.00/.test(result.stats.concrete), `Zone material quantity was not 5m²: ${result.stats.concrete}`)
  assert(/2\.00/.test(result.stats.brick), `lower fallback quantity was not 2m²: ${result.stats.brick}`)
  assert(/3\.00/.test(result.stats.wood), `upper fallback quantity was not 3m²: ${result.stats.wood}`)
  await page.screenshot({ path: `${evidenceDir}/zone-finish-stats-applied.png`, fullPage: true })

  await page.keyboard.press('Meta+z')
  await waitFor(() => saveRequests.length >= 2, 'autosave after undo')
  await page.waitForTimeout(700)
  await openStats(page)
  const undoText = await page.locator('body').innerText()
  result.undo = {
    concreteVisible: selectedRef ? undoText.includes(selectedRef) : false,
    finishRegions: finishRegions(saveRequests.at(-1)),
  }
  assert(!result.undo.concreteVisible, 'Undo did not remove the Zone material from Stats')
  assert(result.undo.finishRegions.length === 0, 'Undo did not restore the original wall regions')
  await page.screenshot({ path: `${evidenceDir}/zone-finish-stats-undo.png`, fullPage: true })

  await page.keyboard.press('Meta+Shift+z')
  await waitFor(() => saveRequests.length >= 3, 'autosave after redo')
  await page.waitForTimeout(700)
  await openStats(page)
  await statLine(page, selectedRef).waitFor()
  result.redo = { finishRegions: finishRegions(saveRequests.at(-1)) }
  assert(result.redo.finishRegions.length === 1, 'Redo did not restore the Zone region')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Ground Floor', { exact: true }).waitFor()
  await page.getByRole('button', { name: '장면', exact: true }).click()
  await page.getByRole('button', { name: /Zones/ }).click()
  await page.getByText('Half Wall Zone', { exact: true }).first().click()
  await page.getByText('실제 마감 자재', { exact: true }).waitFor()
  await openStats(page)
  const reloadConcrete = statLine(page, selectedRef)
  const reloadBrick = statLine(page, 'library:flooring-rusticbrick')
  const reloadWood = statLine(page, 'library:wood-finewood27')
  await reloadConcrete.waitFor(); await reloadBrick.waitFor(); await reloadWood.waitFor()
  result.reload = {
    concrete: await reloadConcrete.innerText(),
    brick: await reloadBrick.innerText(),
    wood: await reloadWood.innerText(),
    responses: sceneResponses.slice(),
  }
  assert(/5\.00/.test(result.reload.concrete), `reload Zone quantity was not 5m²: ${result.reload.concrete}`)
  assert(/2\.00/.test(result.reload.brick), `reload lower fallback quantity was not 2m²: ${result.reload.brick}`)
  assert(/3\.00/.test(result.reload.wood), `reload upper fallback quantity was not 3m²: ${result.reload.wood}`)
  await page.screenshot({ path: `${evidenceDir}/zone-finish-stats-reloaded.png`, fullPage: true })
} catch (error) {
  result.failure = String(error)
  await page.screenshot({ path: `${evidenceDir}/zone-finish-qa-failure.png`, fullPage: true }).catch(() => {})
  throw error
} finally {
  result.saveRequests = saveRequests.length
  result.sceneResponses = sceneResponses
  result.failedResponses = failedResponses
  result.consoleErrors = consoleErrors
  result.pageErrors = pageErrors
  result.externalRequests = externalRequests
  result.externalMutations = externalMutations
  writeFileSync(`${evidenceDir}/zone-finish-qa-result.json`, `${JSON.stringify(result, null, 2)}\n`)
  await browser.close()
}
console.log(JSON.stringify(result, null, 2))
if (result.consoleErrors.length || result.pageErrors.length || result.externalMutations.length) process.exitCode = 1
