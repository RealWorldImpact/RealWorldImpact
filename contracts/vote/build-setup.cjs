const path=require('path'),esbuild=require('../../scripts/lp/node_modules/esbuild');
esbuild.buildSync({entryPoints:[path.join(__dirname,'deploy-ui.js')],outfile:path.join(__dirname,'../../assets/vote-setup.js'),bundle:true,minify:true,platform:'browser',target:['es2022'],format:'iife'});
