import { useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { activeTemplateVersion, useMappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import type { MappingTemplateVersion, NormalizeOp, TemplateStatus } from '../lib/dis-ui-server/mapping-templates'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import type { TemplateMappingField } from '../lib/dis-ui-server/mapping-fields'
import { useStoresOnboarded } from '../lib/dis-ui-server/stores'

function statusTone(status: TemplateStatus): StatusTone {
  if (status === 'active') {
    return 'success'
  }
  if (status === 'staged') {
    return 'warning'
  }
  if (status === 'draft') {
    return 'info'
  }
  return 'neutral'
}

// Render one normalize/derive op as "name (arg=value, ...)" - the format declarations
// (date_format, decimal_separator) live in the args.
function formatOp(op: NormalizeOp): string {
  const args = Object.entries(op)
    .filter(([key]) => key !== 'op')
    .map(([key, value]) => `${key}=${String(value)}`)
  return args.length > 0 ? `${op.op} (${args.join(', ')})` : op.op
}

// Template detail (T2), at /sources/:sourceId/templates/:templateId. The active version
// is what recurring batches reuse, so it is made prominent. The active version's mapping
// is shown as TWO distinct concerns: FIELD mappings (column -> canonical field, enriched
// from the T1 catalog) and FORMAT rules (normalize/cast/derive: date format, decimal
// separator). Store locale context (currency/timezone/tax) is read-only here.
export function TemplateDetail() {
  const { templateId } = useParams()
  const { snapshot } = useAuth()
  const detail = useMappingTemplate(snapshot, templateId ?? null)
  const fields = useTemplateMappingFields()
  const stores = useStoresOnboarded(snapshot)

  if (templateId === undefined) {
    return <EmptyState title="No template" message="No template id in the URL." />
  }
  if (detail.isPending) {
    return <LoadingState label="Loading template..." />
  }
  // The detail GET is throw-style 404 (real contract): unknown -> error state.
  if (detail.isError || detail.data === undefined) {
    return <ErrorState message="Could not load this template." />
  }

  const template = detail.data
  const active = activeTemplateVersion(template)
  const catalog: TemplateMappingField[] = fields.data ?? []
  const fieldByKey = new Map<string, TemplateMappingField>()
  for (const field of catalog) {
    if (!fieldByKey.has(field.key)) {
      fieldByKey.set(field.key, field)
    }
  }

  const renameEntries = active ? Object.entries(active.mapping_rules.rename) : []
  // Format rules: union of the canonical columns touched by normalize / cast / derive.
  const rules = active?.mapping_rules
  const ruleColumns = rules
    ? [...new Set([...Object.keys(rules.normalize), ...Object.keys(rules.cast), ...Object.keys(rules.derive)])]
    : []

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-display">{template.template_name}</h1>
          <p className="text-caption text-muted-foreground">
            Template for {template.source_id}. The active version is reused for every new batch.
          </p>
        </div>
        {active !== null ? (
          <StatusBadge tone="success">Active: v{active.version}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">No active version</StatusBadge>
        )}
      </header>

      {/* Version lineage */}
      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Rules</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Active window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {template.versions.map((version: MappingTemplateVersion) => (
                <TableRow key={version.mapping_version_id}>
                  <TableCell className="font-medium text-foreground">v{version.version}</TableCell>
                  <TableCell>
                    <StatusBadge tone={statusTone(version.status)}>{version.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{version.field_count}</TableCell>
                  <TableCell className="text-muted-foreground">{version.transform_count}</TableCell>
                  <TableCell className="text-muted-foreground">{version.created_at}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.activated_at === null
                      ? '-'
                      : `${version.activated_at} to ${version.deprecated_at ?? 'current'}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* The active version's mapping, split into the two concerns. */}
      {active !== null ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Field mappings</CardTitle>
              <p className="text-caption text-muted-foreground">
                Which canonical field each source column maps to (active v{active.version}).
              </p>
            </CardHeader>
            <CardContent>
              <Table>
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
              </Table>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canonical field</TableHead>
                      <TableHead>Rule</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ruleColumns.map((col) => {
                      const parts: string[] = []
                      for (const op of rules?.normalize[col] ?? []) {
                        parts.push(`normalize: ${formatOp(op)}`)
                      }
                      const castSpec = rules?.cast[col]
                      if (castSpec) {
                        const detailStr =
                          castSpec.precision !== undefined
                            ? `${castSpec.type}(${castSpec.precision},${castSpec.scale ?? 0})`
                            : castSpec.type
                        parts.push(`cast: ${detailStr}`)
                      }
                      for (const op of rules?.derive[col] ?? []) {
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
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Store locale context (read-only; the editable locale declaration is a later slice). */}
      <Card>
        <CardHeader>
          <CardTitle>Store context</CardTitle>
          <p className="text-caption text-muted-foreground">
            Locale facts from your onboarded stores. Used as defaults; mapping store binding is resolved at ingest.
          </p>
        </CardHeader>
        <CardContent>
          {stores.isPending ? (
            <LoadingState label="Loading stores..." />
          ) : stores.isError || stores.data === undefined || stores.data.length === 0 ? (
            <p className="text-caption text-muted-foreground">No onboarded stores.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead>Tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.data.map((store) => (
                  <TableRow key={store.store_id}>
                    <TableCell className="font-medium text-foreground">{store.name}</TableCell>
                    <TableCell className="text-muted-foreground">{store.currency}</TableCell>
                    <TableCell className="text-muted-foreground">{store.timezone}</TableCell>
                    <TableCell className="text-muted-foreground">{store.tax_treatment}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
