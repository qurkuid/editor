declare module 'three/src/geometries/BoxGeometry.js' {
  export { BoxGeometry } from 'three'
}

declare module 'three/src/geometries/CapsuleGeometry.js' {
  export { CapsuleGeometry } from 'three'
}

declare module 'three/src/geometries/CylinderGeometry.js' {
  export { CylinderGeometry } from 'three'
}

declare module 'three/src/geometries/SphereGeometry.js' {
  export { SphereGeometry } from 'three'
}

declare module 'three/src/materials/MeshStandardMaterial.js' {
  export { MeshStandardMaterial } from 'three'
}

declare module 'three/src/math/Box3.js' {
  export { Box3 } from 'three'
}

declare module 'three/src/math/Vector3.js' {
  export { Vector3 } from 'three'
}

declare module 'three/src/objects/Group.js' {
  export { Group } from 'three'
}

declare module 'three/src/objects/Mesh.js' {
  export { Mesh } from 'three'
}

declare module 'three/addons/exporters/GLTFExporter.js' {
  import type { Object3D } from 'three'

  export class GLTFExporter {
    parseAsync(
      input: Object3D | readonly Object3D[],
      options?: {
        readonly binary?: boolean
        readonly onlyVisible?: boolean
        readonly trs?: boolean
      },
    ): Promise<unknown>
  }
}
