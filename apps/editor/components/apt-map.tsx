'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AptDatasetPayload,
  type AptEntry,
  escapeHtml,
  normalizeSearch,
  parseAptDataset,
  shortName,
  typeWithPyeong,
} from '@/lib/apt-format'
import { withBasePath } from '@/lib/base-path'
import styles from './apt-map.module.css'

const LIST_LIMIT = 300
const MARKER_LIMIT = 250
const NAVER_SCRIPT_ID = 'naver-maps-sdk'
const MARKER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V3h11v5h5v13h-2v-2h-2v2h-2v-2h-4v2H8v-2H6v2H4Zm3-5h2v-2H7v2Zm0-4h2v-2H7v2Zm0-4h2V6H7v2Zm4 8h2v-2h-2v2Zm0-4h2v-2h-2v2Zm0-4h2V6h-2v2Zm5 8h2v-2h-2v2Zm0-4h2v-2h-2v2Z"/></svg>'

/* Minimal structural surface of the Naver Maps v3 SDK this page touches. */
type NLatLng = { lat(): number; lng(): number }
type NBounds = { getSW(): NLatLng; getNE(): NLatLng; extend(point: NLatLng): void }
type NMap = {
  getBounds(): NBounds
  getZoom(): number
  setZoom(zoom: number): void
  setCenter(center: NLatLng): void
  fitBounds(bounds: NBounds): void
  destroy(): void
}
type NMarker = { setMap(map: NMap | null): void }
type NaverMaps = {
  Map: new (el: HTMLElement, opts: unknown) => NMap
  LatLng: new (lat: number, lng: number) => NLatLng
  LatLngBounds: new () => NBounds
  Point: new (x: number, y: number) => unknown
  Marker: new (opts: unknown) => NMarker
  Position: { TOP_LEFT: unknown }
  Event: {
    addListener(target: unknown, name: string, handler: () => void): unknown
    removeListener(listener: unknown): void
  }
}

declare global {
  interface Window {
    naver?: { maps?: NaverMaps }
    navermap_authFailure?: () => void
  }
}

type Plan = { type: string; planId: string; planPic: string; name: string }

type InteriorInfo = {
  sourceName?: string
  approvalDate?: string
  ageYears?: number | null
  heating?: string
  corridor?: string
  buildings?: number | null
  households?: number | null
  builder?: string
  managementPhone?: string
  scopeWarning?: string
}

type PlansState = { status: 'loading' } | { status: 'full'; plans: Plan[] } | { status: 'fallback' }
type InteriorState =
  | { status: 'loading' }
  | { status: 'ok'; info: InteriorInfo }
  | { status: 'empty' }
type ViewerState = { pic: string; name: string; type: string } | null
type BoundsBox = { swLat: number; swLng: number; neLat: number; neLng: number }

export function AptMap() {
  const [entries, setEntries] = useState<AptEntry[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [filters, setFilters] = useState({ keyword: '', cityDo: '', guSi: '', dongEup: '' })
  const [bounds, setBounds] = useState<BoundsBox | null>(null)
  const [active, setActive] = useState<AptEntry | null>(null)
  const [plansState, setPlansState] = useState<PlansState>({ status: 'loading' })
  const [interiorState, setInteriorState] = useState<InteriorState>({ status: 'loading' })
  const [viewer, setViewer] = useState<ViewerState>(null)
  const [mapMessage, setMapMessage] = useState<React.ReactNode>(null)

  const mapRef = useRef<NMap | null>(null)
  const naverRef = useRef<NaverMaps | null>(null)
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const overlaysRef = useRef<NMarker[]>([])
  const activeIdRef = useRef<string | null>(null)
  const openDetailRef = useRef<(apt: AptEntry) => void>(() => {})

  /* ── dataset ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    fetch(withBasePath('/api/apartments/dataset'))
      .then((res) => {
        if (!res.ok) throw new Error(`dataset ${res.status}`)
        return res.json() as Promise<AptDatasetPayload>
      })
      .then((payload) => {
        if (!cancelled) setEntries(parseAptDataset(payload))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* ── Naver map bootstrap ─────────────────────────────── */
  useEffect(() => {
    let disposed = false
    let idleListener: unknown = null

    const initMap = () => {
      const maps = window.naver?.maps
      if (disposed || !maps || !mapElRef.current || mapRef.current) return
      naverRef.current = maps
      const map = new maps.Map(mapElRef.current, {
        center: new maps.LatLng(37.5666, 126.9784),
        zoom: 14,
        zoomControl: true,
        zoomControlOptions: { position: maps.Position.TOP_LEFT },
      })
      mapRef.current = map
      const readBounds = debounce(() => {
        if (disposed) return
        const b = map.getBounds()
        setBounds({
          swLat: b.getSW().lat(),
          swLng: b.getSW().lng(),
          neLat: b.getNE().lat(),
          neLng: b.getNE().lng(),
        })
      }, 250)
      idleListener = maps.Event.addListener(map, 'idle', readBounds)
      readBounds()
    }

    window.navermap_authFailure = () => {
      // After an auth failure the SDK throws from every entry point, so the
      // map is written off entirely and the page degrades to the list UI.
      sdkQuietly(() => {
        for (const overlay of overlaysRef.current) overlay.setMap(null)
      })
      overlaysRef.current = []
      mapRef.current = null
      naverRef.current = null
      // A frozen initial viewport would filter the list forever; without a
      // live map the sidebar shows every filter match instead.
      setBounds(null)
      setMapMessage(
        <>
          <b>네이버 지도 인증 실패</b>
          <br />
          <br />
          네이버클라우드 Maps의 Web Dynamic Map 키가 이 주소에 등록되어 있는지 확인하세요.
          <br />
          임시로 주소창에 <b>?key=발급받은키</b> 를 붙여 접속할 수 있습니다.
        </>,
      )
    }

    const key =
      new URLSearchParams(window.location.search).get('key') ||
      process.env.NEXT_PUBLIC_NAVER_MAPS_KEY ||
      ''
    if (!key) {
      setMapMessage(
        <>
          <b>지도 키가 설정되지 않았습니다</b>
          <br />
          <br />
          <code>NEXT_PUBLIC_NAVER_MAPS_KEY</code> 를 설정하거나 주소창에 <b>?key=발급받은키</b> 를
          붙여 접속하세요.
        </>,
      )
      return
    }

    if (window.naver?.maps) {
      initMap()
    } else {
      let script = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = NAVER_SCRIPT_ID
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`
        document.head.appendChild(script)
      }
      script.addEventListener('load', initMap)
      script.addEventListener('error', () =>
        setMapMessage('네이버 지도 스크립트 로드 실패. 네트워크를 확인하세요.'),
      )
    }

    return () => {
      disposed = true
      sdkQuietly(() => {
        for (const overlay of overlaysRef.current) overlay.setMap(null)
      })
      overlaysRef.current = []
      sdkQuietly(() => {
        if (idleListener && naverRef.current) naverRef.current.Event.removeListener(idleListener)
        mapRef.current?.destroy()
      })
      mapRef.current = null
    }
  }, [])

  /* ── derived lists ───────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!entries) return []
    const kw = normalizeSearch(filters.keyword)
    return entries.filter(
      (a) =>
        (!kw || a.searchText.includes(kw)) &&
        (!filters.cityDo || a.cityDo === filters.cityDo) &&
        (!filters.guSi || a.guSi === filters.guSi) &&
        (!filters.dongEup || a.dongEup === filters.dongEup),
    )
  }, [entries, filters])

  const visible = useMemo(() => {
    if (!bounds) return filtered
    return filtered.filter(
      (a) =>
        a.lat >= bounds.swLat &&
        a.lat <= bounds.neLat &&
        a.lng >= bounds.swLng &&
        a.lng <= bounds.neLng,
    )
  }, [filtered, bounds])

  const cityOptions = useMemo(() => uniqSorted((entries ?? []).map((a) => a.cityDo)), [entries])
  const guOptions = useMemo(
    () =>
      uniqSorted(
        (entries ?? [])
          .filter((a) => !filters.cityDo || a.cityDo === filters.cityDo)
          .map((a) => a.guSi),
      ),
    [entries, filters.cityDo],
  )
  const dongOptions = useMemo(
    () =>
      uniqSorted(
        (entries ?? [])
          .filter(
            (a) =>
              (!filters.cityDo || a.cityDo === filters.cityDo) &&
              (!filters.guSi || a.guSi === filters.guSi),
          )
          .map((a) => a.dongEup),
      ),
    [entries, filters.cityDo, filters.guSi],
  )

  /* ── detail ──────────────────────────────────────────── */
  const openDetail = useCallback((apt: AptEntry) => {
    activeIdRef.current = apt.apartmentId
    setActive(apt)
    setPlansState({ status: 'loading' })
    setInteriorState({ status: 'loading' })

    fetch(withBasePath(`/api/apartments/${encodeURIComponent(apt.apartmentId)}/plans`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { code?: string; data?: Plan[] }) => {
        if (activeIdRef.current !== apt.apartmentId) return
        if (json.code === 'OK' && Array.isArray(json.data) && json.data.length) {
          setPlansState({ status: 'full', plans: json.data })
        } else {
          setPlansState({ status: 'fallback' })
        }
      })
      .catch(() => {
        if (activeIdRef.current === apt.apartmentId) setPlansState({ status: 'fallback' })
      })

    fetch(withBasePath(`/api/apartments/${encodeURIComponent(apt.apartmentId)}/interior-info`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { code?: string; data?: InteriorInfo }) => {
        if (activeIdRef.current !== apt.apartmentId) return
        if (json.code === 'OK' && json.data) setInteriorState({ status: 'ok', info: json.data })
        else setInteriorState({ status: 'empty' })
      })
      .catch(() => {
        if (activeIdRef.current === apt.apartmentId) setInteriorState({ status: 'empty' })
      })
  }, [])
  openDetailRef.current = openDetail

  const closeDetail = useCallback(() => {
    activeIdRef.current = null
    setActive(null)
  }, [])

  const focusApartment = useCallback(
    (apt: AptEntry) => {
      const maps = naverRef.current
      const map = mapRef.current
      if (maps && map) {
        sdkQuietly(() => {
          map.setCenter(new maps.LatLng(apt.lat, apt.lng))
          if (map.getZoom() < 16) map.setZoom(16)
        })
      }
      openDetail(apt)
    },
    [openDetail],
  )

  /* ── imperative markers ──────────────────────────────── */
  useEffect(() => {
    const maps = naverRef.current
    const map = mapRef.current
    if (!maps || !map) return
    sdkQuietly(() => {
      for (const overlay of overlaysRef.current) overlay.setMap(null)
    })
    overlaysRef.current = []

    sdkQuietly(() => {
      if (visible.length <= MARKER_LIMIT) {
        for (const a of visible) {
          const marker = new maps.Marker({
            position: new maps.LatLng(a.lat, a.lng),
            map,
            title: `${a.name} 도면 보기`,
            icon: {
              content: `<button class="${styles.aptMarker}" type="button" aria-label="${escapeHtml(a.name)} 도면 보기"><span class="${styles.aptMarkerIcon}">${MARKER_SVG}</span><span class="${styles.aptMarkerName}">${escapeHtml(shortName(a.name))}</span></button>`,
              anchor: new maps.Point(22, 18),
            },
          })
          maps.Event.addListener(marker, 'click', () => openDetailRef.current(a))
          overlaysRef.current.push(marker)
        }
      } else {
        const b = map.getBounds()
        const sw = b.getSW()
        const ne = b.getNE()
        const COLS = 10
        const ROWS = 8
        const dLng = (ne.lng() - sw.lng()) / COLS
        const dLat = (ne.lat() - sw.lat()) / ROWS
        const cells = new Map<number, { n: number; lat: number; lng: number }>()
        for (const a of visible) {
          const cx = Math.min(COLS - 1, Math.floor((a.lng - sw.lng()) / dLng))
          const cy = Math.min(ROWS - 1, Math.floor((a.lat - sw.lat()) / dLat))
          const key = cy * COLS + cx
          const cell = cells.get(key) ?? { n: 0, lat: 0, lng: 0 }
          cell.n++
          cell.lat += a.lat
          cell.lng += a.lng
          cells.set(key, cell)
        }
        for (const cell of cells.values()) {
          const size = Math.min(64, 28 + Math.round(Math.log2(cell.n) * 6))
          const center = new maps.LatLng(cell.lat / cell.n, cell.lng / cell.n)
          const marker = new maps.Marker({
            position: center,
            map,
            icon: {
              content: `<div class="${styles.cluster}" style="width:${size}px;height:${size}px;font-size:${size > 44 ? 14 : 12}px">${cell.n.toLocaleString()}</div>`,
              anchor: new maps.Point(size / 2, size / 2),
            },
          })
          maps.Event.addListener(marker, 'click', () => {
            map.setCenter(center)
            map.setZoom(map.getZoom() + 2)
          })
          overlaysRef.current.push(marker)
        }
      }
    })
  }, [visible])

  /* ── search & filters ────────────────────────────────── */
  const fitTo = useCallback((list: AptEntry[]) => {
    const maps = naverRef.current
    const map = mapRef.current
    if (!maps || !map || !list.length) return
    sdkQuietly(() => {
      if (list.length === 1) {
        const only = list[0]
        if (!only) return
        map.setCenter(new maps.LatLng(only.lat, only.lng))
        map.setZoom(16)
        return
      }
      const b = new maps.LatLngBounds()
      for (const a of list.slice(0, 2000)) b.extend(new maps.LatLng(a.lat, a.lng))
      map.fitBounds(b)
    })
  }, [])

  const applyFilters = useCallback(
    (next: typeof filters, opts: { fitAll?: boolean; openSingle?: boolean } = {}) => {
      setFilters(next)
      closeDetail()
      if (!entries) return
      const kw = normalizeSearch(next.keyword)
      const matches = entries.filter(
        (a) =>
          (!kw || a.searchText.includes(kw)) &&
          (!next.cityDo || a.cityDo === next.cityDo) &&
          (!next.guSi || a.guSi === next.guSi) &&
          (!next.dongEup || a.dongEup === next.dongEup),
      )
      if (opts.fitAll && matches.length) fitTo(matches)
      if (opts.openSingle && matches.length === 1 && matches[0]) focusApartment(matches[0])
    },
    [entries, closeDetail, fitTo, focusApartment],
  )

  const runKeywordSearch = useCallback(
    (keyword: string, openSingle: boolean) => {
      applyFilters(
        { ...filters, keyword: keyword.trim() },
        { fitAll: !!keyword.trim(), openSingle },
      )
    },
    [applyFilters, filters],
  )

  const debouncedSearch = useMemo(
    () => debounce((keyword: string) => runKeywordSearch(keyword, false), 300),
    [runKeywordSearch],
  )

  /* ── viewer escape key ───────────────────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewer(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /* ── render ──────────────────────────────────────────── */
  const statusText = loadFailed
    ? '데이터를 불러오지 못했습니다. 새로고침 해보세요.'
    : !entries
      ? '로딩 중...'
      : `검색결과 ${filtered.length.toLocaleString()}개 단지 · 화면 안 ${visible.length.toLocaleString()}개`

  const listItems = visible.slice(0, LIST_LIMIT)

  return (
    <div className={styles.app}>
      <div className={styles.sidebar}>
        <div className={styles.searchBox}>
          <input
            className={styles.keyword}
            onChange={(event) => {
              setKeywordInput(event.target.value)
              debouncedSearch(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                debouncedSearch.cancel()
                runKeywordSearch(keywordInput, true)
              }
            }}
            placeholder="아파트명·도로명 주소 검색 (예: 분포로 111)"
            value={keywordInput}
          />
          <button
            className={styles.searchBtn}
            onClick={() => {
              debouncedSearch.cancel()
              runKeywordSearch(keywordInput, true)
            }}
            type="button"
          >
            검색
          </button>
        </div>
        <div className={styles.regionRow}>
          <select
            onChange={(event) =>
              applyFilters(
                { ...filters, cityDo: event.target.value, guSi: '', dongEup: '' },
                { fitAll: !!event.target.value },
              )
            }
            value={filters.cityDo}
          >
            <option value="">시/도 전체</option>
            {cityOptions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            onChange={(event) =>
              applyFilters({ ...filters, guSi: event.target.value, dongEup: '' }, { fitAll: true })
            }
            value={filters.guSi}
          >
            <option value="">구/시 전체</option>
            {guOptions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            onChange={(event) =>
              applyFilters({ ...filters, dongEup: event.target.value }, { fitAll: true })
            }
            value={filters.dongEup}
          >
            <option value="">동/읍 전체</option>
            {dongOptions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className={styles.status}>{statusText}</div>
        <div className={styles.list}>
          {listItems.map((a) => (
            <div
              className={
                a.apartmentId === active?.apartmentId
                  ? `${styles.aptItem} ${styles.aptItemActive}`
                  : styles.aptItem
              }
              key={`${a.apartmentId}-${a.planId}`}
              onClick={() => focusApartment(a)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') focusApartment(a)
              }}
              role="button"
              tabIndex={0}
            >
              <div className={styles.aptName}>{a.name}</div>
              <div className={styles.aptAddr}>
                {a.addr || [a.cityDo, a.guSi, a.dongEup].join(' ')}
              </div>
              <div className={styles.aptType}>
                전체 평형 도면 열기 · 대표 {typeWithPyeong(a.type)}
              </div>
            </div>
          ))}
          {entries && !listItems.length && (
            <div className={styles.note}>
              이 영역에는 결과가 없습니다. 지도를 이동하거나 필터를 바꿔보세요.
            </div>
          )}
          {visible.length > listItems.length && (
            <div className={styles.note}>
              {listItems.length}개까지만 표시 중 (전체 {visible.length.toLocaleString()}개). 지도를
              확대해보세요.
            </div>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          <Link href="/scenes">내 씬 목록</Link>
          <Link href="/">도면 에디터 열기</Link>
        </div>
      </div>

      <div className={styles.mapWrap}>
        <div className={styles.map} ref={mapElRef} />
        {mapMessage && (
          <div className={styles.mapMsg}>
            <div className={styles.mapMsgCard}>{mapMessage}</div>
          </div>
        )}
        {active && (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <button
                aria-label="상세 닫기"
                className={styles.detailClose}
                onClick={closeDetail}
                type="button"
              >
                ✕
              </button>
              <h2>{active.name}</h2>
              <p>{active.addr || [active.cityDo, active.guSi, active.dongEup].join(' ')}</p>
              <a
                className={styles.detailNaverLink}
                href={`https://fin.land.naver.com/search?q=${encodeURIComponent(active.name)}`}
                rel="noopener noreferrer"
                target="_blank"
                title={`${active.name} 네이버 부동산 검색`}
              >
                Npay 부동산에서 확인 ↗
              </a>
            </div>
            <section aria-live="polite" className={styles.interiorInfo}>
              <InteriorPanel apt={active} state={interiorState} />
            </section>
            <div>
              <PlansPanel apt={active} onZoom={setViewer} state={plansState} />
            </div>
          </div>
        )}
      </div>

      {viewer && (
        <div
          aria-label="도면 크게 보기"
          aria-modal="true"
          className={styles.planViewer}
          onClick={(event) => {
            if (event.target === event.currentTarget) setViewer(null)
          }}
          role="dialog"
        >
          <button
            aria-label="도면 닫기"
            className={styles.viewerClose}
            onClick={() => setViewer(null)}
            type="button"
          >
            ✕
          </button>
          <img
            alt={viewer.name || `${typeWithPyeong(viewer.type)} 도면`}
            className={styles.viewerImage}
            referrerPolicy="no-referrer"
            src={viewer.pic}
          />
          <div className={styles.viewerCaption}>
            {[typeWithPyeong(viewer.type), viewer.name].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}

function InteriorPanel({ apt, state }: { apt: AptEntry; state: InteriorState }) {
  if (state.status === 'loading') {
    return (
      <>
        <div className={styles.interiorTitleRow}>
          <div className={styles.interiorTitle}>인테리어 준비 정보</div>
          <div className={styles.interiorSource}>K-apt 공개정보</div>
        </div>
        <div className={styles.interiorEmpty}>준공·난방·단지 정보를 확인하는 중입니다.</div>
      </>
    )
  }
  if (state.status === 'empty') {
    return (
      <>
        <div className={styles.interiorTitleRow}>
          <div className={styles.interiorTitle}>인테리어 준비 정보</div>
          <div className={styles.interiorSource}>확인 필요</div>
        </div>
        <div className={styles.interiorEmpty}>
          공공 단지정보를 정확히 매칭하지 못했습니다.{' '}
          <a
            href={`https://fin.land.naver.com/search?q=${encodeURIComponent(apt.name)}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            Npay 부동산에서 직접 확인 ↗
          </a>
        </div>
      </>
    )
  }

  const info = state.info
  const approval = [info.approvalDate, info.ageYears ? `${info.ageYears}년차` : '']
    .filter(Boolean)
    .join(' · ')
  const scale = [
    info.buildings ? `${info.buildings.toLocaleString()}개 동` : '',
    info.households ? `${info.households.toLocaleString()}세대` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const items: [string, React.ReactNode][] = []
  if (approval) items.push(['사용승인', approval])
  if (info.heating) items.push(['난방', info.heating])
  if (info.corridor) items.push(['현관·복도', info.corridor])
  if (scale) items.push(['단지 규모', scale])
  if (info.builder) items.push(['시공사', info.builder])
  if (info.managementPhone) {
    items.push([
      '관리사무소',
      <a href={`tel:${info.managementPhone.replace(/[^0-9+]/g, '')}`} key="tel">
        {info.managementPhone}
      </a>,
    ])
  }
  const ageCheck =
    (info.ageYears ?? 0) >= 15
      ? '준공 15년 이상 단지입니다. 배관·전기·창호 상태를 현장에서 확인하세요. '
      : ''

  return (
    <>
      <div className={styles.interiorTitleRow}>
        <div className={styles.interiorTitle}>인테리어 준비 정보</div>
        <div className={styles.interiorSource}>K-apt · {info.sourceName || '공개정보'}</div>
      </div>
      <div className={styles.interiorGrid}>
        {items.map(([label, value]) => (
          <div className={styles.interiorItem} key={label}>
            <span className={styles.interiorLabel}>{label}</span>
            <div className={styles.interiorValue}>{value}</div>
          </div>
        ))}
      </div>
      <div className={styles.interiorCheck}>
        {ageCheck}공사 가능 시간, 승강기 사용과 폐기물 반출 규정은 관리사무소에 확인하세요.
      </div>
      {info.scopeWarning && <div className={styles.interiorScope}>{info.scopeWarning}</div>}
    </>
  )
}

function PlansPanel({
  apt,
  state,
  onZoom,
}: {
  apt: AptEntry
  state: PlansState
  onZoom: (viewer: ViewerState) => void
}) {
  if (state.status === 'loading') return <div className={styles.note}>도면 불러오는 중...</div>

  if (state.status === 'full') {
    return (
      <>
        <div className={styles.note}>
          <b>전체 {state.plans.length.toLocaleString()}개 평형 도면</b> · 로그인 없이 제공
        </div>
        {state.plans.map((plan) => (
          <PlanCard apt={apt} key={plan.planId} onZoom={onZoom} plan={plan} />
        ))}
      </>
    )
  }

  return (
    <>
      <PlanCard
        apt={apt}
        onZoom={onZoom}
        plan={{ type: apt.type, planId: apt.planId, planPic: apt.planPic, name: apt.planName }}
      />
      <div className={styles.note}>
        전체 평형 인덱스에서 이 단지를 찾지 못해 대표 도면만 표시합니다.
      </div>
    </>
  )
}

function PlanCard({
  apt,
  plan,
  onZoom,
}: {
  apt: AptEntry
  plan: Plan
  onZoom: (viewer: ViewerState) => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const typeLabel = typeWithPyeong(plan.type)
  const traceHref = plan.planId
    ? `/apt/trace?apartmentId=${encodeURIComponent(apt.apartmentId)}&planId=${encodeURIComponent(plan.planId)}&name=${encodeURIComponent(apt.name)}&type=${encodeURIComponent(plan.type)}`
    : null

  return (
    <div className={styles.plan}>
      <div className={styles.planType}>{typeLabel}</div>
      {!imgFailed && (
        <button
          aria-label={`${plan.name || typeLabel || '도면'} 크게 보기`}
          className={styles.planThumb}
          onClick={() => onZoom({ pic: plan.planPic, name: plan.name, type: plan.type })}
          type="button"
        >
          <img
            alt={plan.name || ''}
            loading="lazy"
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
            src={plan.planPic}
          />
          <span className={styles.planZoomLabel}>크게 보기</span>
        </button>
      )}
      {traceHref && (
        <Link className={styles.planTraceLink} href={traceHref}>
          이 도면 위에 그리기 → <span aria-hidden>✏️</span>
        </Link>
      )}
    </div>
  )
}

/**
 * Every Naver SDK entry point throws once auth has failed; map features
 * degrade silently instead of taking the whole page down with them.
 */
function sdkQuietly(run: () => void): void {
  try {
    run()
  } catch {
    /* map unusable — the list UI stays alive */
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
}
