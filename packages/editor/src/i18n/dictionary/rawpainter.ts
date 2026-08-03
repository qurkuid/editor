import type { Dictionary } from './types'

/** `apps/editor/components/rawpainter-catalog.tsx`,
 * `rawpainter-search.tsx`, `rawpainter-product-card.tsx`. Templated
 * entries use `{token}` placeholders the caller fills with `.replace()`.
 * Real KRW prices (`toLocaleString('ko-KR')` + '원') stay locale-invariant
 * — they're actual vendor pricing, not UI copy. */
export const rawpainterDictionary = {
  'rawpainter.errors.connectionFailed': {
    ko: 'RawPainter 서버에 연결할 수 없습니다.',
    en: "Couldn't connect to the RawPainter server.",
  },
  'rawpainter.header.title': { ko: 'RawPainter 자재', en: 'RawPainter materials' },
  'rawpainter.header.summary': {
    ko: '카테고리 {categories}개 · 자재 {total}개',
    en: '{categories} categories · {total} materials',
  },
  'rawpainter.header.liveCatalog': { ko: '실시간 카탈로그', en: 'Live catalog' },
  'rawpainter.categories.all': { ko: '전체', en: 'All' },
  'rawpainter.loading': { ko: '자재 목록 불러오는 중', en: 'Loading materials' },
  'rawpainter.retry': { ko: '다시 시도', en: 'Retry' },
  'rawpainter.empty.title': { ko: '검색 결과가 없습니다.', en: 'No results found.' },
  'rawpainter.empty.desc': {
    ko: '제품명이나 브랜드를 확인해 주세요.',
    en: 'Check the product name or brand.',
  },
  'rawpainter.loadMore': { ko: '더 보기', en: 'Load more' },

  'rawpainter.search.ariaLabel': {
    ko: 'RawPainter 자재 검색',
    en: 'Search RawPainter materials',
  },
  'rawpainter.search.placeholder': {
    ko: '제품명, 브랜드, 판매처 검색',
    en: 'Search product, brand, or store',
  },
  'rawpainter.search.clearAriaLabel': { ko: '검색 초기화', en: 'Clear search' },
  'rawpainter.search.submit': { ko: '검색', en: 'Search' },

  'rawpainter.card.priceInquiry': { ko: '가격 문의', en: 'Price on request' },
  'rawpainter.card.selectAriaLabel': { ko: '{name} 선택', en: 'Select {name}' },
  'rawpainter.card.unnamedMaterial': { ko: '이름 없는 자재', en: 'Unnamed material' },
  'rawpainter.card.altFallback': { ko: 'RawPainter 자재', en: 'RawPainter material' },
  'rawpainter.card.unbrandedLabel': { ko: '브랜드 미등록', en: 'Brand not listed' },
  'rawpainter.card.unlistedStore': { ko: '판매처 미등록', en: 'Store not listed' },
  'rawpainter.card.noSizeInfo': { ko: '규격 정보 없음', en: 'No size info' },
  'rawpainter.card.noImage': { ko: '이미지 없음', en: 'No image' },
  'rawpainter.card.otherCategory': { ko: '기타', en: 'Other' },
} as const satisfies Dictionary
