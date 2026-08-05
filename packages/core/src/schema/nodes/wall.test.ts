import { describe, expect, test } from 'bun:test'
import { getCatalogMaterialById, getLibraryMaterialIdFromRef } from '../../material-library'
import {
  buildEnabledWallFaceBandPatch,
  buildWallBandKindPatch,
  buildWallFaceBandCountPatch,
  getWallFaceBandConfig,
  getWallKind,
  isGlassWall,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CHAIR_RAIL_SLOT_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_CROWN_SLOT_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_FACE_BAND_SOLID_SLOT_DEFAULTS,
  WALL_GLASS_SLOT_REF,
  WALL_KIND_SLOT_REFS,
  WALL_SKIRTING_DEFAULT,
  WALL_SKIRTING_SLOT_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  WallFaceBandConfig,
  WallNode,
  type WallNode as WallNodeType,
  WallTrimConfig,
} from './wall'

describe('wall support offset', () => {
  test('stores a finite offset without defaulting it onto ordinary walls', () => {
    expect(WallNode.parse({ start: [0, 0], end: [4, 0] }).supportOffset).toBeUndefined()
    expect(WallNode.parse({ start: [0, 0], end: [4, 0], supportOffset: 1.75 }).supportOffset).toBe(
      1.75,
    )
    expect(
      WallNode.safeParse({ start: [0, 0], end: [4, 0], supportOffset: Number.NaN }).success,
    ).toBe(false)
  })

  test('stores terrain infill only when explicitly enabled', () => {
    expect(WallNode.parse({ start: [0, 0], end: [4, 0] }).fillToTerrain).toBeUndefined()
    expect(WallNode.parse({ start: [0, 0], end: [4, 0], fillToTerrain: true }).fillToTerrain).toBe(
      true,
    )
  })
})

describe('wall face bands', () => {
  test('defaults to one band while preserving legacy enabled scenes as three bands', () => {
    expect(WALL_FACE_BAND_DEFAULT.count).toBe(1)
    expect(WALL_FACE_BAND_DEFAULT.lowerHeight).toBe(0.84)
    expect(WALL_FACE_BAND_DEFAULT.middleHeight).toBe(0.61)
    expect(WALL_FACE_BAND_DEFAULT.upperHeight).toBe(0.61)

    expect(WallFaceBandConfig.parse({})).toEqual({
      enabled: false,
      count: 1,
      lowerHeight: 0.84,
      middleHeight: 0.61,
      upperHeight: 0.61,
    })

    expect(WallFaceBandConfig.parse({ enabled: true })).toEqual({
      enabled: true,
      count: 3,
      lowerHeight: 0.84,
      middleHeight: 0.61,
      upperHeight: 0.61,
    })

    expect(
      getWallFaceBandConfig(
        {
          height: 2.5,
          faceBands: {
            enabled: true,
            count: 3,
            lowerHeight: 0.84,
            middleHeight: 0.61,
            upperHeight: 0.61,
          },
        },
        2.5,
      ),
    ).toMatchObject({
      count: 3,
      lowerTop: 0.84,
      middleTop: 1.45,
    })
  })

  test('four bands adds an upper split below the final top band', () => {
    expect(
      getWallFaceBandConfig(
        {
          height: 2.5,
          faceBands: {
            enabled: true,
            count: 4,
            lowerHeight: 0.5,
            middleHeight: 0.6,
            upperHeight: 0.7,
          },
        },
        2.5,
      ),
    ).toMatchObject({
      count: 4,
      lowerTop: 0.5,
      middleTop: 1.1,
      upperTop: 1.8,
    })
  })

  test('enabling bands seeds visible solid-color band slots', () => {
    const patch = buildEnabledWallFaceBandPatch({
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.2,
        middleHeight: 0.3,
        upperHeight: 0.61,
      },
      slots: {
        interior: 'library:interior-finish',
        exterior: 'scene:exterior-finish',
        lowerInterior: 'library:stale-lower',
        middleExterior: 'library:stale-middle',
      },
    } as Pick<WallNodeType, 'faceBands' | 'slots'>)

    expect(patch.faceBands).toEqual({
      enabled: true,
      count: 2,
      lowerHeight: 0.2,
      middleHeight: 0.3,
      upperHeight: 0.61,
    })
    expect(patch.slots).toMatchObject({
      interior: 'library:interior-finish',
      exterior: 'scene:exterior-finish',
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperInterior: 'library:interior-finish',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperExterior: 'scene:exterior-finish',
    })
    expect(patch.slots?.middleInterior).toBeUndefined()
    expect(patch.slots?.middleExterior).toBeUndefined()
  })

  test('band count patch enables only the active slots', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 4,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          interior: 'library:interior-finish',
          exterior: 'scene:exterior-finish',
          topInterior: 'library:stale-top',
        },
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
      3,
    )

    expect(patch.faceBands).toMatchObject({ enabled: true, count: 3 })
    expect(patch.slots).toMatchObject({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: 'library:stale-top',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: 'scene:exterior-finish',
    })
    expect(patch.slots?.topInterior).toBeUndefined()
    expect(patch.slots?.topExterior).toBeUndefined()
  })

  test('enabling bands replaces stale inactive band slots with solid-color defaults', () => {
    const patch = buildEnabledWallFaceBandPatch({
      slots: {
        lowerInterior: 'library:stale-lower',
        middleInterior: 'library:stale-middle',
        upperExterior: 'library:stale-upper',
      },
    } as Pick<WallNodeType, 'faceBands' | 'slots'>)

    expect(patch.slots).toEqual({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperInterior: WALL_SURFACE_SLOT_DEFAULTS.interior,
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperExterior: WALL_SURFACE_SLOT_DEFAULTS.exterior,
    })
    expect(patch.slots?.middleInterior).toBeUndefined()
    expect(patch.slots?.middleExterior).toBeUndefined()
  })

  test('increasing band count paints newly active bands with the solid palette', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 2,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
          lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
        },
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
      3,
    )

    expect(patch.slots).toMatchObject({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
    })
  })

  test('increasing to four bands keeps the previous top material on the new top band', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 3,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
          upperInterior: 'scene:painted-top-interior',
          lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
          upperExterior: 'library:painted-top-exterior',
        },
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
      4,
    )

    expect(patch.slots).toMatchObject({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      topInterior: 'scene:painted-top-interior',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      topExterior: 'library:painted-top-exterior',
    })
  })
})

describe('wall kinds', () => {
  test('detects a kind only when both faces reference that kind finish', () => {
    expect(getWallKind({ slots: undefined })).toBe('solid')
    expect(getWallKind({ slots: { interior: WALL_GLASS_SLOT_REF } })).toBe('solid')
    expect(
      getWallKind({ slots: { interior: WALL_GLASS_SLOT_REF, exterior: WALL_GLASS_SLOT_REF } }),
    ).toBe('glass')
    expect(
      getWallKind({
        slots: {
          interior: WALL_KIND_SLOT_REFS.masonry,
          exterior: WALL_KIND_SLOT_REFS.masonry,
        },
      }),
    ).toBe('masonry')
    expect(
      getWallKind({
        slots: {
          interior: WALL_KIND_SLOT_REFS['glass-block'],
          exterior: WALL_KIND_SLOT_REFS['glass-block'],
        },
      }),
    ).toBe('glass-block')
    expect(
      isGlassWall({ slots: { interior: WALL_GLASS_SLOT_REF, exterior: WALL_GLASS_SLOT_REF } }),
    ).toBe(true)
  })

  test('every wall kind ref resolves to a wall-paintable catalog entry', () => {
    for (const ref of Object.values(WALL_KIND_SLOT_REFS)) {
      const item = getCatalogMaterialById(getLibraryMaterialIdFromRef(ref) ?? undefined)
      expect(item).toBeDefined()
      expect(item?.surfaces === undefined || item.surfaces.includes('wall')).toBe(true)
    }
  })

  test('derives the kind from the band composition, bottom band first', () => {
    expect(
      getWallKind({
        slots: {
          lowerInterior: WALL_KIND_SLOT_REFS['glass-block'],
          lowerExterior: WALL_KIND_SLOT_REFS['glass-block'],
          upperInterior: 'library:band-upper',
          upperExterior: 'library:band-upper',
        },
      }),
    ).toBe('glass-block')
    // One-sided band paint is decor, not the wall's build.
    expect(
      getWallKind({
        slots: {
          lowerInterior: WALL_KIND_SLOT_REFS.masonry,
          lowerExterior: 'library:band-lower',
        },
      }),
    ).toBe('solid')
    // Bands shadow the faces, so the band composition wins the derivation.
    expect(
      getWallKind({
        slots: {
          interior: WALL_GLASS_SLOT_REF,
          exterior: WALL_GLASS_SLOT_REF,
          lowerInterior: WALL_KIND_SLOT_REFS.masonry,
          lowerExterior: WALL_KIND_SLOT_REFS.masonry,
        },
      }),
    ).toBe('masonry')
  })

  test('painting a kind material over the composition changes the derived kind', () => {
    const banded = {
      slots: {
        lowerInterior: 'library:band-lower',
        lowerExterior: 'library:band-lower',
        upperInterior: 'library:band-upper',
        upperExterior: 'library:band-upper',
      },
    }
    expect(getWallKind(banded)).toBe('solid')

    const glassBlockLower = {
      slots: {
        ...banded.slots,
        lowerInterior: WALL_KIND_SLOT_REFS['glass-block'],
        lowerExterior: WALL_KIND_SLOT_REFS['glass-block'],
      },
    }
    expect(getWallKind(glassBlockLower)).toBe('glass-block')
  })

  test('selecting a band kind writes both sides of that band and derives the wall kind', () => {
    const wall = {
      faceBands: { ...WALL_FACE_BAND_DEFAULT, enabled: true, count: 2 },
      slots: {
        lowerInterior: 'library:band-lower',
        lowerExterior: 'library:band-lower',
        upperInterior: 'library:band-upper',
        upperExterior: 'library:band-upper',
      },
    }

    const patch = buildWallBandKindPatch(wall, 'lower', 'glass-block')
    expect(patch.slots).toEqual({
      lowerInterior: WALL_KIND_SLOT_REFS['glass-block'],
      lowerExterior: WALL_KIND_SLOT_REFS['glass-block'],
      upperInterior: 'library:band-upper',
      upperExterior: 'library:band-upper',
    })
    expect(getWallKind(patch)).toBe('glass-block')
  })

  test('selecting a band kind on a single-band wall targets the whole faces', () => {
    const wall = { faceBands: undefined, slots: { interior: 'library:interior-finish' } }

    const patch = buildWallBandKindPatch(wall, 'upper', 'glass')
    expect(patch.slots).toEqual({
      interior: WALL_GLASS_SLOT_REF,
      exterior: WALL_GLASS_SLOT_REF,
    })
    expect(getWallKind(patch)).toBe('glass')
  })

  test('derives the kind from the band construction before painted slots', () => {
    // 기본 벽 (석고보드 + 각재) — 일반벽.
    expect(
      getWallKind({
        faceBands: {
          ...WALL_FACE_BAND_DEFAULT,
          construction: {
            upper: {
              mode: 'assembly',
              layers: [
                { kind: 'timber-stud', thickness: 0.033, wasteFactor: 0.1 },
                { kind: 'gypsum-board', thickness: 0.0095, wasteFactor: 0.1 },
              ],
            },
          },
        },
        slots: undefined,
      }),
    ).toBe('solid')

    // 유리로 시공한 벽 — 유리벽.
    expect(
      getWallKind({
        faceBands: {
          ...WALL_FACE_BAND_DEFAULT,
          construction: {
            upper: { mode: 'assembly', layers: [{ kind: 'glass', thickness: 0.012, wasteFactor: 0.05 }] },
          },
        },
        slots: undefined,
      }),
    ).toBe('glass')

    // 밴드 벽: 하단 밴드가 조적이면 조적벽. 비활성 밴드의 잔존 구성은 무시.
    expect(
      getWallKind({
        faceBands: {
          ...WALL_FACE_BAND_DEFAULT,
          enabled: true,
          count: 2,
          construction: {
            lower: {
              mode: 'assembly',
              layers: [{ kind: 'masonry', thickness: 0.09, wasteFactor: 0.05 }],
            },
            middle: {
              mode: 'assembly',
              layers: [{ kind: 'glass', thickness: 0.012, wasteFactor: 0.05 }],
            },
          },
        },
        slots: undefined,
      }),
    ).toBe('masonry')
  })

  test('returning a band to solid restores the band palette without touching custom paint', () => {
    const banded = { ...WALL_FACE_BAND_DEFAULT, enabled: true, count: 2 }

    const unwound = buildWallBandKindPatch(
      {
        faceBands: banded,
        slots: {
          lowerInterior: WALL_KIND_SLOT_REFS.masonry,
          lowerExterior: WALL_KIND_SLOT_REFS.masonry,
        },
      },
      'lower',
      'solid',
    )
    expect(unwound.slots).toEqual({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
    })

    const untouched = buildWallBandKindPatch(
      { faceBands: banded, slots: { lowerInterior: 'library:custom-paint' } },
      'lower',
      'solid',
    )
    expect(untouched.slots).toEqual({ lowerInterior: 'library:custom-paint' })
  })
})

describe('wall trim profiles', () => {
  test('uses curated defaults while preserving legacy profile values', () => {
    expect(WALL_SKIRTING_DEFAULT.profile).toBe('flat')
    expect(WALL_CROWN_DEFAULT.profile).toBe('flat')
    expect(WALL_CHAIR_RAIL_DEFAULT.profile).toBe('flat')

    expect(WallTrimConfig.parse({ profile: 'flat' }).profile).toBe('flat')
    expect(WallTrimConfig.parse({ profile: 'crown-layered' }).profile).toBe('crown-layered')
    expect(WallTrimConfig.parse({ profile: 'triangle' }).profile).toBe('triangle')
  })

  test('declares separate default materials for each trim family', () => {
    expect(WALL_SKIRTING_SLOT_DEFAULT).toBe('library:preset-softwhite')
    expect(WALL_CROWN_SLOT_DEFAULT).toBe('library:preset-white')
    expect(WALL_CHAIR_RAIL_SLOT_DEFAULT).toBe('library:preset-cream')

    expect(WALL_SURFACE_SLOT_DEFAULTS.skirtingInterior).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.skirtingExterior).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.crownInterior).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.crownExterior).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.chairRailInterior).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.chairRailExterior).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
  })
})
