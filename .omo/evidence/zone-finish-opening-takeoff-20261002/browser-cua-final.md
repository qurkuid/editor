# Isolated CUA browser verification

- Profile: gpt-5.6-luna / max
- Runtime: `http://localhost:3312` (isolated production start; stopped after QA)
- Scene: disposable local scene `bec73d11823e`; no customer or production scene touched
- Surface: visible CUA Chrome tab, 2D editor
- Completed: created a synthetic bent wall chain and opened the visible `통계` surface
- Visible Stats result: wall `concrete` 46.25 m², `벽면 (양면)` 92.50 m², `벽 길이` 18.50 m
- Bounded opening attempt: door tool selected the synthetic host wall and showed the door preview, but repeated placement/keyboard commit actions did not persist an opening before the bounded stop. No opening-specific Stats row, undo/redo, or save/reload claim is made from this run.
- Server teardown: port 3312 refused connections after the owned process was stopped.
