// 测试用：用 fake-indexeddb 在内存中模拟 IndexedDB（file:// 下原生 IDB 卡死）
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

if (!window.indexedDB || window.__NATIVE_IDB_BROKEN__) {
  window.indexedDB = indexedDB
  window.IDBKeyRange = IDBKeyRange
  window.__IDB_SHIM__ = true
}
console.log('[idb-shim] installed')
