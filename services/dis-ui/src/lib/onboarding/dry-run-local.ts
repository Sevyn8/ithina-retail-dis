import type { LocaleDeclaration } from '../../components/locale-rules'
import type { TemplateMappingField } from '../dis-ui-server/mapping-fields'
import type { DryRunResult } from '../dis-ui-server/onboarding'

// Client-side, best-effort validation/coercion preview for the onboarding Review -> Preview
// step. Projects each parsed sample row to a canonical-keyed record (applying the rename) and
// coerces each mapped value to its canonical datatype using the declared locale rules.
//
// It is INFORMATIONAL and NON-BLOCKING: it NEVER throws, and on any coercion / allowed_values /
// max_length failure it keeps the RAW value (the authoritative coercion is the server's
// Pandera/Polars pipeline; this is a confidence-building preview, not validation of record). The
// output is the minimal DryRunResult { rows } the preview render already consumes, so the render
// needs no change.

export type DryRunLocalInputs = {
  // The parsed sample rows (analyze step output): source-column -> raw cell string.
  sampleRows: Record<string, string>[]
  // source_col -> canonical key. '' (or absent) means the column is not mapped, so it is omitted.
  renameMap: Record<string, string>
  // Per source_col locale declaration (date format, decimal/thousands separators).
  localeRules: Record<string, LocaleDeclaration>
  // canonical key -> catalog field (datatype/allowed_values/max_length).
  catalogByKey: Map<string, TemplateMappingField>
}

const TRUE_TOKENS = new Set(['true', '1', 'yes', 'y', 't'])
const FALSE_TOKENS = new Set(['false', '0', 'no', 'n', 'f'])

function coerceNumeric(
  raw: string,
  locale: LocaleDeclaration | undefined,
  integer: boolean,
): unknown {
  const decimalSep = locale?.decimal_separator ?? '.'
  const thousandsSep = locale?.thousands_separator
  let text = raw.trim()
  if (text === '') return raw
  if (thousandsSep) text = text.split(thousandsSep).join('')
  if (decimalSep !== '.') text = text.split(decimalSep).join('.')
  const n = Number(text)
  if (!Number.isFinite(n)) return raw
  if (integer) return Number.isInteger(n) ? n : raw
  return n
}

function coerceBoolean(raw: string): unknown {
  const t = raw.trim().toLowerCase()
  if (TRUE_TOKENS.has(t)) return true
  if (FALSE_TOKENS.has(t)) return false
  return raw
}

// A small strptime subset covering the declared DATE_FORMAT_CHOICES tokens (locale-rules.ts).
const DATE_TOKENS: Record<string, string> = {
  '%Y': '(?<Y>\\d{4})',
  '%y': '(?<y>\\d{2})',
  '%m': '(?<m>\\d{1,2})',
  '%d': '(?<d>\\d{1,2})',
  '%H': '(?<H>\\d{1,2})',
  '%M': '(?<Min>\\d{1,2})',
  '%S': '(?<S>\\d{1,2})',
}

function escapeLiteral(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatToRegex(format: string): RegExp | null {
  let pattern = '^'
  for (let i = 0; i < format.length; i += 1) {
    const token = format.slice(i, i + 2)
    if (DATE_TOKENS[token] !== undefined) {
      pattern += DATE_TOKENS[token]
      i += 1
    } else {
      pattern += escapeLiteral(format[i])
    }
  }
  pattern += '$'
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

function pad(value: string, width: number): string {
  return value.padStart(width, '0')
}

function coerceDate(
  raw: string,
  locale: LocaleDeclaration | undefined,
  withTime: boolean,
): unknown {
  const format = locale?.format
  const value = raw.trim()
  if (format === undefined || format === '' || value === '') return raw
  const groups = formatToRegex(format)?.exec(value)?.groups
  if (groups === undefined) return raw
  const year = groups.Y ?? (groups.y !== undefined ? `20${groups.y}` : undefined)
  if (year === undefined || groups.m === undefined || groups.d === undefined) return raw
  const date = `${pad(year, 4)}-${pad(groups.m, 2)}-${pad(groups.d, 2)}`
  if (!withTime || groups.H === undefined) return date
  return `${date}T${pad(groups.H, 2)}:${pad(groups.Min ?? '0', 2)}:${pad(groups.S ?? '0', 2)}`
}

function coerce(
  raw: string,
  datatype: TemplateMappingField['datatype'] | undefined,
  locale: LocaleDeclaration | undefined,
): unknown {
  switch (datatype) {
    case 'integer':
      return coerceNumeric(raw, locale, true)
    case 'number':
      return coerceNumeric(raw, locale, false)
    case 'boolean':
      return coerceBoolean(raw)
    case 'date':
      return coerceDate(raw, locale, false)
    case 'datetime':
      return coerceDate(raw, locale, true)
    // text, choice, json, and unknown keep the raw value (best-effort, informational): a
    // choice not in allowed_values or a text over max_length is shown as-is, never dropped.
    default:
      return raw
  }
}

export function localDryRun(inputs: DryRunLocalInputs): DryRunResult {
  const { sampleRows, renameMap, localeRules, catalogByKey } = inputs
  const mapped = Object.entries(renameMap).filter(([, key]) => key !== '')
  const rows = sampleRows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [sourceCol, canonicalKey] of mapped) {
      const raw = row[sourceCol] ?? ''
      const datatype = catalogByKey.get(canonicalKey)?.datatype
      out[canonicalKey] = coerce(raw, datatype, localeRules[sourceCol])
    }
    return out
  })
  return { rows }
}
