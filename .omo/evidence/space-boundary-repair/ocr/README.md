# Contained room OCR retry

The missing upper-left bedroom label is in API room `r6`. The API document is
in a 2x analysis frame (`imageSize=[2484,1656]`) over the source plan
(`1242x828`); dividing the `mmPerPx=10.992` polygon by that frame scale gives
the source polygon recorded in `upper-left-bedroom-2x.json`.

The retry crop uses the room polygon, a 16 px source margin, white masking for
all pixels outside the polygon, and 2x cubic upscaling:

- crop: `upper-left-bedroom-2x.png`
- raw Vision output: `upper-left-bedroom-2x.ocr.json`
- transformed proof: `upper-left-bedroom-2x.proof.json`

The existing Vision helper returned the actual text `안방` with confidence `1`.
Mapping its crop-space box back to source pixels gives
`x=373, y=362, w=30, h=16`, center `(388,370)`, and the proof checks that the
center is inside the source room polygon.

Re-run command:

```sh
./.omx/recovery-20260929/data/.build/ocr_vision \
  .omo/evidence/space-boundary-repair/ocr/upper-left-bedroom-2x.png
```

Minimal generic retry configuration: derive each candidate room's source
polygon and bounding box, mask outside that polygon, upscale 2x, run Vision,
then map each OCR box through `source = cropOrigin + box / 2`. Accept the OCR
text only when its mapped center is inside the candidate polygon; do not fill a
missing name from room class or any inferred constant.
