import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codexFailureSummary,
  getCodexCliStatus,
  parseCodexCliPlan,
  requestAiModelingPlan,
} from './ai-cli-provider'
import { AiChatRequestSchema } from './ai-provider'

const emptyFieldPatch = {
  id: null,
  nodeJson: null,
  dataJson: null,
  parentId: null,
  cascade: null,
  faceId: null,
  distance: null,
  translation: null,
  rotationY: null,
  uniformScale: null,
  pivot: null,
}

describe('Codex CLI provider boundary', () => {
  test('falls back to another installed CLI when the first binary is broken', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-fallback-'))
    const brokenCommand = join(directory, 'broken-codex')
    const connectedCommand = join(directory, 'connected-codex')
    await writeFile(brokenCommand, '#!/bin/sh\nexit 1\n')
    await writeFile(connectedCommand, '#!/bin/sh\necho "Logged in using ChatGPT"\n')
    await chmod(brokenCommand, 0o755)
    await chmod(connectedCommand, 0o755)

    try {
      const status = await getCodexCliStatus({ command: brokenCommand, model: null }, [
        connectedCommand,
      ])

      expect(status).toEqual({
        connected: true,
        authMethod: 'chatgpt',
        command: connectedCommand,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('converts the CLI flat patch shape into the editor patch contract', () => {
    const plan = parseCodexCliPlan({
      message: 'Wall ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'create',
          nodeJson: '{"id":"wall_cli","type":"wall"}',
          parentId: 'level_1',
        },
      ],
    })

    expect(plan).toEqual({
      message: 'Wall ready.',
      patches: [{ op: 'create', node: { id: 'wall_cli', type: 'wall' }, parentId: 'level_1' }],
    })
  })

  test('accepts an update whose payload was echoed into nodeJson, minus identity fields', () => {
    const plan = parseCodexCliPlan({
      message: 'Finish set.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'update',
          id: 'zone_public',
          nodeJson:
            '{"object":"node","id":"zone_public","type":"zone","name":"공용부","wallFinish":"도배지 - 회벽 화이트"}',
        },
      ],
    })

    expect(plan).toEqual({
      message: 'Finish set.',
      patches: [
        {
          op: 'update',
          id: 'zone_public',
          data: { name: '공용부', wallFinish: '도배지 - 회벽 화이트' },
        },
      ],
    })
  })

  test('an update with neither dataJson nor nodeJson still fails validation', () => {
    expect(() =>
      parseCodexCliPlan({
        message: 'Broken update.',
        patches: [{ ...emptyFieldPatch, op: 'update', id: 'zone_public' }],
      }),
    ).toThrow()
  })

  test('converts a deterministic body push pull command from the CLI contract', () => {
    const plan = parseCodexCliPlan({
      message: 'Body face ready to push.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'pushPullBodyFace',
          id: 'body_selected',
          faceId: 'face:0',
          distance: 1.2,
        },
      ],
    })

    expect(plan).toEqual({
      message: 'Body face ready to push.',
      patches: [{ op: 'pushPullBodyFace', id: 'body_selected', faceId: 'face:0', distance: 1.2 }],
    })
  })

  test('converts a rounded hollow frame command without raw topology', () => {
    const plan = parseCodexCliPlan({
      message: 'Rounded frame ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'createRoundedRectangularFrameBody',
          id: 'body_rounded_frame',
          parentId: 'level_1',
          dataJson:
            '{"name":"Rounded frame wall","origin":[0,0,0],"width":2,"height":2.4,"depth":0.1,"openingWidth":1,"openingHeight":0.8,"topCornerRadius":0.2}',
        },
      ],
    })

    expect(plan.patches).toEqual([
      {
        op: 'createRoundedRectangularFrameBody',
        id: 'body_rounded_frame',
        parentId: 'level_1',
        name: 'Rounded frame wall',
        origin: [0, 0, 0],
        width: 2,
        height: 2.4,
        depth: 0.1,
        openingWidth: 1,
        openingHeight: 0.8,
        topCornerRadius: 0.2,
      },
    ])
  })

  test('converts a furniture command into the shared normalized operation', () => {
    const plan = parseCodexCliPlan({
      message: 'Wardrobe ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'createFurniture',
          id: 'cabinet_wardrobe',
          parentId: 'level_1',
          dataJson:
            '{"name":"Wardrobe","position":[0,0,0],"rotationY":0,"furnitureKind":"wardrobe","dimensions":{"width":2.4,"height":2.4,"depth":0.6},"bayCount":2}',
        },
      ],
    })

    expect(plan.patches).toEqual([
      {
        op: 'createFurniture',
        id: 'cabinet_wardrobe',
        parentId: 'level_1',
        name: 'Wardrobe',
        position: [0, 0, 0],
        rotationY: 0,
        furnitureKind: 'wardrobe',
        dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
        bayCount: 2,
      },
    ])
  })

  test('converts a tier interior command with stable cabinet, bay, and tier IDs', () => {
    const plan = parseCodexCliPlan({
      message: 'Tier interior ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'setFurnitureTierInterior',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0","tierId":"bay-0-tier-0","shelfCount":3,"hanger":true}',
        },
      ],
    })

    expect(plan.patches).toEqual([
      {
        op: 'setFurnitureTierInterior',
        id: 'cabinet_wardrobe',
        bayId: 'bay-0',
        tierId: 'bay-0-tier-0',
        shelfCount: 3,
        hanger: true,
      },
    ])
  })

  test('converts all structural furniture commands from flat CLI data', () => {
    const plan = parseCodexCliPlan({
      message: 'Furniture structure ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'insertFurnitureBay',
          id: 'cabinet_wardrobe',
          dataJson: '{"afterBayId":"bay-0","newWidth":0.4}',
        },
        {
          ...emptyFieldPatch,
          op: 'resizeFurnitureBay',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0-copy","width":0.5}',
        },
        {
          ...emptyFieldPatch,
          op: 'deleteFurnitureBay',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0-copy"}',
        },
        {
          ...emptyFieldPatch,
          op: 'insertFurnitureTier',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0","afterTierId":"bay-0-tier-0","newHeight":0.8}',
        },
        {
          ...emptyFieldPatch,
          op: 'resizeFurnitureTier',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0","tierId":"bay-0-tier-0","height":1.1}',
        },
        {
          ...emptyFieldPatch,
          op: 'deleteFurnitureTier',
          id: 'cabinet_wardrobe',
          dataJson: '{"bayId":"bay-0","tierId":"bay-0-tier-0-copy"}',
        },
      ],
    })

    expect(plan.patches.map((patch) => patch.op)).toEqual([
      'insertFurnitureBay',
      'resizeFurnitureBay',
      'deleteFurnitureBay',
      'insertFurnitureTier',
      'resizeFurnitureTier',
      'deleteFurnitureTier',
    ])
    expect(plan.patches[0]).toMatchObject({ afterBayId: 'bay-0', newWidth: 0.4 })
    expect(plan.patches[4]).toMatchObject({ tierId: 'bay-0-tier-0', height: 1.1 })
  })

  test('converts a body face material command without rewriting body topology', () => {
    const plan = parseCodexCliPlan({
      message: 'Matte red paint ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'paintBodyFace',
          id: 'body_selected',
          dataJson:
            '{"id":"mat_body_red","name":"Matte red paint","material":{"preset":"custom","properties":{"color":"#b91c1c","roughness":0.85,"metalness":0}}}',
          faceId: 'face:0',
        },
      ],
    })

    expect(plan.patches).toEqual([
      {
        op: 'paintBodyFace',
        id: 'body_selected',
        faceId: 'face:0',
        material: {
          id: 'mat_body_red',
          name: 'Matte red paint',
          material: {
            preset: 'custom',
            properties: {
              color: '#b91c1c',
              roughness: 0.85,
              metalness: 0,
              opacity: 1,
              transparent: false,
              side: 'front',
            },
          },
        },
      },
    ])
  })

  test('normalizes a flattened CLI body material into a scene material', () => {
    const plan = parseCodexCliPlan({
      message: 'Red paint ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'paintBodyFace',
          id: 'body_selected',
          dataJson:
            '{"id":"mat_body_red","preset":"custom","properties":{"color":"#b91c1c","roughness":0.85,"metalness":0}}',
          faceId: 'face:0',
        },
      ],
    })

    expect(plan.patches[0]).toMatchObject({
      op: 'paintBodyFace',
      material: {
        id: 'mat_body_red',
        name: 'AI material mat_body_red',
        material: { properties: { color: '#b91c1c', roughness: 0.85, metalness: 0 } },
      },
    })
  })

  test('converts an AI seamless material command into the editor contract', () => {
    // Given: the CLI targets one scene material through its stable id.
    const cliPlan = {
      message: 'Seamless material ready.',
      patches: [
        {
          ...emptyFieldPatch,
          op: 'makeMaterialSeamless',
          dataJson: '{"materialId":"mat_rawpainter_70225"}',
        },
      ],
    }

    // When: the CLI response crosses the typed plan boundary.
    const plan = parseCodexCliPlan(cliPlan)

    // Then: the editor receives a deterministic material operation, not image pixels.
    expect(plan.patches).toEqual([
      { op: 'makeMaterialSeamless', materialId: 'mat_rawpainter_70225' },
    ])
  })

  test('retries once with validation feedback when the plan fails the contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-retry-'))
    const command = join(directory, 'codex-fixture')
    const counterPath = join(directory, 'count')
    await writeFile(
      command,
      `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
count=0
[ -f ${JSON.stringify(counterPath)} ] && count=$(cat ${JSON.stringify(counterPath)})
count=$((count + 1))
printf '%s' "$count" > ${JSON.stringify(counterPath)}
cat > ${JSON.stringify(directory)}/prompt-$count
if [ "$count" = "1" ]; then
  printf '%s' '{"message":"first try","patches":[{"op":"update","id":"zone_1","nodeJson":null,"dataJson":null,"parentId":null,"cascade":null,"faceId":null,"distance":null,"translation":null,"rotationY":null,"uniformScale":null,"pivot":null}]}' > "$output"
else
  printf '%s' '{"message":"second try ready.","patches":[]}' > "$output"
fi
`,
    )
    await chmod(command, 0o755)

    try {
      const plan = await requestAiModelingPlan(
        AiChatRequestSchema.parse({
          messages: [{ role: 'user', content: 'Inspect the scene' }],
          scene: {
            coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
            nodeCount: 0,
            nodes: {},
            rootNodeIds: [],
            materials: {},
            selection: {
              buildingId: null,
              levelId: null,
              zoneId: null,
              selectedIds: [],
              selectedNodes: [],
            },
          },
        }),
        { command, model: null },
      )

      expect(plan).toEqual({ message: 'second try ready.', patches: [] })
      expect(await readFile(counterPath, 'utf8')).toBe('2')
      const retryPrompt = await readFile(join(directory, 'prompt-2'), 'utf8')
      expect(retryPrompt).toContain('failed schema validation')
      expect(retryPrompt).toContain('first try')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('returns a structured plan from a Codex CLI process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-test-'))
    const command = join(directory, 'codex-fixture')
    await writeFile(
      command,
      `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
printf '%s' '{"message":"CLI plan ready.","patches":[]}' > "$output"
`,
    )
    await chmod(command, 0o755)

    try {
      const plan = await requestAiModelingPlan(
        {
          messages: [{ role: 'user', content: 'Inspect the scene' }],
          scene: {
            coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
            nodeCount: 0,
            nodes: {},
            rootNodeIds: [],
            materials: {},
            selection: {
              buildingId: null,
              levelId: null,
              zoneId: null,
              selectedIds: [],
              selectedNodes: [],
            },
          },
        },
        { command, model: null },
      )

      expect(plan).toEqual({ message: 'CLI plan ready.', patches: [] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('passes validated images as temporary --image files without adding base64 to the prompt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-image-test-'))
    const command = join(directory, 'codex-fixture')
    const capturePath = join(directory, 'captured')
    const promptPath = join(directory, 'prompt.txt')
    await writeFile(
      command,
      `#!/bin/sh
prompt_path=${JSON.stringify(promptPath)}
capture_path=${JSON.stringify(capturePath)}
cat > "$prompt_path"
image_number=0
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--image" ]; then
    shift
    image_number=$((image_number + 1))
    cat "$1" > "$capture_path.$image_number"
    printf '%s\\n' "$1" >> "$capture_path.paths"
  elif [ "$1" = "-o" ]; then
    shift
    output="$1"
  fi
  shift
done
printf '%s' "$image_number" > "$capture_path.count"
printf '%s' '{"message":"CLI plan ready.","patches":[]}' > "$output"
`,
    )
    await chmod(command, 0o755)

    try {
      const request = AiChatRequestSchema.parse({
        messages: [{ role: 'user', content: 'Use the attached references' }],
        images: [
          {
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
          },
          {
            name: 'reference.jpg',
            mimeType: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,d29ybGQ=',
          },
        ],
        scene: {
          coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
          nodeCount: 0,
          nodes: {},
          rootNodeIds: [],
          materials: {},
          selection: {
            buildingId: null,
            levelId: null,
            zoneId: null,
            selectedIds: [],
            selectedNodes: [],
          },
        },
      })

      const plan = await requestAiModelingPlan(request, { command, model: null })

      expect(plan).toEqual({ message: 'CLI plan ready.', patches: [] })
      expect(await readFile(`${capturePath}.count`, 'utf8')).toBe('2')
      expect(await readFile(`${capturePath}.1`, 'utf8')).toBe('hello')
      expect(await readFile(`${capturePath}.2`, 'utf8')).toBe('world')
      const prompt = await readFile(promptPath, 'utf8')
      expect(prompt).not.toContain('aGVsbG8=')
      expect(prompt).not.toContain('d29ybGQ=')

      const imagePaths = (await readFile(`${capturePath}.paths`, 'utf8')).trim().split('\n')
      expect(imagePaths).toHaveLength(2)
      expect(imagePaths.every((imagePath) => !existsSync(imagePath))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('codex stderr is reduced to what went wrong', () => {
  // Codex echoes the full invocation — schema included — before its ERROR
  // lines, so raw stderr buried the one sentence that mattered.
  test('the ERROR lines survive, the schema dump does not', () => {
    const stderr = `{"type":"object","properties":{...100KB of schema...}}\nERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 12:35 PM.`
    const summary = codexFailureSummary(stderr)
    expect(summary).toContain('usage limit')
    expect(summary).not.toContain('"type":"object"')
  })

  test('duplicate ERROR lines collapse to one', () => {
    const summary = codexFailureSummary('ERROR: boom\nERROR: boom')
    expect(summary).toBe('ERROR: boom')
  })

  test('no ERROR line falls back to the last lines', () => {
    expect(codexFailureSummary('a\nb\nc\nd')).toBe('b\nc\nd')
  })

  test('empty stderr still names the CLI', () => {
    expect(codexFailureSummary('')).toBe('Codex CLI failed')
  })
})
