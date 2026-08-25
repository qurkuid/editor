import { describe, expect, test } from 'bun:test'
import {
  groupComplexes,
  normalizeSearch,
  parseAptDataset,
  shortName,
  typeWithPyeong,
} from './apt-format'

describe('normalizeSearch', () => {
  test('collapses city suffixes and symbols the way the search index does', () => {
    expect(normalizeSearch('서울특별시 강남구 테헤란로 1')).toBe('서울강남구테헤란로1')
    expect(normalizeSearch('세종특별자치시')).toBe('세종')
    expect(normalizeSearch('Raemian APT (2차)')).toBe('raemianapt2차')
  })
})

describe('typeWithPyeong', () => {
  test('appends the rounded pyeong band for ㎡ types', () => {
    expect(typeWithPyeong('84A㎡')).toBe('84A㎡ · 약 25평대')
    expect(typeWithPyeong('113B㎡')).toBe('113B㎡ · 약 34평대')
  })

  test('passes through what it cannot parse', () => {
    expect(typeWithPyeong('')).toBe('-')
    expect(typeWithPyeong('복층형')).toBe('복층형')
  })
})

describe('shortName', () => {
  test('ellipsizes past 12 characters', () => {
    expect(shortName('열두글자넘는아주아주긴단지명')).toBe('열두글자넘는아주아주긴단…')
    expect(shortName('짧은이름')).toBe('짧은이름')
  })
})

describe('parseAptDataset', () => {
  const payload = {
    cols: [
      'id',
      'name',
      'planId',
      'planPic',
      'apartmentName',
      'apartmentId',
      'cityDo',
      'guSi',
      'dongEup',
      'latitude',
      'longitude',
      'legacyAddress',
      'roadAddress',
      'type',
    ],
    picPrefix: 'https://cdn.example/',
    rows: [
      [
        1,
        '플랜A',
        'p1',
        'img/a.jpg',
        '단지A',
        'apt1',
        '서울',
        '강남구',
        '역삼동',
        '37.5',
        '127.0',
        '옛주소',
        '도로명주소',
        '84㎡',
      ],
      [
        2,
        '플랜B',
        'p2',
        'https://other/b.jpg',
        '단지B',
        'apt2',
        '경기',
        '성남시',
        '분당동',
        '99',
        '127.0',
        '',
        '',
        '59㎡',
      ],
    ],
  }

  test('resolves relative plan pics and keeps rows regardless of coordinates', () => {
    const entries = parseAptDataset(payload)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.planPic).toBe('https://cdn.example/img/a.jpg')
    expect(entries[0]?.addr).toBe('도로명주소')
    expect(entries[0]?.searchText).toContain('단지a')
  })

  test('groupComplexes collapses to one row per apartmentId with an address fallback', () => {
    const twice = { ...payload, rows: [...payload.rows, payload.rows[0] as (string | number)[]] }
    const complexes = groupComplexes(parseAptDataset(twice))
    expect(complexes).toHaveLength(2)
    expect(complexes[0]?.apartmentId).toBe('apt1')
    expect(complexes[0]?.planId).toBe('p1')
    expect(complexes[1]?.addr).toBe('경기 성남시 분당동')
  })
})
