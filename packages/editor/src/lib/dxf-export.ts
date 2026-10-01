import { Box3, InstancedMesh, Matrix4, Mesh, type Object3D, Vector3 } from 'three'

export type DxfImage = {
  name: string
  filename: string
  width: number
  height: number
  origin: Vector3
  u: Vector3
  v: Vector3
}

export function exportSceneToDxf(scene: Object3D, images: DxfImage[] = []): string {
  const items = new Map<string, { layer: string; meshes: Mesh[] }>()
  const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_$-]/g, '_')
  const collect = (object: Object3D, owner?: string, layer = 'Pascal_Object') => {
    if (!object.visible) return
    if (object.userData.kind === 'guide') return
    if (typeof object.userData.pascalId === 'string') {
      owner = safeName(object.userData.pascalId)
      const kind = String(object.userData.kind ?? 'object')
      layer = `Pascal_${safeName(kind.charAt(0).toUpperCase() + kind.slice(1))}`
    }
    if (object instanceof Mesh && object.geometry.getAttribute('position')?.count) {
      const id = owner ?? `mesh_${items.size}`
      const item = items.get(id) ?? { layer, meshes: [] }
      item.meshes.push(object)
      items.set(id, item)
    }
    for (const child of object.children) collect(child, owner, layer)
  }
  scene.updateWorldMatrix(true, true)
  collect(scene)

  const lines: string[] = []
  const emit = (...values: (string | number)[]) => {
    for (const value of values) lines.push(String(value))
  }
  const layers = [
    '0',
    ...new Set([...items.values()].map((item) => item.layer)),
    ...(images.length ? ['Pascal_Guide'] : []),
  ]
  const bounds = new Box3()
  let nextHandle = 1
  const handle = () => (nextHandle++).toString(16).toUpperCase()
  const rootDict = handle(),
    groupDict = handle(),
    imageDict = handle()
  const blocks = new Map(
    ['*Model_Space', '*Paper_Space', ...items.keys()].map((name) => [name, handle()]),
  )
  const modelSpace = blocks.get('*Model_Space')!
  const rasters = images.map((image) => ({
    ...image,
    entity: handle(),
    definition: handle(),
    reactor: handle(),
  }))
  const entity = (type: string, owner: string, subclass: string, layer = '0', id = handle()) => {
    emit(0, type, 5, id, 330, owner, 100, 'AcDbEntity', 8, layer, 100, subclass)
  }
  const table = (name: string, count: number) => {
    const id = handle()
    emit(0, 'TABLE', 2, name, 5, id, 330, '0', 100, 'AcDbSymbolTable', 70, count)
    return id
  }
  const record = (type: string, owner: string, subclass: string, id = handle()) => {
    emit(
      0,
      type,
      type === 'DIMSTYLE' ? 105 : 5,
      id,
      330,
      owner,
      100,
      'AcDbSymbolTableRecord',
      100,
      subclass,
    )
  }
  const point = (code: number, p: Vector3) => emit(code, p.x, code + 10, p.y, code + 20, p.z)
  emit(0, 'SECTION', 2, 'CLASSES')
  for (const [name, cpp, isEntity] of [
    ['IMAGE', 'AcDbRasterImage', 1],
    ['IMAGEDEF', 'AcDbRasterImageDef', 0],
    ['IMAGEDEF_REACTOR', 'AcDbRasterImageDefReactor', 0],
  ] as const) {
    emit(0, 'CLASS', 1, name, 2, cpp, 3, 'ISM', 90, 0, 91, images.length, 280, 0, 281, isEntity)
  }
  emit(0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES')
  for (const name of ['VPORT', 'VIEW', 'UCS']) {
    table(name, 0)
    emit(0, 'ENDTAB')
  }
  const ltype = table('LTYPE', 3)
  for (const name of ['BYBLOCK', 'BYLAYER', 'CONTINUOUS']) {
    record('LTYPE', ltype, 'AcDbLinetypeTableRecord')
    emit(2, name, 70, 0, 3, '', 72, 65, 73, 0, 40, 0)
  }
  emit(0, 'ENDTAB')
  const layerTable = table('LAYER', layers.length)
  for (const layer of layers) {
    record('LAYER', layerTable, 'AcDbLayerTableRecord')
    emit(2, layer, 70, 0, 62, 7, 6, 'CONTINUOUS')
  }
  emit(0, 'ENDTAB')
  const style = table('STYLE', 1)
  record('STYLE', style, 'AcDbTextStyleTableRecord')
  emit(2, 'Standard', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '', 0, 'ENDTAB')
  const appid = table('APPID', 1)
  record('APPID', appid, 'AcDbRegAppTableRecord')
  emit(2, 'ACAD', 70, 0, 0, 'ENDTAB')
  const dimstyle = table('DIMSTYLE', 1)
  record('DIMSTYLE', dimstyle, 'AcDbDimStyleTableRecord')
  emit(2, 'Standard', 70, 0, 0, 'ENDTAB')
  const blockTable = table('BLOCK_RECORD', blocks.size)
  for (const [name, id] of blocks) {
    record('BLOCK_RECORD', blockTable, 'AcDbBlockTableRecord', id)
    emit(2, name)
  }
  emit(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'BLOCKS')
  const instanceMatrix = new Matrix4()
  for (const [name, blockId] of blocks) {
    entity('BLOCK', blockId, 'AcDbBlockBegin')
    emit(2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '')
    for (const mesh of items.get(name)?.meshes ?? []) {
      const geometry = mesh.geometry
      const vertexCount = geometry.index?.count ?? geometry.getAttribute('position').count
      const groups = Array.isArray(mesh.material)
        ? geometry.groups
        : [{ start: 0, count: vertexCount, materialIndex: 0 }]
      const instanceCount = mesh instanceof InstancedMesh ? mesh.count : 1
      for (let instance = 0; instance < instanceCount; instance++) {
        const matrix = mesh.matrixWorld.clone()
        if (mesh instanceof InstancedMesh) {
          mesh.getMatrixAt(instance, instanceMatrix)
          matrix.multiply(instanceMatrix)
        }
        for (const group of groups) {
          const material = Array.isArray(mesh.material)
            ? mesh.material[group.materialIndex ?? 0]
            : mesh.material
          if (!material?.visible || !material.colorWrite) continue
          const start = Math.max(group.start, geometry.drawRange.start)
          const end = Math.min(
            group.start + group.count,
            geometry.drawRange.start + geometry.drawRange.count,
            vertexCount,
          )
          for (let offset = start; offset + 2 < end; offset += 3) {
            const points = [0, 1, 2].map((corner) => {
              const index = geometry.index?.getX(offset + corner) ?? offset + corner
              const p = mesh.getVertexPosition(index, new Vector3()).applyMatrix4(matrix)
              if (![p.x, p.y, p.z].every(Number.isFinite))
                throw new Error(`DXF: non-finite geometry in ${name}`)
              return new Vector3(p.x * 1000, -p.z * 1000, p.y * 1000)
            })
            if (matrix.determinant() < 0) [points[1], points[2]] = [points[2]!, points[1]!]
            const [a, b, c] = points as [Vector3, Vector3, Vector3]
            if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-12) continue
            entity('3DFACE', blockId, 'AcDbFace')
            for (const [index, point] of [a, b, c, c].entries()) {
              bounds.expandByPoint(point)
              emit(10 + index, point.x, 20 + index, point.y, 30 + index, point.z)
            }
          }
        }
      }
    }
    entity('ENDBLK', blockId, 'AcDbBlockEnd')
  }
  emit(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  for (const [name, item] of items) {
    entity('INSERT', modelSpace, 'AcDbBlockReference', item.layer)
    emit(2, name, 10, 0, 20, 0, 30, 0)
  }
  for (const image of rasters) {
    if (
      ![
        image.width,
        image.height,
        ...image.origin.toArray(),
        ...image.u.toArray(),
        ...image.v.toArray(),
      ].every(Number.isFinite) ||
      image.width <= 0 ||
      image.height <= 0
    )
      throw new Error('DXF: invalid floorplan image')
    entity('IMAGE', modelSpace, 'AcDbRasterImage', 'Pascal_Guide', image.entity)
    emit(90, 0)
    point(10, image.origin)
    point(11, image.u)
    point(12, image.v)
    emit(
      13,
      image.width,
      23,
      image.height,
      340,
      image.definition,
      70,
      3,
      280,
      0,
      281,
      50,
      282,
      50,
      283,
      0,
      360,
      image.reactor,
      71,
      1,
      91,
      2,
      14,
      -0.5,
      24,
      -0.5,
      14,
      image.width - 0.5,
      24,
      image.height - 0.5,
    )
    for (const x of [0, image.width])
      for (const y of [0, image.height])
        bounds.expandByPoint(
          image.origin.clone().addScaledVector(image.u, x).addScaledVector(image.v, y),
        )
  }
  emit(0, 'ENDSEC', 0, 'SECTION', 2, 'OBJECTS')
  const dictionary = (id: string, owner: string, entries: [string, string][]) => {
    emit(0, 'DICTIONARY', 5, id, 330, owner, 100, 'AcDbDictionary', 281, 1)
    for (const [name, target] of entries) emit(3, name, 350, target)
  }
  dictionary(rootDict, '0', [
    ['ACAD_GROUP', groupDict],
    ['ACAD_IMAGE_DICT', imageDict],
  ])
  dictionary(groupDict, rootDict, [])
  dictionary(
    imageDict,
    rootDict,
    rasters.map((image) => [image.name, image.definition]),
  )
  for (const image of rasters) {
    emit(
      0,
      'IMAGEDEF',
      5,
      image.definition,
      102,
      '{ACAD_REACTORS',
      330,
      image.reactor,
      102,
      '}',
      330,
      imageDict,
      100,
      'AcDbRasterImageDef',
      90,
      0,
      1,
      image.filename,
      10,
      image.width,
      20,
      image.height,
      11,
      1,
      21,
      1,
      280,
      1,
      281,
      0,
    )
    emit(
      0,
      'IMAGEDEF_REACTOR',
      5,
      image.reactor,
      330,
      image.entity,
      100,
      'AcDbRasterImageDefReactor',
      90,
      2,
      330,
      image.entity,
    )
  }
  emit(0, 'ENDSEC', 0, 'EOF')
  if (bounds.isEmpty()) bounds.set(new Vector3(), new Vector3())
  const header = [
    0,
    'SECTION',
    2,
    'HEADER',
    9,
    '$ACADVER',
    1,
    'AC1015',
    9,
    '$HANDSEED',
    5,
    nextHandle.toString(16).toUpperCase(),
    9,
    '$INSUNITS',
    70,
    4,
    9,
    '$LUNITS',
    70,
    2,
    9,
    '$EXTMIN',
    10,
    bounds.min.x,
    20,
    bounds.min.y,
    30,
    bounds.min.z,
    9,
    '$EXTMAX',
    10,
    bounds.max.x,
    20,
    bounds.max.y,
    30,
    bounds.max.z,
    0,
    'ENDSEC',
  ]
  return `${[...header, ...lines].join('\r\n')}\r\n`
}
