import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const source = join(import.meta.dir, '../../../ontology/pascal-architecture-core')
const target = join(import.meta.dir, '../dist/ontology/pascal-architecture-core')

await mkdir(join(import.meta.dir, '../dist/ontology'), { recursive: true })
await cp(source, target, { recursive: true, force: true })
