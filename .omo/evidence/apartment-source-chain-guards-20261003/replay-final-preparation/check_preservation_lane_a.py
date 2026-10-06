#!/usr/bin/env python3
"""Evidence-only before/current-eba42adc authored-data preservation check."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / '.omo/evidence/apartment-next-residual-20261003'
PREPARATION = REPO / '.omo/evidence/apartment-source-chain-guards-20261003/replay-final-preparation'
BASELINE_IMPORTED = EVIDENCE / 'replay/candidate-imported-lane-a-final'
CANDIDATE_IMPORTED = PREPARATION / 'candidate-imported-<run-id>'
BASELINE_EVAL = EVIDENCE / 'replay/candidate-evaluation-lane-a-final'
CANDIDATE_EVAL = PREPARATION / 'candidate-evaluation-<run-id>'
PAIRED = EVIDENCE / 'replay/paired-lane-a-final-metrics.json'
MACHINE = EVIDENCE / 'replay/candidate-machine-lane-a-final.json'
MANIFEST = PREPARATION / 'preparation-manifest-lane-b-final-baseline-measured.json'
OUT = PREPARATION / 'preservation-lane-b-candidate.json'
CORE_SHA = 'eba42adce60d84cfe2943cd5bcdc5132754453df6a1925576bfe06f93f79c570'


def load(path: Path):
    return json.loads(path.read_text())


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def jcanon(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def wall_key(wall):
    # IDs, level parent IDs, children, and derived front/back side labels are
    # runtime generated. All authored dimensions, construction, metadata, and
    # centerline geometry remain part of the comparison.
    ignored = {'id', 'parentId', 'children', 'frontSide', 'backSide'}
    return {k: wall.get(k) for k in sorted(wall) if k not in ignored}


def wall_sort_key(wall):
    return jcanon(wall_key(wall))


def opening_key(opening, wall_index):
    ignored = {'id', 'parentId', 'wallId', 'children'}
    value = {k: opening.get(k) for k in sorted(opening) if k not in ignored}
    host = opening.get('wallId')
    value['hostWallIndex'] = wall_index.get(host)
    return value


def opening_sort_key(opening, wall_index):
    return jcanon(opening_key(opening, wall_index))


def source_zone_key(zone):
    metadata = zone.get('metadata') or {}
    source_room_id = metadata.get('sourceRoomId')
    if source_room_id is None:
        return None
    fields = ('source', 'sourceRoomId', 'cls', 'areaM2', 'name', 'color', 'documentId', 'sourceZoneId')
    return {field: metadata.get(field) for field in fields}


def zone_sort_key(zone):
    return jcanon(zone)


def imported_preservation(before, after):
    before_walls = list(before.get('walls') or [])
    after_walls = list(after.get('walls') or [])
    before_wall_ids = {id(w): idx for idx, w in enumerate(sorted(before_walls, key=wall_sort_key))}
    after_wall_ids = {id(w): idx for idx, w in enumerate(sorted(after_walls, key=wall_sort_key))}
    # Mapping by canonical authored wall geometry makes the host relation
    # independent of generated wall IDs while still checking the relation.
    before_sorted_walls = sorted(before_walls, key=wall_sort_key)
    after_sorted_walls = sorted(after_walls, key=wall_sort_key)
    before_id_to_index = {w.get('id'): idx for idx, w in enumerate(before_sorted_walls)}
    after_id_to_index = {w.get('id'): idx for idx, w in enumerate(after_sorted_walls)}
    authored_walls_equal = jcanon([wall_key(w) for w in before_sorted_walls]) == jcanon([wall_key(w) for w in after_sorted_walls])
    before_openings = sorted(before.get('openings') or [], key=lambda x: opening_sort_key(x, before_id_to_index))
    after_openings = sorted(after.get('openings') or [], key=lambda x: opening_sort_key(x, after_id_to_index))
    openings_equal = jcanon([opening_key(x, before_id_to_index) for x in before_openings]) == jcanon([opening_key(x, after_id_to_index) for x in after_openings])
    before_zones = sorted((z for z in (before.get('zones') or []) if source_zone_key(z) is not None), key=lambda z: zone_sort_key(source_zone_key(z)))
    after_zones = sorted((z for z in (after.get('zones') or []) if source_zone_key(z) is not None), key=lambda z: zone_sort_key(source_zone_key(z)))
    before_zone_values = [source_zone_key(z) for z in before_zones]
    after_zone_values = [source_zone_key(z) for z in after_zones]
    source_zone_equal = jcanon(before_zone_values) == jcanon(after_zone_values)
    return {
        'authoredWallsEqual': authored_walls_equal,
        'openingsEqual': openings_equal,
        'originalSourceZoneMetadataEqual': source_zone_equal,
        'sourceZoneCountBefore': len(before_zone_values),
        'sourceZoneCountAfter': len(after_zone_values),
        'wallCountBefore': len(before_walls),
        'wallCountAfter': len(after_walls),
        'openingCountBefore': len(before_openings),
        'openingCountAfter': len(after_openings),
        'generatedZoneCountBefore': sum(1 for z in (before.get('zones') or []) if (z.get('metadata') or {}).get('generatedFrom') is not None),
        'generatedZoneCountAfter': sum(1 for z in (after.get('zones') or []) if (z.get('metadata') or {}).get('generatedFrom') is not None),
    }


def main():
    global CANDIDATE_IMPORTED, CANDIDATE_EVAL, OUT
    # Candidate paths must be explicit after the parent supplies a source
    # freeze; the placeholder prevents an accidental read of an older replay.
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate-imported-root', type=Path, required=True)
    parser.add_argument('--candidate-evaluation-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    CANDIDATE_IMPORTED = args.candidate_imported_root.resolve()
    CANDIDATE_EVAL = args.candidate_evaluation_root.resolve()
    OUT = args.output.resolve()
    if PREPARATION.resolve() not in CANDIDATE_IMPORTED.parents or PREPARATION.resolve() not in CANDIDATE_EVAL.parents or PREPARATION.resolve() not in OUT.parents:
        raise SystemExit('candidate preservation paths must remain under replay-final-preparation/')
    paired = load(PAIRED)
    machine = load(MACHINE)
    manifest_wrapper = load(MANIFEST)
    manifest = load(REPO / manifest_wrapper['baseline']['planManifest']['path'])
    before_rows = {x['key']: x for x in paired['baseline']['cases']}
    candidate_rows = {x['key']: x for x in paired['candidate']['cases']}
    per_plan = []
    source_document_equal_count = 0
    imported_count = 0
    floor_losses = []
    floor_gains = []
    missing = []
    for item in manifest['plans']:
        pid, key = item['planId'], item['key']
        before_imported_path = BASELINE_IMPORTED / f'{pid}.json'
        candidate_imported_path = CANDIDATE_IMPORTED / f'{pid}.json'
        before_eval_path = BASELINE_EVAL / f'{pid}.json'
        candidate_eval_path = CANDIDATE_EVAL / f'{pid}.json'
        before_imported = load(before_imported_path) if before_imported_path.is_file() else None
        candidate_imported = load(candidate_imported_path) if candidate_imported_path.is_file() else None
        before_eval = load(before_eval_path) if before_eval_path.is_file() else {}
        candidate_eval = load(candidate_eval_path) if candidate_eval_path.is_file() else {}
        source_document_equal_count += int(before_eval.get('sourceDocument') == candidate_eval.get('sourceDocument'))
        if before_imported is None or candidate_imported is None:
            missing.append(pid)
            continue
        imported_count += 1
        row = imported_preservation(before_imported, candidate_imported)
        row.update({'planId': pid, 'key': key, 'status': 'IMPORTED', 'sourceDocumentEqual': before_eval.get('sourceDocument') == candidate_eval.get('sourceDocument')})
        per_plan.append(row)
        b = before_rows.get(key, {}).get('floor', {}).get('roomInteriorSeeds', {})
        c = candidate_rows.get(key, {}).get('floor', {}).get('roomInteriorSeeds', {})
        bi, ci = int(b.get('insideSlab') or 0), int(c.get('insideSlab') or 0)
        if ci < bi: floor_losses.append({'key': key, 'planId': pid, 'before': bi, 'after': ci})
        if ci > bi: floor_gains.append({'key': key, 'planId': pid, 'before': bi, 'after': ci})
    imported_rows = [x for x in per_plan if x.get('status') == 'IMPORTED']
    result = {
        'schemaVersion': 'apartment-source-chain-guards-lane-b-authored-preservation-v1',
        'status': 'READ_ONLY_CHECK',
        'resolvedModel': 'gpt-5.6-luna',
        'reasoningEffort': 'max',
        'scope': 'Evidence-only comparison; no product/source/runtime mutation.',
        'runId': 'lane-a-final',
        'sourceCoreSha256': CORE_SHA,
        'comparison': {'before': 'eba42adc candidate imported/evaluation + same V15 vector docs', 'candidate': 'lane-a-final replay from frozen source', 'sameRawPlans': 50, 'sameImportedDenominator': imported_count},
        'importedCases': imported_count,
        'missingImportedFiles': missing,
        'rejectedPlanIds': [item['planId'] for item in manifest['plans'] if not (BASELINE_IMPORTED / f"{item['planId']}.json").is_file() or not (CANDIDATE_IMPORTED / f"{item['planId']}.json").is_file()],
        'floorProbeLosses': floor_losses,
        'floorProbeGains': floor_gains,
        'authoredWallsPreserved': imported_count == 44 and all(x.get('authoredWallsEqual') for x in imported_rows),
        'openingsPreserved': imported_count == 44 and all(x.get('openingsEqual') for x in imported_rows),
        'originalSourceZoneMetadataPreserved': imported_count == 44 and all(x.get('originalSourceZoneMetadataEqual') for x in imported_rows),
        'sourceDocumentEqualCount': source_document_equal_count,
        'sourceDocumentEqualDenominator': 50,
        'candidateMachineIdempotenceFailures': len(machine.get('idempotenceFailures', [])),
        'perPlan': per_plan,
        'inputs': {
            'pairedMetrics': str(PAIRED.relative_to(REPO)), 'pairedMetricsSha256': sha(PAIRED),
            'machineMetrics': str(MACHINE.relative_to(REPO)), 'machineMetricsSha256': sha(MACHINE),
            'beforeImportedRoot': str(BASELINE_IMPORTED.relative_to(REPO)),
            'candidateImportedRoot': str(CANDIDATE_IMPORTED.relative_to(REPO)),
            'beforeEvaluationRoot': str(BASELINE_EVAL.relative_to(REPO)),
            'candidateEvaluationRoot': str(CANDIDATE_EVAL.relative_to(REPO)),
        },
        'note': 'Normalizes runtime IDs and level parent IDs. Excludes derived wall frontSide/backSide classification. Opening wallId is normalized to the canonical authored wall index. Original source Zones are selected by non-null sourceRoomId, excluding generated detected-space Zones. Raster shared-edge pixels remain separate from exact polygon audit.',
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(OUT), 'sha256': sha(OUT), 'importedCases': imported_count, 'floorProbeLosses': len(floor_losses), 'floorProbeGains': len(floor_gains), 'walls': result['authoredWallsPreserved'], 'openings': result['openingsPreserved'], 'zones': result['originalSourceZoneMetadataPreserved'], 'sourceDocumentEqual': source_document_equal_count, 'idempotenceFailures': result['candidateMachineIdempotenceFailures']}))

if __name__ == '__main__':
    main()
