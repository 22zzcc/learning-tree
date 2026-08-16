// 探针：Dexie 4 + fake-indexeddb 是否能正常读写（结果通过 paint 颜色反馈）
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'
import Dexie from 'dexie'

window.indexedDB = indexedDB
window.IDBKeyRange = IDBKeyRange
window.__DEXIE_RESULT__ = 'pending'

setTimeout(function () {
  if (window.__DEXIE_RESULT__ === 'pending') paint('DEXIE_TIMEOUT_10S', '#e8930c')
}, 10000)

async function run() {
  try {
    const db = new Dexie('probe-db')
    db.version(1).stores({ t: 'id' })
    await db.table('t').add({ id: 'a', v: 1 })
    const n = await db.table('t').count()
    const got = await db.table('t').get('a')
    window.__DEXIE_RESULT__ = 'ok'
    paint('DEXIE_OK count=' + n + ' got=' + got.v, '#00aa00')
  } catch (e) {
    window.__DEXIE_RESULT__ = 'fail'
    paint('DEXIE_FAIL: ' + String((e && e.message) || e).slice(0, 150), '#cc0000')
  }
}

run()
