import Link from 'next/link'
import { AptTrace } from '@/components/apt-trace'

/**
 * Map → editor bridge. Deliberately NOT in the public-route allowlist
 * (`lib/auth-gate.ts`): reaching it logged-out redirects through the INTM
 * login and back, and only then does the client create the scene.
 */
export default async function AptTracePage({
  searchParams,
}: {
  searchParams: Promise<{
    apartmentId?: string
    planId?: string
    name?: string
    type?: string
    vector?: string
    flipX?: string
    flipY?: string
  }>
}) {
  const { apartmentId, planId, name, type, vector, flipX, flipY } = await searchParams

  if (!apartmentId || !planId) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-medium text-lg">도면 정보가 없습니다.</p>
        <Link className="text-sm underline" href="/apt">
          아파트 지도로 돌아가기
        </Link>
      </main>
    )
  }

  return (
    <AptTrace
      apartmentId={apartmentId}
      name={name ?? ''}
      planId={planId}
      type={type ?? ''}
      flipX={flipX === '1'}
      flipY={flipY === '1'}
      vector={vector === '1'}
    />
  )
}
