#!/usr/bin/env node
/**
 * verify-contrast.mjs — score every (text × background) pair this kit actually
 * renders, in BOTH themes, against WCAG AA (4.5:1).
 *
 * Run it after ANY change to the brand block in tokens.css. Swapping a brand
 * hue is a two-minute edit that silently breaks four pairs; this is the check
 * that makes the swap safe.
 *
 *   node verify-contrast.mjs path/to/globals.css
 *
 * Why a script and not a glance: contrast is a property of the PAIR, not of the
 * token. One value can pass on --surface and fail on --canvas — that is a real
 * bug this exact check caught (4.32:1) after the value had been reviewed by eye
 * and shipped.
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'src/app/globals.css'

/* ── colour maths ──────────────────────────────────────────────────────── */
const hex = (h) => {
  const s = h.replace('#', '').trim()
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** rgba over an opaque backdrop — translucent surfaces MUST be composited
 *  before scoring, or you are measuring a colour nobody ever sees. */
const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))

/* ── read tokens out of the stylesheet ─────────────────────────────────── */
const css = readFileSync(file, 'utf8')
const block = (selector) => {
  // ต้องจับ selector ที่อยู่ต้นบรรทัดและตามด้วย { เท่านั้น
  // indexOf('.dark') เฉย ๆ จะไปเจอคำว่า .dark ในบรรทัด
  //   @custom-variant dark (&:where(.dark, .dark *));
  // ซึ่งอยู่ก่อน :root แล้ว slice ไปจบที่ท้ายบล็อก :root
  // ผลคือ dark === light เสมอ และโหมดมืดไม่เคยถูกตรวจจริงเลยสักครั้ง
  const re = new RegExp('^[ \\t]*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'm')
  const m0 = re.exec(css)
  if (!m0) return {}
  const i = m0.index
  const end = css.indexOf('\n}', i)
  const body = css.slice(i, end === -1 ? css.length : end)
  const out = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const parse = (v, theme) => {
  if (!v) return null
  if (v.startsWith('#')) return hex(v)
  const m = v.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/)
  if (m) {
    const bg = theme.sidebar ? hex(theme.sidebar) : [0, 0, 0]
    return over([+m[1], +m[2], +m[3]], parseFloat(m[4]), bg)
  }
  return null
}

/* ── the pairs that exist on screen (not every token combination) ──────── */
const PAIRS = [
  ['ink', 'canvas'], ['ink', 'surface'], ['ink', 'surface-2'],
  ['ink-2', 'surface'], ['ink-2', 'canvas'],
  ['muted', 'canvas'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'surface-3'],
  ['brand', 'surface'], ['brand', 'canvas'],
  ['brand-on-tint', 'brand-tint'],
  ['WHITE', 'brand-solid'], ['WHITE', 'brand-solid-hover'], ['WHITE', 'brand-solid-active'],
  ['WHITE', 'urgent-solid'],
  ['sidebar-fg', 'sidebar'], ['sidebar-fg-dim', 'sidebar'],
  ['sidebar-active-fg', 'sidebar-active-bg'],
  ['status-pending', 'status-pending-bg'], ['status-progress', 'status-progress-bg'],
  ['status-done', 'status-done-bg'], ['status-info', 'status-info-bg'],
  ['urgent', 'urgent-bg'],
  ['status-pending', 'surface'], ['status-progress', 'surface'],
  ['status-done', 'surface'], ['status-info', 'surface'], ['urgent', 'surface'],
]

const light = block(':root')
const dark = { ...light, ...block('.dark') }   // dark overrides light
let fails = 0, checked = 0

for (const [name, theme] of [['LIGHT', light], ['DARK', dark]]) {
  console.log(`\n${'═'.repeat(46)}\n${name}`)
  for (const [fg, bg] of PAIRS) {
    const f = fg === 'WHITE' ? [255, 255, 255] : parse(theme[fg], theme)
    const b = parse(theme[bg], theme)
    if (!f || !b) { console.log(`  ??    ${fg} on ${bg}  (token missing)`); continue }
    const r = ratio(f, b)
    const ok = r >= 4.5
    checked++
    if (!ok) fails++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}`)
  }
}

console.log(`\n${checked} pairs checked · ${fails} below 4.5:1`)
if (fails) {
  console.log(
    '\nCommon cause: a fill token reused from a text token. A hue light enough\n' +
    'to read as text on a dark panel is far too light to sit under white text.\n' +
    'Give the fill its own -solid family, identical in both themes.',
  )
}
process.exit(fails ? 1 : 0)
