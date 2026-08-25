import type { Metadata } from 'next'
import { AptMap } from '@/components/apt-map'

export const metadata: Metadata = {
  title: '아파트 도면 지도',
  description: '전국 아파트 단지의 평형별 평면도를 찾아보고, 그 위에 바로 도면을 그려보세요.',
}

export default function AptPage() {
  return <AptMap />
}
