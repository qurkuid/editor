# p30 entrance source visual review

## Blind visual finding

The upper-center entrance shows one continuous exterior-wall interruption between two jambs. A shorter rectangular door-leaf/frame component occupies its left portion. I do not see an internal jamb, wall pier, or independently bounded second passage inside the full opening.

At 18.904 mm per source pixel, the raster supports a physical passage width of approximately 1.30 +/- 0.04 m and a leaf/frame component width of approximately 0.70 +/- 0.04 m. The source does not resolve separate leaf and frame widths inside that shorter component; o2 and o21 are two detections of it.

## Candidate geometry mapped to the 1242 x 828 source

| Record | Detector | Source endpoints | Physical segment | Visual interpretation |
| --- | --- | --- | ---: | --- |
| o2 | pair | (537.879, 227.312) to (574.146, 219.986) | 699.450 mm | Diagonal/lower edge detection of the left leaf/frame component |
| o21 | frame | (538.001, 223.059) to (574.500, 220.943) | 691.158 mm | Same left leaf/frame component |
| o28 | ray | (536.499, 228.502) to (604.562, 228.502) | 1286.700 mm | Full jamb-to-jamb wall interruption |

o2 and o21 differ by only 4.255 source px at the left endpoint and 1.021 px at the right. o28 shares the left edge within 1.502 px and extends 30.062 px farther right.

## Pixel support

- Full passage: source row 229 has a continuous light run x536..604, 69 px wide, with no pixel below brightness 180. Mean brightness is 212.2, versus 152.5 and 153.9 in the adjacent wall bands. o28 maps to x536.499..604.562 at y228.502.
- Leaf/frame: source row 220 has a bright run x539..573 with outer edges around x538..574. Its mean brightness is 255.0, versus 150.5 and 152.6 beside it. This matches o21/o2, but it is a component inside the full opening.

## Assessment

- Same physical opening: high confidence, 0.90-0.97.
- Independent visible support for the full 1286.7 mm passage: high confidence, 0.85-0.95.
- Visible support for the approximately 691 mm leaf/frame component: high confidence, 0.90-0.98.
- Probability that the 691 mm component is a separate physical opening: 0.03-0.20. No second jamb pair or wall pier is visible.

Treat o2/o21/o28 as detections of one physical entrance opening. Keep the leaf/frame measurement as source evidence attached to that opening; do not count it as another opening from semantic labels. For review use the exact source crop x510..635, y190..285, which includes both jambs, the full passage, and the complete leaf/frame rectangle.

## Evidence identity

- Source image SHA-256: `0925404bb8394d9d0e6e05f8dcc1893c482f26eb834b1886b94aad10d19fda38`
- Candidate15 SHA-256: `7d2423fe84e481f778130834a590c8feea132a0cd565da45265c5a526229b950`
- Unannotated focused crop: `entrance-opening-x510-635-y190-285.png`
- Annotated geometry overlay: `entrance-opening-candidate-overlay-x500-630-y185-290.png`
