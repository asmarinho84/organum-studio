'use strict';
/* Gera dist/organum-studio.html: um único arquivo com CSS, JS e fonte embutidos. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
let css = read('css/music-font.css') + '\n' + read('css/styles.css') + '\n' + read('css/themes.css');

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>\s*/g, '');
html = html.replace('</head>', () => `<style>\n${css}\n</style>\n</head>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
// A versão de arquivo único usa estilos/scripts embutidos: remove a CSP restritiva.
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
const icon = Buffer.from(read('favicon.svg')).toString('base64');
html = html.replace(/<link[^>]*rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}" />`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/organum-studio.html'), html);
console.log('dist/organum-studio.html', (html.length / 1024).toFixed(0) + ' KB');
