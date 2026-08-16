// 必须在任何 Dexie 模块加载前执行：Dexie 在模块初始化时就抓取全局 indexedDB
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

;(globalThis as any).indexedDB = indexedDB
;(globalThis as any).IDBKeyRange = IDBKeyRange
console.log('[setup] fake-indexeddb 已注入')
