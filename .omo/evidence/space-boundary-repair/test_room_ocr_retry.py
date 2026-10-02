#!/usr/bin/env python3
"""Focused evidence checks for the contained room-label OCR retry."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[3]
IMAGE = ROOT / ".omo/evidence/missing-walls/source-plan.jpg"
API = ROOT / ".omo/evidence/openings-spaces/api-vector-after.json"
VECTORIZE = ROOT / ".omx/recovery-20260929/data/vectorize.py"
CROP = ROOT / ".omo/evidence/space-boundary-repair/ocr/upper-left-bedroom-2x.png"
CROP_OCR = ROOT / ".omo/evidence/space-boundary-repair/ocr/upper-left-bedroom-2x.ocr.json"
GLOBAL_OCR = ROOT / ".omx/recovery-20260929/data/.build/ocr-cache/apt-vector-3FO40HSDCOM4.json"


def load_vectorizer():
    spec = importlib.util.spec_from_file_location("room_ocr_vectorizer", VECTORIZE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {VECTORIZE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_room():
    document = json.loads(API.read_text())['data']
    source_room = next(room for room in document['rooms'] if room['id'] == 'r6')
    return {
        'poly': np.asarray(source_room['polygon'], dtype=float) / document['mmPerPx'],
        'cls': source_room['cls'],
        'label': None,
    }


def run_retry(vectorizer, items):
    calls = []

    def ocr_stub(image_path, _cache_dir):
        calls.append(Path(image_path))
        return items

    vectorizer.run_ocr = ocr_stub
    room = make_room()
    with tempfile.TemporaryDirectory(prefix='room-ocr-retry-') as cache_dir:
        result = vectorizer.retry_unlabeled_room_ocr(
            str(IMAGE), [room], cache_dir)
        generated = cv2.imread(str(calls[0]))
    return room, result, calls, generated


def run():
    vectorizer = load_vectorizer()
    crop_items = json.loads(CROP_OCR.read_text())
    captured_crop = cv2.imread(str(CROP))

    room, result, calls, generated_crop = run_retry(vectorizer, crop_items)
    assert calls[0].name == 'source-plan-room-0-274-255-495-490-2x.png'
    assert np.array_equal(generated_crop, captured_crop)
    assert result[0]['accepted'] is True, result
    assert result[0]['known'] == 1, result
    assert room['label'] == '안방', room
    assert np.allclose(result[0]['center'], [776.0, 740.0], atol=1.0), result

    global_items = json.loads(GLOBAL_OCR.read_text())
    room, result, _calls, _generated_crop = run_retry(vectorizer, global_items)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 0, result
    assert room['label'] is None, room

    unknown = [{**crop_items[0], 'text': 'room-label?'}]
    room, result, _calls, _generated_crop = run_retry(vectorizer, unknown)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 0, result
    assert room['label'] is None, room

    conflicting = [
        crop_items[0],
        {**crop_items[0], 'text': '침실', 'x': 160.0},
    ]
    room, result, _calls, _generated_crop = run_retry(vectorizer, conflicting)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 2, result
    assert room['label'] is None, room

    ambiguous = [{**crop_items[0], 'text': '주방 욕실'}]
    room, result, _calls, _generated_crop = run_retry(vectorizer, ambiguous)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 0, result
    assert room['label'] is None, room

    ambiguous_with_known = [
        {**crop_items[0], 'text': '주방 욕실'},
        crop_items[0],
    ]
    room, result, _calls, _generated_crop = run_retry(
        vectorizer, ambiguous_with_known)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 1, result
    assert result[0]['matched_words'] == ['안방', '욕실', '주방'], result
    assert room['label'] is None, room

    same_class_ambiguity = [{**crop_items[0], 'text': '안방 침실'}]
    room, result, _calls, _generated_crop = run_retry(
        vectorizer, same_class_ambiguity)
    assert result[0]['accepted'] is False, result
    assert result[0]['known'] == 0, result
    assert room['label'] is None, room

    duplicate = [crop_items[0], {**crop_items[0], 'x': 160.0}]
    room, result, _calls, _generated_crop = run_retry(vectorizer, duplicate)
    assert result[0]['accepted'] is True, result
    assert result[0]['known'] == 2, result
    assert result[0]['label'] == '안방', result
    assert result[0]['canonical_word'] == '안방', result
    assert result[0]['matched_words'] == ['안방'], result
    assert room['label'] == '안방', room

    noisy = [{**crop_items[0], 'text': '안방 기타'}]
    room, result, _calls, _generated_crop = run_retry(vectorizer, noisy)
    assert result[0]['accepted'] is True, result
    assert result[0]['known'] == 1, result
    assert result[0]['label'] == '안방', result
    assert result[0]['canonical_word'] == '안방', result
    assert room['label'] == '안방', room

    print('PASS crop=1 stale-global=1 unknown=1 conflicting=1 ambiguous=1 '
          'ambiguous-plus-known=1 same-class=1 duplicate=1 noisy=1')


if __name__ == '__main__':
    run()
