#!/usr/bin/env node
/* Bundles the game into one self-contained HTML file (fonts aside): the page
   body, all CSS in one <style> and all scripts in one <script>, in load order.
   Used to publish the game as a single-page artifact. Usage:
   node tools/build-artifact.js [out-file]   (default dist/ai-boom-tycoon.html) */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'ai-boom-tycoon.html'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="preconnect"[^>]*>|<link rel="stylesheet" href="https:[^>]*>/g) || [];
const css = (html.match(/<link rel="stylesheet" href="(?!https:)([^"]+)">/g) || [])
  .map((tag) => fs.readFileSync(path.join(root, tag.match(/href="([^"]+)"/)[1]), 'utf8'))
  .join('\n');
const scripts = (html.match(/<script src="([^"]+)"><\/script>/g) || []).map((tag) => tag.match(/src="([^"]+)"/)[1]);
const js = scripts.map((src) => `/* ---- ${src} ---- */\n` + fs.readFileSync(path.join(root, src), 'utf8')).join('\n');
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script src="[^"]+"><\/script>/g, '')
  .trim();

const bundle = [title, ...fonts, `<style>\n${css}\n</style>`, body, `<script>\n${js}\n</script>`, ''].join('\n');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(bundle.length / 1024).toFixed(0)} KB, ${scripts.length} scripts)`);
