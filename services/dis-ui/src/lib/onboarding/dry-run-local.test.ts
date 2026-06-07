import { describe, expect, it } from 'vitest'

import type { TemplateMappingField } from '../dis-ui-server/mapping-fields'
import { localDryRun } from './dry-run-local'

function field(key: string, datatype: TemplateMappingField['datatype']): TemplateMappingField {
  return {
    key,
    display_name: key,
    section: 'sale_event',
    mandatory: false,
    datatype,
    description: '',
  }
}

const CATALOG = new Map<string, TemplateMappingField>([
  ['sku_id', field('sku_id', 'text')],
  ['quantity', field('quantity', 'integer')],
  ['unit_sale_price', field('unit_sale_price', 'number')],
  ['source_sale_timestamp', field('source_sale_timestamp', 'datetime')],
  ['event_date', field('event_date', 'date')],
])

describe('localDryRun', () => {
  it('projects to canonical keys and coerces per datatype + locale rules', () => {
    const { rows } = localDryRun({
      sampleRows: [{ item: 'A123', qty: '12', price: '1.234,50', d: '03-12-2025' }],
      renameMap: {
        item: 'sku_id',
        qty: 'quantity',
        price: 'unit_sale_price',
        d: 'event_date',
      },
      localeRules: {
        price: { decimal_separator: ',', thousands_separator: '.' },
        d: { format: '%d-%m-%Y' },
      },
      catalogByKey: CATALOG,
    })
    expect(rows).toEqual([
      {
        sku_id: 'A123', // text: raw
        quantity: 12, // integer
        unit_sale_price: 1234.5, // number, comma decimal + dot thousands
        event_date: '2025-12-03', // date reformatted to ISO from 03-12-2025 (%d-%m-%Y)
      },
    ])
  })

  it('drops unmapped columns ("" canonical) and omits source columns with no rename', () => {
    const { rows } = localDryRun({
      sampleRows: [{ item: 'A123', skip: 'x' }],
      renameMap: { item: 'sku_id', skip: '' },
      localeRules: {},
      catalogByKey: CATALOG,
    })
    expect(rows).toEqual([{ sku_id: 'A123' }])
  })

  it('keeps the raw value on a coercion failure (never throws, best-effort)', () => {
    const { rows } = localDryRun({
      sampleRows: [
        { qty: 'not-a-number', d: 'garbage' },
        { qty: '', d: '03-12-2025' }, // empty + a date with NO declared format -> raw
      ],
      renameMap: { qty: 'quantity', d: 'source_sale_timestamp' },
      localeRules: {}, // no format/decimal declared
      catalogByKey: CATALOG,
    })
    expect(rows[0]).toEqual({ quantity: 'not-a-number', source_sale_timestamp: 'garbage' })
    expect(rows[1]).toEqual({ quantity: '', source_sale_timestamp: '03-12-2025' })
  })

  it('coerces a datetime with a time-bearing format to ISO and never throws on odd input', () => {
    const run = () =>
      localDryRun({
        sampleRows: [{ ts: '2025-12-03 14:30:05' }, { ts: '' }],
        renameMap: { ts: 'source_sale_timestamp' },
        localeRules: { ts: { format: '%Y-%m-%d %H:%M:%S', timezone: 'UTC' } },
        catalogByKey: CATALOG,
      })
    expect(run).not.toThrow()
    const { rows } = run()
    expect(rows[0]).toEqual({ source_sale_timestamp: '2025-12-03T14:30:05' })
    expect(rows[1]).toEqual({ source_sale_timestamp: '' })
  })
})
