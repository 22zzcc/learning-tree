import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// probe4: data URL with big content
const big = ('x'.repeat(100) + '\n').repeat(6000) + "document.getElementById('bar').textContent='DATAURL_OK';document.getElementById('bar').style.background='#0000cc'"
const b64 = Buffer.from(big, 'utf8').toString('base64')
writeFileSync(join(root, '..', 'probe4.html'), `<!doctype html><html><head><meta charset="UTF-8"><style>
body{margin:0;background:#f2f6f3}#bar{position:fixed;bottom:0;left:0;right:0;height:60px;background:#cc0000;display:none}#bar:not(:empty){display:block}
</style></head><body><div id="bar"></div>
<script src="data:text/javascript;base64,${b64}"></script>
</body></html>`)

// probe5: network classic script
writeFileSync(join(root, '..', 'probe5.html'), `<!doctype html><html><head><meta charset="UTF-8"><style>
body{margin:0;background:#f2f6f3}#bar{position:fixed;bottom:0;left:0;right:0;height:60px;background:#cc0000;display:none}#bar:not(:empty){display:block}
</style></head><body><div id="bar"></div>
<script src="http://127.0.0.1:4173/probe5-script.js"></script>
</body></html>`)

// tiny script served for probe5
writeFileSync(join(root, '..', 'dist', 'probe5-script.js'), "document.getElementById('bar').textContent='NET_OK';document.getElementById('bar').style.background='#008000'")
console.log('probes written')
