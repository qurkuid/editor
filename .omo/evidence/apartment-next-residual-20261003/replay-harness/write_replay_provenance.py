#!/usr/bin/env python3
"""Freeze hashes for one guarded replay run under the new evidence root."""
from __future__ import annotations
import argparse, hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / '.omo/evidence/apartment-next-residual-20261003'
NEW_ROOT = EVIDENCE / 'replay'

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()

def file_record(path: Path) -> dict[str, Any]:
    return {'path':rel(path),'sha256':sha256(path),'bytes':path.stat().st_size}

def tree_record(path: Path) -> dict[str, Any]:
    files=sorted(p for p in path.iterdir() if p.is_file())
    return {'path':rel(path),'fileCount':len(files),'treeSha256':hashlib.sha256(''.join(f'{rel(p)}\t{sha256(p)}\n' for p in files).encode()).hexdigest(),'filesSha256':{p.name:sha256(p) for p in files}}

def recursive_tree_record(path: Path, manifest: Path | None = None) -> dict[str, Any]:
    """Record every nested render artifact, including the 50 paired folders."""
    files=sorted(p for p in path.rglob('*') if p.is_file())
    record={'path':rel(path),'fileCount':len(files),'treeSha256':hashlib.sha256(''.join(f'{rel(p)}\t{sha256(p)}\n' for p in files).encode()).hexdigest()}
    if manifest is not None and manifest.is_file():
        record['recursiveManifest']=file_record(manifest)
    return record

def write_recursive_manifest(path: Path, manifest: Path) -> None:
    """Bind every nested paired render file without changing the render tree."""
    files = sorted(p for p in path.rglob('*') if p.is_file())
    payload = {
        'schemaVersion': 'paired-render-recursive-manifest-v1',
        'root': rel(path),
        'fileCount': len(files),
        'files': [file_record(p) for p in files],
    }
    manifest.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')

def read(path: Path): return json.loads(path.read_text())

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--run-id',required=True)
    ap.add_argument('--manifest',type=Path,default=NEW_ROOT/'replay-manifest.json')
    ap.add_argument('--source-freeze',type=Path,required=True)
    ap.add_argument('--guard',type=Path,required=True)
    ap.add_argument('--candidate-machine',type=Path,required=True)
    ap.add_argument('--paired-metrics',type=Path,required=True)
    ap.add_argument('--candidate-evaluation-root',type=Path,required=True)
    ap.add_argument('--candidate-imported-root',type=Path,required=True)
    ap.add_argument('--before-render-root',type=Path,required=True)
    ap.add_argument('--candidate-render-root',type=Path,required=True)
    ap.add_argument('--paired-render-root',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True)
    ap.add_argument('--timing-after',type=Path)
    ap.add_argument('--timing-baseline-repeat',type=Path)
    ap.add_argument('--exact-audit',type=Path)
    ap.add_argument('--preservation-check',type=Path)
    ap.add_argument('--normalized-comparison',type=Path)
    ap.add_argument('--source-gate',type=Path)
    ap.add_argument('--ui-status',type=Path)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    output=args.output.resolve()
    if NEW_ROOT.resolve() not in output.parents: raise SystemExit(f'output outside replay root: {output}')
    paths=[args.manifest,args.source_freeze,args.guard,args.candidate_machine,args.paired_metrics,args.report]
    for p in paths:
        if not p.resolve().is_file(): raise SystemExit(f'missing provenance input: {p}')
    for p in [args.candidate_evaluation_root,args.candidate_imported_root,args.before_render_root,args.candidate_render_root,args.paired_render_root]:
        if not p.resolve().is_dir(): raise SystemExit(f'missing provenance output directory: {p}')
    guard=read(args.guard.resolve())
    if guard.get('verified') is not True or guard.get('candidateExecutionAllowed') is not True: raise SystemExit('candidate guard is not verified')
    machine=read(args.candidate_machine.resolve())
    paired=read(args.paired_metrics.resolve())
    manifest=read(args.manifest.resolve())
    timing=None
    timing_comparison=None
    if args.timing_after:
        if not args.timing_after.resolve().is_file(): raise SystemExit(f'missing after timing: {args.timing_after}')
        timing=file_record(args.timing_after.resolve())
        timing_data=read(args.timing_after.resolve())
        baseline_timing=manifest.get('baseline',{}).get('beforeTiming',{})
        after_p95=timing_data.get('aggregate',{}).get('realDetectorP95Ms')
        frozen_before_p95=baseline_timing.get('realP95Ms')
        gate_p95=baseline_timing.get('candidateP95GateMs')
        timing_comparison={
          'status':'MEASURED' if isinstance(after_p95,(int,float)) and isinstance(frozen_before_p95,(int,float)) else 'UNAVAILABLE',
          'metric':'realDetectorP95Ms',
          'afterRealDetectorP95Ms':after_p95,
          'frozenBeforeRealDetectorP95Ms':frozen_before_p95,
          'ratioVsFrozenBefore':after_p95/frozen_before_p95 if isinstance(after_p95,(int,float)) and isinstance(frozen_before_p95,(int,float)) and frozen_before_p95 else None,
          'candidateP95GateMs':gate_p95,
          'gateStatus':'PASS' if isinstance(after_p95,(int,float)) and isinstance(gate_p95,(int,float)) and after_p95 <= gate_p95 else ('FAIL' if isinstance(after_p95,(int,float)) and isinstance(gate_p95,(int,float)) else 'UNAVAILABLE'),
          'frozenBeforeArtifact':manifest.get('baseline',{}).get('beforeTimingBenchmark'),
          'timeoutInterruptions':timing_data.get('protocol',{}).get('timeoutInterruptions'),
        }
        if timing_comparison['status'] == 'MEASURED':
            timing_comparison['ratioStatus'] = 'MEASURED'
    timing_baseline_repeat = None
    if args.timing_baseline_repeat:
        if not args.timing_baseline_repeat.resolve().is_file(): raise SystemExit(f'missing baseline repeat timing: {args.timing_baseline_repeat}')
        timing_baseline_repeat=file_record(args.timing_baseline_repeat.resolve())
        repeat_data=read(args.timing_baseline_repeat.resolve())
        repeat_p95=repeat_data.get('aggregate',{}).get('realDetectorP95Ms')
        if timing_comparison is not None:
            timing_comparison['sameProtocolBeforeRepeatRealDetectorP95Ms']=repeat_p95
            timing_comparison['ratioVsSameProtocolBeforeRepeat']=(timing_comparison.get('afterRealDetectorP95Ms')/repeat_p95 if isinstance(timing_comparison.get('afterRealDetectorP95Ms'),(int,float)) and isinstance(repeat_p95,(int,float)) and repeat_p95 else None)
            timing_comparison['sameProtocolBeforeRepeatArtifact']=rel(args.timing_baseline_repeat.resolve())
    exact_audit = None
    if args.exact_audit:
        if not args.exact_audit.resolve().is_file(): raise SystemExit(f'missing exact audit: {args.exact_audit}')
        exact_audit=file_record(args.exact_audit.resolve())
    preservation_check = None
    if args.preservation_check:
        if not args.preservation_check.resolve().is_file(): raise SystemExit(f'missing preservation check: {args.preservation_check}')
        preservation_check=file_record(args.preservation_check.resolve())
    normalized_comparison = None
    if args.normalized_comparison:
        if not args.normalized_comparison.resolve().is_file(): raise SystemExit(f'missing normalized comparison: {args.normalized_comparison}')
        normalized_comparison=file_record(args.normalized_comparison.resolve())
    source_gate = None
    if args.source_gate:
        if not args.source_gate.resolve().is_file(): raise SystemExit(f'missing source gate: {args.source_gate}')
        source_gate=file_record(args.source_gate.resolve())
    ui_status = None
    if args.ui_status:
        if not args.ui_status.resolve().is_file(): raise SystemExit(f'missing UI status: {args.ui_status}')
        ui_status=file_record(args.ui_status.resolve())
    output.parent.mkdir(parents=True,exist_ok=True)
    payload={
      'schemaVersion':'apartment-residual-closure-replay-provenance-v1',
      'recordedAt':datetime.now(timezone.utc).isoformat(),
      'resolvedRoute':{'model':'gpt-5.6-luna','reasoningEffort':'max'},
      'runId':args.run_id,'candidateRunExecuted':True,'candidateExecutionGuard':file_record(args.guard.resolve()),
      'sourceFreeze':file_record(args.source_freeze.resolve()),
      'replayManifest':file_record(args.manifest.resolve()),
      'baseline':{
        'identity':'eba42adc candidate imported/evaluation; not old v15-floor baseline',
        'importedRoot':manifest.get('baseline',{}).get('importedRootEba42adc'),
        'evaluationRoot':manifest.get('baseline',{}).get('evaluationRootEba42adc'),
        'machineMetrics':manifest.get('baseline',{}).get('metricsEba42adc'),
        'renderRoot':tree_record(args.before_render_root.resolve()),
      },
      'candidate':{
        'machineMetrics':file_record(args.candidate_machine.resolve()),
        'evaluationRoot':tree_record(args.candidate_evaluation_root.resolve()),
        'importedRoot':tree_record(args.candidate_imported_root.resolve()),
        'renderRoot':tree_record(args.candidate_render_root.resolve()),
      },
      'paired':{'metrics':file_record(args.paired_metrics.resolve()),'renderRoot':tree_record(args.paired_render_root.resolve()),'report':file_record(args.report.resolve())},
      'afterTiming':timing,
      'timingComparison':timing_comparison,
      'beforeTimingRepeat':timing_baseline_repeat,
      'exactPolygonAudit':exact_audit,
      'authoredPreservationCheck':preservation_check,
      'normalizedGeometryMetadataComparison':normalized_comparison,
      'parentSourceGate':source_gate,
      'uiStatusBoundary':ui_status,
      'counts':{'plans':machine.get('total'),'imported':machine.get('imported'),'rejected':machine.get('rejected'),'errors':machine.get('errors'),'probeSha256':paired.get('sourceProbeManifestSha256')},
      'timingGate':manifest.get('baseline',{}).get('beforeTiming',{}),
      'noRasterRerun':True,'writesRestrictedTo':rel(NEW_ROOT),
    }
    paired_recursive_manifest = NEW_ROOT / f'paired-render-recursive-manifest-{args.run_id}.json'
    write_recursive_manifest(args.paired_render_root.resolve(), paired_recursive_manifest)
    recursive_render = recursive_tree_record(args.paired_render_root.resolve(), paired_recursive_manifest)
    payload['paired']['renderRoot']['recursiveFileCount'] = recursive_render['fileCount']
    payload['paired']['renderRoot']['recursiveTreeSha256'] = recursive_render['treeSha256']
    if paired_recursive_manifest.is_file():
        payload['paired']['renderRoot']['recursiveManifest'] = file_record(paired_recursive_manifest)
    if payload.get('timingComparison') and payload['timingComparison'].get('status') == 'MEASURED':
        payload['timingGate']['ratioStatus'] = 'MEASURED'
        payload['timingGate']['gateStatus'] = payload['timingComparison'].get('gateStatus')
    output.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':rel(output),'runId':args.run_id,'candidateCounts':payload['counts'],'candidateMachineSha256':payload['candidate']['machineMetrics']['sha256'],'pairedMetricsSha256':payload['paired']['metrics']['sha256']},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
