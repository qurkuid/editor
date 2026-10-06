import {createSceneStore} from './packages/mcp/dist/storage/index.js';
const store=await createSceneStore();
const fixture=await Bun.file('/tmp/editor-69d63180-qa.json').json();
const id='qa-release-69d63180';
if(await store.load(id))throw Error('QA already exists');
await store.createProject({id,name:'릴리스 검증 69d63180',isPrivate:false});
const meta=await store.save({id,name:'릴리스 검증 69d63180',graph:fixture.graph});
console.log(JSON.stringify({id:meta.id,version:meta.version,nodes:Object.keys(fixture.graph.nodes).length}));
