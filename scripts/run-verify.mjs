// 一键端到端验证：esbuild 打包测试 + Node 运行（用户机器上直接跑）
import { spawnSync } from 'node:child_process'

const esbuildBin = 'node_modules/esbuild/bin/esbuild'

console.log('== 打包验证测试 ==')
const r1 = spawnSync(process.execPath, [
  esbuildBin,
  'scripts/verify-app.test.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--external:jsdom',
  '--outfile=dist-test/verify.cjs'
], { stdio: 'inherit' })
if (r1.status !== 0) process.exit(r1.status ?? 1)

console.log('== 运行验证 ==')
const r2 = spawnSync(process.execPath, ['dist-test/verify.cjs'], { stdio: 'inherit' })
process.exit(r2.status ?? 1)
