import type { Metadata } from 'next'
import { AptSearch } from '@/components/apt-search'

export const metadata: Metadata = {
  title: '아파트 도면 검색',
  description: '아파트를 검색해 단지 정보를 확인하고, 원하는 평형의 평면도 위에 바로 그리세요.',
}

export default function AptPage() {
  return <AptSearch />
}
