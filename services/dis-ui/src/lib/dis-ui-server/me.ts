import { useQuery } from '@tanstack/react-query'

import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { ME_FIXTURES } from './fixtures'
import { SERVER_MODE } from './mode'
import type { MeResponse } from './types'

// Returns the signed-in user's profile.
//
// Fixture mode (slice 19 default): returns the inlined fixture for the current
// user and makes no network call.
//
// Real mode: TBD. Whether the real implementation hits a GET /me endpoint or
// decodes the token's claims is an open question for Sanjeev and slice 13 (arch
// 4.17 lists no GET /me handler; the demand list assumes one). Nothing in this
// checkpoint depends on the answer, so the real branch throws loudly rather than
// guessing. When it lands it will use client.request() and a parseMeResponse
// guard (see client.ts FM4 note).
export async function getMe(snapshot: AuthSnapshot): Promise<MeResponse> {
  if (SERVER_MODE === 'real') {
    throw new Error(
      'real-mode getMe() is not implemented in slice 19; the GET /me vs. token-decode ' +
        'fork is an open question for slice 13',
    )
  }
  const fixture = ME_FIXTURES[snapshot.user_id]
  if (fixture === undefined) {
    throw new Error(`no fixture MeResponse for user_id ${snapshot.user_id}`)
  }
  return fixture
}

export function useMe(snapshot: AuthSnapshot | null) {
  return useQuery({
    queryKey: ['dis-ui-server', 'me', snapshot?.user_id ?? 'anonymous'],
    queryFn: () => getMe(snapshot as AuthSnapshot),
    enabled: snapshot !== null,
    staleTime: Infinity,
    retry: false,
  })
}
