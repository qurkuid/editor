#!/usr/bin/env python3
from pathlib import Path

from PIL import Image


repo = Path(__file__).resolve().parents[4]
source = repo / ".omo/evidence/apartment-next-residual-20261003/replay/paired-lane-a-final/p30_3FO3TOWE773J/source.jpg"
output = Path(__file__).resolve().parent

with Image.open(source) as image:
    assert image.size == (1242, 828)
    crop = image.crop((480, 155, 680, 290))
    crop.save(output / "entrance-source-crop-x480-680-y155-290.png")
    crop.resize((800, 540), Image.Resampling.NEAREST).save(
        output / "entrance-source-crop-x480-680-y155-290-4x.png"
    )
    opening = image.crop((510, 190, 635, 285))
    opening.save(output / "entrance-opening-x510-635-y190-285.png")
    opening.resize((1000, 760), Image.Resampling.NEAREST).save(
        output / "entrance-opening-x510-635-y190-285-8x.png"
    )
