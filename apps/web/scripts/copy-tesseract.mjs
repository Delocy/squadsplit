// Copies what Tesseract.js needs in the browser into public/tesseract, so the on-phone receipt reader is served
// from our own origin (no third-party CDN at runtime). Runs before `vite build` and `vite dev`; the copies are
// gitignored. Only the LSTM cores are copied, since the app creates its worker with OEM.LSTM_ONLY.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = (name, from) => dirname(createRequire(from).resolve(`${name}/package.json`))

const tesseractDir = pkgDir('tesseract.js', import.meta.url)
const coreDir = pkgDir('tesseract.js-core', join(tesseractDir, 'package.json'))
const engDir = pkgDir('@tesseract.js-data/eng', import.meta.url)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tesseract')
const files = [
  [join(tesseractDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-relaxedsimd-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-lstm'].map((core) => [
    join(coreDir, `${core}.wasm.js`),
    join('core', `${core}.wasm.js`),
  ]),
  // The smaller "best_int" model, which is what tesseract.js picks for LSTM-only workers.
  [join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'), join('lang', 'eng.traineddata.gz')],
]

rmSync(out, { recursive: true, force: true })
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true })
  copyFileSync(from, join(out, to))
}
console.log(`Copied ${files.length} Tesseract files to public/tesseract`)
