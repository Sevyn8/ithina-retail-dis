import { Boxes } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { PERSONAS } from '../auth/dev/personas'
import { signStubToken } from '../auth/dev/signStubToken'
import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Dev-only login, on the design-system craft bar. Mints a stub JWT for the chosen
// persona, hands it to AuthProvider via login(), and navigates to the protected home.
// There is no real Customer Master here; this route exists only in dev (signStubToken
// refuses to run in a production build).
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
    try {
      const token = await signStubToken(persona)
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
          <ul className="flex flex-col gap-2">
            {PERSONAS.map((persona) => (
              <li key={persona.id}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void pick(persona.id)}
                  className="w-full justify-start"
                >
                  {persona.label}
                </Button>
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
