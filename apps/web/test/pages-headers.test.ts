import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const file = resolve(__dirname, '../public/_headers')

/**
 * The Cache-Control a Cloudflare Pages `_headers` file gives `path`: every matching rule applies in file order,
 * a repeated header is joined with ", ", and `! Name` drops what earlier rules set.
 */
function cacheControlFor(path: string): string | undefined {
  let value: string | undefined
  let applies = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const pattern = new RegExp(`^${line.trim().replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`)
      applies = pattern.test(path)
    } else if (applies) {
      const header = line.trim()
      if (/^!\s*cache-control$/i.test(header)) value = undefined
      const m = /^cache-control:\s*(.+)$/i.exec(header)
      if (m) value = value ? `${value}, ${m[1]}` : m[1]
    }
  }
  return value
}

// Pages publishes `public/` as is, so these are the live site's caching rules.
describe('Cloudflare Pages cache headers', () => {
  it('exists', () => {
    expect(existsSync(file)).toBe(true)
  })

  it('makes browsers revalidate the HTML, so a deploy shows up on the next load', () => {
    for (const path of ['/', '/index.html', '/groups/g1', '/join/ABCD2345']) expect(cacheControlFor(path)).toBe('no-cache')
  })

  it('caches the hashed build assets for a year', () => {
    expect(cacheControlFor('/assets/index-3f9a1c.js')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlFor('/assets/index-3f9a1c.css')).toBe('public, max-age=31536000, immutable')
  })
})
