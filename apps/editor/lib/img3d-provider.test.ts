import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Img3dRequestSchema } from './img3d-contract'
import { parseImg3dClaudeOutput, requestImg3dSculptViaCodex } from './img3d-provider'

const request = Img3dRequestSchema.parse({
  image: {
    name: 'chair.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,aGVsbG8=',
  },
  dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
  provider: 'codex',
})

const validSculpt = {
  version: 1,
  name: 'Chair',
  materials: [{ name: 'wood', color: '#8b5e3c', roughness: 0.7, metalness: 0, slot: null }],
  parts: [
    {
      name: 'seat',
      primitive: 'box',
      material: 0,
      position: [0, 0.45, 0],
      rotation: [0, 0, 0],
      size: [1.2, 0.1, 0.6],
    },
  ],
}

describe('img3d structured provider boundary', () => {
  test('parses Claude structured output and rejects prose envelopes', () => {
    expect(
      parseImg3dClaudeOutput(
        JSON.stringify({ type: 'result', is_error: false, structured_output: validSculpt }),
      ),
    ).toEqual(validSculpt)
    expect(() =>
      parseImg3dClaudeOutput(JSON.stringify({ result: JSON.stringify(validSculpt) })),
    ).toThrow()
  })

  test('Codex retries exactly once after a Zod mismatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-img3d-codex-'))
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
cat > /dev/null
if [ "$count" = "1" ]; then
  printf '%s' '{"version":1,"name":"bad","materials":[],"parts":[]}' > "$output"
else
  printf '%s' '${JSON.stringify(validSculpt)}' > "$output"
fi
`,
    )
    await chmod(command, 0o755)

    try {
      const sculpt = await requestImg3dSculptViaCodex(request, { command, model: null })
      expect(sculpt).toEqual(validSculpt)
      expect(await readFile(counterPath, 'utf8')).toBe('2')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
