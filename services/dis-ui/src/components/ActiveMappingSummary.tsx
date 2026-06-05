import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { MappingTemplateVersion, NormalizeOp } from '../lib/dis-ui-server/mapping-templates'
import type { TemplateMappingField } from '../lib/dis-ui-server/mapping-fields'

// Render one normalize/derive op as "name (arg=value, ...)" - the format declarations
// (date_format, decimal_separator) live in the args.
function formatOp(op: NormalizeOp): string {
  const args = Object.entries(op.args).map(([key, value]) => `${key}=${String(value)}`)
  return args.length > 0 ? `${op.op} (${args.join(', ')})` : op.op
}

// Read-only view of a mapping version, split into the two concerns the UI keeps distinct:
// FIELD mappings (source column -> canonical field, enriched from the T1 catalog) and
// FORMAT rules (normalize/cast/derive: date format, decimal separator, type cast). Purely
// presentational and read-only (no inputs/selects), so it is safe to reuse anywhere the
// active mapping must be SHOWN but never edited: the template detail (T2) and the
// recurring-batch upload flow (T4, reuse-not-re-map).
export function ActiveMappingSummary({
  version,
  catalog,
}: {
  version: MappingTemplateVersion
  catalog: TemplateMappingField[]
}) {
  const fieldByKey = new Map<string, TemplateMappingField>()
  for (const field of catalog) {
    if (!fieldByKey.has(field.key)) {
      fieldByKey.set(field.key, field)
    }
  }

  const rules = version.mapping_rules
  const renameEntries = Object.entries(rules.rename)
  // Format rules: union of the canonical columns touched by normalize / cast / derive.
  const ruleColumns = [
    ...new Set([...Object.keys(rules.normalize), ...Object.keys(rules.cast), ...Object.keys(rules.derive)]),
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Field mappings</CardTitle>
          <p className="text-caption text-muted-foreground">
            Which canonical field each source column maps to (active v{version.version}).
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source column</TableHead>
                <TableHead>Canonical field</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renameEntries.map(([sourceCol, canonicalKey]) => {
                const field = fieldByKey.get(canonicalKey)
                return (
                  <TableRow key={sourceCol}>
                    <TableCell className="font-mono text-xs">{sourceCol}</TableCell>
                    <TableCell className="font-medium text-foreground">
                      {field ? field.display_name : canonicalKey}
                      {field?.mandatory ? ' *' : ''}
                      <span className="block font-mono text-caption font-normal text-muted-foreground">
                        {canonicalKey}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{field?.section ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{field?.datatype ?? '-'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Format rules</CardTitle>
          <p className="text-caption text-muted-foreground">
            How values are normalized and cast (date format, decimal separator, type).
          </p>
        </CardHeader>
        <CardContent>
          {ruleColumns.length === 0 ? (
            <p className="text-caption text-muted-foreground">No format rules declared.</p>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canonical field</TableHead>
                  <TableHead>Rule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ruleColumns.map((col) => {
                  const parts: string[] = []
                  for (const op of rules.normalize[col] ?? []) {
                    parts.push(`normalize: ${formatOp(op)}`)
                  }
                  const castSpec = rules.cast[col]
                  if (castSpec) {
                    const detailStr =
                      castSpec.precision !== undefined
                        ? `${castSpec.type}(${castSpec.precision},${castSpec.scale ?? 0})`
                        : castSpec.type
                    parts.push(`cast: ${detailStr}`)
                  }
                  for (const op of rules.derive[col] ?? []) {
                    parts.push(`derive: ${formatOp(op)}`)
                  }
                  return (
                    <TableRow key={col}>
                      <TableCell className="font-mono text-xs">{col}</TableCell>
                      <TableCell className="text-muted-foreground">{parts.join('; ')}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
