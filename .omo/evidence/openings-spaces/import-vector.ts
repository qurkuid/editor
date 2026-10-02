import { readFileSync, writeFileSync } from 'node:fs'
import { buildVectorNodes } from '../../../apps/editor/lib/apt-vector-scene'

const input = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
const built = buildVectorNodes(input.data ?? input)
if (!built) throw new Error('Vector conversion failed')
const nodes = [...built.walls, ...built.openings, ...built.zones]
writeFileSync(process.argv[3]!, JSON.stringify({ nodes: Object.fromEntries(nodes.map(node => [node.id, node])), diagnostics: built.diagnostics }, null, 2))
console.log(JSON.stringify({ walls: built.walls.length, openings: built.openings.length, zones: built.zones.length, diagnostics: built.diagnostics }))
