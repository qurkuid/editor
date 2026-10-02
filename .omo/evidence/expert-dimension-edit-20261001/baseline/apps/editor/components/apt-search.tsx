'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { typeWithPyeong } from '@/lib/apt-format'
import { type AptPlanOrientation, aptImageTransform } from '@/lib/apt-import-frame'
import {
  type AptComplex,
  type AptInteriorState,
  type AptPlan,
  formatSceneDate,
  plansToShow,
  useAptSearch,
} from '@/lib/use-apt-search'
import styles from './apt-search.module.css'

type ViewerState = {
  pic: string
  name: string
  type: string
  orientation: AptPlanOrientation
} | null

/**
 * The public front door: search a complex → read its facts → pick a floor
 * plan → start (or resume) modeling. List-first, no map.
 */
export function AptSearch() {
  const search = useAptSearch({ resultLimit: 100 })
  const [viewer, setViewer] = useState<ViewerState>(null)
  const [deepLinkMiss, setDeepLinkMiss] = useState(false)
  const deepLinkedRef = useRef(false)

  // ?apartmentId= deep link from a scene card's "지도에서 보기".
  const { ready, findById, select } = search
  useEffect(() => {
    if (!ready || deepLinkedRef.current) return
    deepLinkedRef.current = true
    const wanted = new URLSearchParams(window.location.search).get('apartmentId')
    if (!wanted) return
    const complex = findById(wanted)
    if (complex) select(complex)
    else setDeepLinkMiss(true)
  }, [ready, findById, select])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewer(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>아파트 도면 검색</h1>
          <nav className={styles.headerLinks}>
            <Link href="/scenes">내 씬 목록</Link>
            <Link href="/editor">빈 캔버스 에디터</Link>
          </nav>
        </header>

        <div className={styles.searchBox}>
          <input
            className={styles.keyword}
            onChange={(event) => {
              search.setKeyword(event.target.value)
              search.clearSelection()
              setDeepLinkMiss(false)
            }}
            placeholder="아파트명·도로명 주소 검색 (예: 분포로 111)"
            value={search.keyword}
          />
        </div>

        {deepLinkMiss && (
          <div className={styles.note}>
            연결된 단지를 데이터에서 찾지 못했습니다. 이름으로 검색해보세요.
          </div>
        )}

        {search.loadFailed && (
          <div className={styles.note}>데이터를 불러오지 못했습니다. 새로고침 해보세요.</div>
        )}

        {search.selected ? (
          <ComplexDetail onZoom={setViewer} search={search} />
        ) : search.keyword.trim() ? (
          <div className={styles.results}>
            {search.results.map((complex) => (
              <button
                className={styles.resultItem}
                key={complex.apartmentId}
                onClick={() => search.select(complex)}
                type="button"
              >
                <div className={styles.resultName}>{complex.name}</div>
                <div className={styles.resultAddr}>{complex.addr}</div>
              </button>
            ))}
            {search.results.length === 0 && search.ready && (
              <div className={styles.resultMore}>검색 결과가 없습니다.</div>
            )}
            {search.results.length === 100 && (
              <div className={styles.resultMore}>
                상위 100개만 표시 중입니다. 검색어를 더 구체적으로 입력해보세요.
              </div>
            )}
          </div>
        ) : (
          <p className={styles.hint}>
            {search.ready
              ? `전국 ${search.total.toLocaleString()}개 단지의 평형별 평면도를 제공합니다.`
              : '데이터를 불러오는 중…'}
            <br />
            단지를 검색해 정보를 확인하고, 원하는 평형의 도면 위에 바로 그리세요.
          </p>
        )}
      </div>

      {viewer && (
        <div
          aria-label="도면 크게 보기"
          aria-modal="true"
          className={styles.viewer}
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
            style={{ transform: aptImageTransform(viewer.orientation) }}
          />
          <div className={styles.viewerCaption}>
            {[typeWithPyeong(viewer.type), viewer.name].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}

function ComplexDetail({
  search,
  onZoom,
}: {
  search: ReturnType<typeof useAptSearch>
  onZoom: (viewer: ViewerState) => void
}) {
  const complex = search.selected
  if (!complex) return null
  const plans = plansToShow(complex, search.plansState)

  return (
    <div className={styles.detail}>
      <button className={styles.backBtn} onClick={search.clearSelection} type="button">
        ← 검색 결과로 돌아가기
      </button>

      <div className={styles.card}>
        <h2 className={styles.complexName}>{complex.name}</h2>
        <p className={styles.complexAddr}>{complex.addr}</p>
        <a
          className={styles.naverLink}
          href={`https://fin.land.naver.com/search?q=${encodeURIComponent(complex.name)}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          Npay 부동산에서 확인 ↗
        </a>

        {search.teamScenes.length > 0 && (
          <>
            <h3 className={styles.sectionTitle}>작업 중인 도면 이어서 열기</h3>
            <div className={styles.teamScenes}>
              {search.teamScenes.slice(0, 5).map((scene) => (
                <Link className={styles.teamSceneItem} href={`/scene/${scene.id}`} key={scene.id}>
                  <span className={styles.teamSceneName}>{scene.name}</span>
                  <span className={styles.teamSceneMeta}>
                    {formatSceneDate(scene.updatedAt)} · 이어서 모델링 →
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        <InteriorFacts complexName={complex.name} state={search.interiorState} />

        <h3 className={styles.sectionTitle}>
          평형별 도면{search.plansState.status === 'full' && ` (${plans.length})`}
        </h3>
        {search.plansState.status === 'loading' && <p className={styles.hint}>도면 불러오는 중…</p>}
        {search.plansState.status !== 'loading' && plans.length === 0 && (
          <p className={styles.hint}>이 단지의 도면을 찾지 못했습니다.</p>
        )}
        <div className={styles.plansGrid}>
          {plans.map((plan) => (
            <PlanCard complex={complex} key={plan.planId} onZoom={onZoom} plan={plan} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PlanCard({
  complex,
  plan,
  onZoom,
}: {
  complex: AptComplex
  plan: AptPlan
  onZoom: (viewer: ViewerState) => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const [flipX, setFlipX] = useState(false)
  const [flipY, setFlipY] = useState(false)
  const typeLabel = typeWithPyeong(plan.type)
  const orientation = { flipX, flipY }
  const traceParams = new URLSearchParams({
    apartmentId: complex.apartmentId,
    planId: plan.planId,
    name: complex.name,
    type: plan.type,
  })
  if (flipX) traceParams.set('flipX', '1')
  if (flipY) traceParams.set('flipY', '1')
  const traceHref = `/apt/trace?${traceParams.toString()}`

  return (
    <div className={styles.plan}>
      <div className={styles.planType}>{typeLabel}</div>
      {!imgFailed && (
        <button
          aria-label={`${plan.name || typeLabel} 크게 보기`}
          className={styles.planThumb}
          onClick={() =>
            onZoom({ pic: plan.planPic, name: plan.name, type: plan.type, orientation })
          }
          type="button"
        >
          <img
            alt={plan.name || ''}
            loading="lazy"
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
            src={plan.planPic}
            style={{ transform: aptImageTransform(orientation) }}
          />
          <span className={styles.planZoomLabel}>크게 보기</span>
        </button>
      )}
      <div aria-label="도면 방향" className={styles.orientationControls} role="group">
        <button
          aria-pressed={flipX}
          className={`${styles.orientationButton} ${flipX ? styles.orientationButtonActive : ''}`}
          onClick={() => setFlipX((active) => !active)}
          type="button"
        >
          좌우 반전
        </button>
        <button
          aria-pressed={flipY}
          className={`${styles.orientationButton} ${flipY ? styles.orientationButtonActive : ''}`}
          onClick={() => setFlipY((active) => !active)}
          type="button"
        >
          상하 반전
        </button>
      </div>
      <Link className={styles.planTraceLink} href={traceHref}>
        이 도면 위에 그리기 → ✏️
      </Link>
      <Link className={styles.planTraceLink} href={`${traceHref}&vector=1`}>
        자동 모델링으로 시작 → 🪄
      </Link>
    </div>
  )
}

function InteriorFacts({ state, complexName }: { state: AptInteriorState; complexName: string }) {
  if (state.status === 'loading') {
    return (
      <>
        <h3 className={styles.sectionTitle}>인테리어 준비 정보</h3>
        <p className={styles.hint}>준공·난방·단지 정보를 확인하는 중입니다…</p>
      </>
    )
  }
  if (state.status === 'empty') {
    return (
      <>
        <h3 className={styles.sectionTitle}>인테리어 준비 정보</h3>
        <p className={styles.hint}>
          공공 단지정보를 정확히 매칭하지 못했습니다.{' '}
          <a
            href={`https://fin.land.naver.com/search?q=${encodeURIComponent(complexName)}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            Npay 부동산에서 직접 확인 ↗
          </a>
        </p>
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
  const rows: [string, React.ReactNode][] = []
  if (approval) rows.push(['사용승인', approval])
  if (info.heating) rows.push(['난방', info.heating])
  if (info.corridor) rows.push(['현관·복도', info.corridor])
  if (scale) rows.push(['단지 규모', scale])
  if (info.builder) rows.push(['시공사', info.builder])
  if (info.managementPhone) {
    rows.push([
      '관리사무소',
      <a href={`tel:${info.managementPhone.replace(/[^0-9+]/g, '')}`} key="tel">
        {info.managementPhone}
      </a>,
    ])
  }
  if (rows.length === 0) return null

  return (
    <>
      <h3 className={styles.sectionTitle}>
        인테리어 준비 정보 (K-apt · {info.sourceName || '공개정보'})
      </h3>
      <div className={styles.factsGrid}>
        {rows.map(([label, value]) => (
          <div className={styles.factItem} key={label}>
            <span className={styles.factLabel}>{label}</span>
            <div className={styles.factValue}>{value}</div>
          </div>
        ))}
      </div>
      {info.scopeWarning && <p className={styles.factsScope}>{info.scopeWarning}</p>}
    </>
  )
}
