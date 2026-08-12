import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadOntologyPack } from '../ontology/pack'
import type { SceneOperations } from '../operations'

export const ONTOLOGY_MANIFEST_RESOURCE_URI = 'pascal://ontology/manifest'

export function registerOntologyManifest(server: McpServer, _operations: SceneOperations): void {
  server.registerResource(
    'ontology-manifest',
    ONTOLOGY_MANIFEST_RESOURCE_URI,
    {
      title: 'Pascal design ontology manifest',
      description: 'Read-only Pack v1 manifest with pinned version, license, and file hashes.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const loaded = await loadOntologyPack()
      const payload =
        loaded.status === 'available'
          ? { status: loaded.status, manifest: loaded.pack.manifest }
          : loaded
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload),
          },
        ],
      }
    },
  )
}
