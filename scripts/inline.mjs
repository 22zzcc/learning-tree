// 把 dist/ 构建产物内联成单文件 HTML（供本地渲染器验证）
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const rootDir = dirname(distDir)

const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8')
let css = ''
let js = ''
indexHtml.replace(/<(link|script)[^>]*\b(href|src)="([^"]+)"[^>]*>/g, (m, tag, attr, src) => {
  const file = join(distDir, src.replace(/^\//, ''))
  const content = readFileSync(file, 'utf8')
  if (tag === 'link') css += content
  else js += content
  return ''
})

const diag = [
  '<script>',
  "var errEl = null, lastColor = ''",
  "function paint(msg, color) {",
  "  lastColor = color",
  "  errEl = document.getElementById('boot-error')",
  "  errEl.style.background = color",
  "  errEl.textContent = msg",
  "}",
  "var origLog = console.log.bind(console)",
  "console.log = function () {",
  "  origLog.apply(null, arguments)",
  "  var s = Array.prototype.map.call(arguments, String).join(' ')",
  "  if (s.length < 300) paint('LOG: ' + s, '#556677')",
  "}",
  "var origErr = console.error.bind(console)",
  "console.error = function () {",
  "  origErr.apply(null, arguments)",
  "  var s = Array.prototype.map.call(arguments, String).join(' ').slice(0, 300)",
  "  paint('LOGERR: ' + s, '#cc0000')",
  "}",
  "window.addEventListener('error', function (e) {",
  "  var msg = e.message || 'unknown'",
  "  paint('JS_ERROR: ' + msg, '#cc0000')",
  "})",
  "window.addEventListener('unhandledrejection', function (e) {",
  "  var r = e.reason || {}",
  "  var msg = (r && (r.message || String(r))) || 'unhandledrejection'",
  "  paint('REJECTION: ' + msg.slice(0, 300), '#2058a8')",
  "})",
  "if (!window.indexedDB) { paint('NO_INDEXEDDB', '#2058a8') } else {",
  "  var idbDone = false",
  "  var rq = indexedDB.open('__probe__', 1)",
  "  rq.onerror = function () { idbDone = true; paint('IDB_FAIL', '#2058a8') }",
  "  rq.onsuccess = function () { idbDone = true; try { rq.result.close(); indexedDB.deleteDatabase('__probe__') } catch (e) {} paint('IDB_OK', '#00aa00') }",
  "  setTimeout(function () { if (!idbDone) paint('IDB_TIMEOUT_3S', '#ff6ec7') }, 3000)",
  "}",
  "setTimeout(function () {",
  "  var root = document.getElementById('root')",
  "  var el = document.getElementById('boot-error')",
  "  var hasErr = el.textContent.indexOf('JS_ERROR') !== -1 || el.textContent.indexOf('REJECTION') !== -1 || el.textContent.indexOf('LOGERR') !== -1",
  "  if (root && el && root.childElementCount === 0 && !hasErr) {",
  "    if (window.__moduleRan) paint('MODULE_RAN_BUT_EMPTY', '#e8930c')",
  "    else paint('NO_MODULE_RUN', '#9932cc')",
  "  }",
  "}, 6000)",
  "if (window.crypto && !window.crypto.randomUUID) {",
  "  window.crypto.randomUUID = function () {",
  "    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {",
  "      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8",
  "      return v.toString(16)",
  "    })",
  "  }",
  "}",
  "</script>"
].join('\n')

// IndexedDB 内存垫片（仅测试页使用）
const shim = readFileSync(join(rootDir, 'scripts', 'idb-shim.bundle.js'), 'utf8')

const out = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8" />',
  '<title>学树内联验证页</title>',
  '<style>',
  css,
  '#boot-error { position: fixed; bottom: 0; left: 0; right: 0; background: #cc0000; color: #fff; padding: 8px 14px; font: 16px monospace; display: none; z-index: 9999; }',
  '#boot-error:not(:empty) { display: block; }',
  '</style>',
  '</head>',
  '<body>',
  '<div id="root"></div>',
  '<div id="boot-error"></div>',
  diag,
  '<script>',
  shim,
  '</script>',
  '<script type="module">',
  js,
  '</script>',
  '<script type="module">window.__moduleRan = true; paint("MODULE_RAN", "#00cccc")</script>',
  '</body>',
  '</html>'
].join('\n')

const target = process.argv[2] || 'fullapp.html'
writeFileSync(join(rootDir, target), out, 'utf8')
console.log('written', target, (out.length / 1024).toFixed(0) + 'KB')
