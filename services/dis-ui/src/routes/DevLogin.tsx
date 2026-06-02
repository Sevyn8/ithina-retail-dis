import { useState } from 'react'
import { useNavigate } from 'react-router'

import { PERSONAS } from '../auth/dev/personas'
import { signStubToken } from '../auth/dev/signStubToken'
import { useAuth } from '../auth/useAuth'

// Dev-only login. Mints a stub JWT for the chosen persona, hands it to
// AuthProvider via login(), and navigates to the protected home. There is no real
// Customer Master here; this route exists only in dev (signStubToken refuses to
// run in a production build).
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
    <section className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-semibold">DIS UI - Dev Login</h1>
      <p className="mb-4 text-sm">Pick a persona to sign in with a local stub token.</p>
      <ul className="flex flex-col gap-2">
        {PERSONAS.map((persona) => (
          <li key={persona.id}>
            <button
              type="button"
              onClick={() => void pick(persona.id)}
              className="w-full rounded border px-3 py-2 text-left"
            >
              {persona.label}
            </button>
          </li>
        ))}
      </ul>
      {error !== null ? (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      ) : null}
    </section>
  )
}
