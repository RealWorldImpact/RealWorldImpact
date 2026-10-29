const path=require('node:path');
const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:[path.join(__dirname,'app.js')],outfile:path.join(__dirname,'../../assets/lp.js'),nodePaths:require("module").globalPaths,bundle:true,minify:true,platform:'browser',target:['es2022'],format:'iife',legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'}});
