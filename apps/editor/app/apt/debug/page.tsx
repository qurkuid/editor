import { AptDebug } from '@/components/apt-debug'

/**
 * Internal QA viewer for the plan auto-model pipeline. Deliberately NOT in
 * the public-route allowlist (`lib/auth-gate.ts`), so it sits behind the
 * INTM login like `/apt/trace`.
 */
export default async function AptDebugPage({
  searchParams,
}: {
  searchParams: Promise<{ apartmentId?: string; planId?: string }>
}) {
  const { apartmentId, planId } = await searchParams
  return <AptDebug initialApartmentId={apartmentId} initialPlanId={planId} />
}
