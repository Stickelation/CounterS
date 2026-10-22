import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFile(root+path,'utf8');
const [template,css,app,exporter,catalog,...modules]=await Promise.all([
 'public/index.template.html','public/style.css','public/app.js','public/steam-export.js','data/catalog.json',
 'lib/tradeup.js','lib/inventory-import.js','lib/demo.js','lib/standalone-api.js'
].map(read));
// These small shared modules have no dependencies outside this explicit list.
// Keep their scope separate from app.js, which defines its own display helpers.
const bundled=modules.map(source=>source.replace(/^import .+;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
if(/^\s*(import|export)\s/m.test(bundled))throw Error('Standalone module imports changed; update the explicit bundle.');
const safeString=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const bootstrap=`(()=>{\n${bundled}\nconst embeddedCatalog=JSON.parse(${safeString(catalog)});\nglobalThis.CounterSOfflineApi=createStandaloneApi(embeddedCatalog);\nglobalThis.CounterSExporterSource=${safeString(exporter)};\n})();\n`;
const script=(bootstrap+app).replace(/<\/script/gi,'<\\/script');
const html=template
 .replace('<link rel="stylesheet" href="/style.css">',()=>`<style>\n${css}\n</style>`)
 .replace('<script type="module" src="/app.js"></script>',()=>`<script type="module">\n${script}\n</script>`);
if(html===template||html.includes('src="/app.js"')||html.includes('href="/style.css"'))throw Error('Standalone template asset tags changed.');
await mkdir(root+'dist',{recursive:true});
await writeFile(root+'dist/CounterS.html',html);
await writeFile(root+'public/index.html',html);
console.log('Built public/index.html and dist/CounterS.html: styles, scripts, catalog and local calculations included.');
