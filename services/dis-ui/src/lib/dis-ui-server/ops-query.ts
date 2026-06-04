import { useMutation } from '@tanstack/react-query'

// DuckDB Query Panel endpoints (demand list 7.4-7.5), OPS slice. Execution here is a
// STUB: it maps a few canned cross-tenant query strings to canned results. Every shape
// below is PROVISIONAL and lives only in this single containment file (FM3), naming
// 7.4-7.5. The screen consumes typed values only.
//
// WHAT IS NOT MODELED HERE (FM1/FM2), all Sanjeev's and flagged open - the heaviest open
// contract in the UI:
//   - the query ENGINE and the execution contract (submit/return, streaming vs batch)
//   - the SAFETY model: read-only enforcement, row caps, statement timeouts, resource
//     limits, sandboxing, what SQL is permitted
//   - the cross-tenant ACCESS model: whether ops gets unrestricted cross-tenant SQL over
//     the bronze blob, and how that is authorized/isolated (joins slices 24-25)
// The UI defines only the request/result/error SHAPES and renders a fixture.

// 7.4 request body (UI-defined).
export type QueryRequest = { sql: string }

// Dynamic result: arbitrary columns, rows as tuples aligned to columns. This is the one
// screen with no fixed result shape.
export type QueryColumn = { name: string; type: string }
export type QueryResult = { columns: QueryColumn[]; rows: unknown[][] }

// SQL-style error (7.4 failure). PROVISIONAL.
export type QueryError = { message: string }

// Canned cross-tenant query strings the stub recognizes (the sample-query buttons load
// these). Recognition is by substring so light edits still hit a sample.
export const SAMPLE_QUERIES = {
  normal: 'SELECT tenant_id, count(*) AS rows\nFROM bronze\nGROUP BY tenant_id',
  error: 'SELECT * FROM nope',
  empty: 'SELECT * FROM bronze WHERE 1 = 0',
} as const

const NORMAL_RESULT: QueryResult = {
  columns: [
    { name: 'tenant_id', type: 'VARCHAR' },
    { name: 'rows', type: 'BIGINT' },
  ],
  rows: [
    ['t_acme9k2l1mn4', 2079],
    ['t_beta7h2k9m3n', 18402],
    ['t_delta2s9t5v3', 120],
  ],
}

const EMPTY_RESULT: QueryResult = {
  columns: [
    { name: 'sku', type: 'VARCHAR' },
    { name: 'price', type: 'VARCHAR' },
  ],
  rows: [],
}

// STUB. Recognizes the canned strings; an unrecognized query returns the normal sample so
// the panel is usable in dev. Rejects with a SQL-style message for the error sample.
export async function executeQuery(req: QueryRequest): Promise<QueryResult> {
  const text = req.sql.trim().toLowerCase()
  if (text.includes('from nope')) {
    const error: QueryError = { message: "Catalog Error: Table with name 'nope' does not exist" }
    throw new Error(error.message)
  }
  if (text.includes('where 1 = 0') || text.includes('where 1=0')) {
    return EMPTY_RESULT
  }
  return NORMAL_RESULT
}

// idle / running (isPending) / result (isSuccess + data) / error (isError + error) come
// straight off the mutation; empty-result = success with rows.length === 0.
export function useRunQuery() {
  return useMutation<QueryResult, Error, string>({
    mutationFn: (sqlText: string) => executeQuery({ sql: sqlText }),
  })
}
