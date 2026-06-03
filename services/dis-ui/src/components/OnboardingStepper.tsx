import { cn } from '@/lib/utils'

// Onboarding stepper (slice 23 craft spec): the three-step progress rail shown on the
// onboarding screens (Upload -> Review -> Promote). Pure chrome; carries no behavior.
const STEPS = ['Upload', 'Review', 'Promote'] as const
export type OnboardingStep = (typeof STEPS)[number]

export function OnboardingStepper({ active }: { active: OnboardingStep }) {
  const activeIndex = STEPS.indexOf(active)

  return (
    <ol className="mb-4 flex items-center gap-2 text-caption" aria-label="Onboarding progress">
      {STEPS.map((step, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming'
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium',
                state === 'active' && 'border-transparent bg-primary text-primary-foreground',
                state === 'done' && 'border-transparent bg-success/15 text-success',
                state === 'upcoming' && 'border-border text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                state === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {step}
            </span>
            {index < STEPS.length - 1 ? <span className="text-muted-foreground">/</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
