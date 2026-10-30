const path=require('path');
require('../../scripts/lp/node_modules/esbuild').buildSync({entryPoints:[path.join(__dirname,'deploy-ui.js')],outfile:path.join(__dirname,'../../assets/launch-setup.js'),bundle:true,minify:true,platform:'browser',target:['es2022'],format:'iife'});
