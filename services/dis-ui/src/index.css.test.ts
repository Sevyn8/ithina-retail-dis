import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Proves the design-system token block is present in the shipped CSS, with the source
// oklch values reproduced exactly (FM5). Read from disk relative to the Vitest cwd
// (the package root): the @tailwindcss/vite plugin transforms `.css` imports so `?raw`
// yields nothing, and jsdom does not resolve stylesheet custom properties via
// getComputedStyle, so the source text is the reliable "known oklch token" check.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('design-system tokens (index.css)', () => {
  it('carries the light primary token at the exact source oklch value', () => {
    expect(css).toContain('--primary: oklch(0.62 0.19 257)')
    expect(css).toContain('--background: oklch(0.98 0 0)')
  })

  it('carries the dark token family flipped by the .dark class', () => {
    expect(css).toContain('.dark {')
    expect(css).toContain('--background: oklch(0.10 0 0)')
  })

  it('carries the semantic tokens and the type-scale utilities', () => {
    expect(css).toContain('--success: oklch(0.60 0.18 162)')
    expect(css).toContain('--danger: oklch(0.58 0.22 25)')
    expect(css).toContain('@utility text-display')
    expect(css).toContain('@utility text-micro')
  })

  it('binds the Geist font variables the @theme font tokens resolve through', () => {
    expect(css).toContain("--font-geist-sans: 'Geist Sans'")
    expect(css).toContain("--font-geist-mono: 'Geist Mono'")
    expect(css).toContain('--font-sans: var(--font-geist-sans)')
  })
})
