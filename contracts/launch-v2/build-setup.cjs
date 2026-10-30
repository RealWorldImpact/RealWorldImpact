const fs=require('fs'),path=require('path'),esbuild=require('../../scripts/lp/node_modules/esbuild');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/RWILaunchV2.json'))),h=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/RWICreatorHook.json')));
fs.writeFileSync(path.join(__dirname,'build-hashes.js'),'// Generated from the reviewed build.\nexport const FACTORY_CREATION_HASH='+JSON.stringify(f.creationHash)+';\nexport const HOOK_CREATION_HASH='+JSON.stringify(h.creationHash)+';\n');
esbuild.buildSync({entryPoints:[path.join(__dirname,'deploy-ui.js')],outfile:path.join(__dirname,'../../assets/launch-v2-setup.js'),bundle:true,minify:true,platform:'browser',target:['es2022'],format:'iife'});
