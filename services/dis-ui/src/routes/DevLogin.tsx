import { Boxes } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { PERSONAS } from '../auth/dev/personas'
import { useAuth } from '../auth/useAuth'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Dev-only login. Logs in the chosen persona with its PRE-SUPPLIED dev-stub token
// (baked at build via VITE_STUB_TOKEN_* build args), hands it to AuthProvider via
// login(), and navigates to the protected home. No client-side minting and no real
// Customer Master here; this route is dev/staging only.
export function DevLogin() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  async function pick(personaId: string): Promise<void> {
    setError(null)
    const persona = PERSONAS.find((candidate) => candidate.id === personaId)
    if (persona === undefined) {
      setError('Unknown persona')
      return
    }
    // Per-persona pre-supplied dev-stub tokens, baked at build time via VITE_ build
    // args (literal import.meta.env accesses so Vite statically replaces them). No
    // client-side minting: each persona logs in with its own pre-supplied token.
    const PERSONA_TOKENS: Record<string, string | undefined> = {
      tenant: import.meta.env.VITE_STUB_TOKEN_TENANT,
      ops: import.meta.env.VITE_STUB_TOKEN_OPS,
    }
    const token = PERSONA_TOKENS[persona.id]
    if (token === undefined || token === '') {
      setError('Could not sign in with the selected persona')
      return
    }
    try {
      await login(token)
      navigate('/', { replace: true })
    } catch {
      setError('Could not sign in with the selected persona')
    }
  }

  return (
    <section className="mx-auto mt-16 max-w-md">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Boxes aria-hidden="true" className="h-5 w-5" />
        </span>
        <h1 className="text-display">DIS UI - Dev Login</h1>
      </div>
      <p className="mb-4 text-caption text-muted-foreground">
        Pick a persona to sign in with a local stub token.
      </p>
      <Card>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {PERSONAS.map((persona) => (
              <li key={persona.id}>
                <button
                  type="button"
                  onClick={() => void pick(persona.id)}
                  className="flex w-full flex-col items-start gap-2 rounded-md border border-border bg-card p-4 text-left text-card-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="text-base font-semibold">{persona.name}</span>
                  <span className="text-sm text-muted-foreground">{persona.email}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={persona.roleLabel === 'PLATFORM' ? 'default' : 'secondary'}>
                      {persona.roleLabel}
                    </Badge>
                    {persona.tenantName !== null ? (
                      <Badge variant="outline">{persona.tenantName}</Badge>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {error !== null ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
