"""Генерирует фоновую музыку и звуки интерфейса (без внешних файлов и лицензий).

Запуск: python scripts/make-audio.py
Результат: public/audio/music-loop.wav и public/audio/sfx/*.wav
Дальше при сборке ничего пережимать не нужно, но mp3/wav лучше держать короткими:
    музыка  — 16 секунд, бесшовный луп
    звуки   — 0.2–1.2 секунды

Стиль: бодрый чиптюн, мажорная тональность. Все партии — треугольник/квадрат
с короткими огибающими, плюс шумовые барабаны. Слушается как игровая заставка.
"""
from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"
SFX = OUT / "sfx"

# Музыка — низкая частота дискретизации: 16 секунд занимают ~350 КБ вместо 700.
# Звуки короче, им оставляем 22050 Гц.
MUSIC_RATE = 11025
SFX_RATE = 22050
RATE = SFX_RATE

random.seed(7)


def note(freq: float, seconds: float, wave_type: str = "triangle", volume: float = 0.25):
    n = int(RATE * seconds)
    t = np.arange(n) / RATE
    if wave_type == "triangle":
        wave_data = 2 * np.abs(2 * (t * freq - np.floor(t * freq + 0.5))) - 1
    elif wave_type == "square":
        wave_data = np.sign(np.sin(2 * math.pi * freq * t)) * 0.6
    elif wave_type == "sine":
        wave_data = np.sin(2 * math.pi * freq * t)
    else:  # saw
        wave_data = 2 * (t * freq - np.floor(t * freq + 0.5))

    # огибающая: быстрый вход, плавное затухание
    attack = max(1, int(n * 0.02))
    release = max(1, int(n * 0.35))
    env = np.ones(n)
    env[:attack] = np.linspace(0, 1, attack)
    env[-release:] = np.linspace(1, 0, release)
    return wave_data * env * volume


def noise(seconds: float, volume: float = 0.12, decay: float = 40.0):
    n = int(RATE * seconds)
    data = np.array([random.uniform(-1, 1) for _ in range(n)])
    env = np.exp(-decay * np.arange(n) / n)
    return data * env * volume


def mix(*parts) -> np.ndarray:
    length = max(len(p) for p in parts)
    out = np.zeros(length)
    for part in parts:
        out[: len(part)] += part
    return out


def place(track: np.ndarray, sound: np.ndarray, at_second: float) -> None:
    start = int(at_second * RATE)
    end = min(len(track), start + len(sound))
    if start >= len(track):
        return
    track[start:end] += sound[: end - start]


def save(path: Path, data: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = np.max(np.abs(data)) or 1.0
    normalized = np.clip(data / peak * 0.85, -1, 1)
    samples = (normalized * 32767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(samples.tobytes())
    print(f"{path.relative_to(ROOT)} — {len(data) / RATE:.2f} c, {path.stat().st_size // 1024} КБ")


# ─────────────────────────── ноты ──────────────────────────────────────────
def freq(name: str) -> float:
    """Нота вида C5, A#4 → частота в герцах."""
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
             "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    key = name[:-1]
    octave = int(name[-1])
    semitone = names[key] + (octave - 4) * 12
    return 440.0 * (2 ** ((semitone - 9) / 12))


def build_music() -> np.ndarray:
    bpm = 116
    beat = 60 / bpm
    bars = 8
    total = beat * 4 * bars
    track = np.zeros(int(RATE * total))

    # аккорды: C — Am — F — G, по два такта
    progression = [
        ("C5", ["C4", "E4", "G4"]),
        ("C5", ["C4", "E4", "G4"]),
        ("A4", ["A3", "C4", "E4"]),
        ("A4", ["A3", "C4", "E4"]),
        ("F4", ["F3", "A3", "C4"]),
        ("F4", ["F3", "A3", "C4"]),
        ("G4", ["G3", "B3", "D4"]),
        ("G4", ["G3", "B3", "D4"]),
    ]

    melody = [
        "E5", "G5", "C6", "G5", "E5", "D5", "C5", "D5",
        "A5", "C6", "E6", "C6", "A5", "G5", "E5", "G5",
        "F5", "A5", "C6", "A5", "F5", "E5", "D5", "E5",
        "G5", "B5", "D6", "B5", "G5", "F5", "E5", "D5",
    ]

    for bar, (root, chord) in enumerate(progression):
        bar_start = bar * 4 * beat

        # бас — по четвертям
        for step in range(4):
            place(track, note(freq(chord[0]) / 2, beat * 0.9, "triangle", 0.30), bar_start + step * beat)

        # аккорд — короткими стаккато на слабых долях
        for step in (1, 3):
            for tone in chord[1:]:
                place(track, note(freq(tone), beat * 0.32, "triangle", 0.12), bar_start + step * beat)

        # хэты — восьмые
        for step in range(8):
            place(track, noise(0.05, 0.05, 60), bar_start + step * beat / 2)

        # бочка на 1 и 3
        for step in (0, 2):
            place(track, note(70, beat * 0.18, "sine", 0.55), bar_start + step * beat)

    # мелодия поверх — восьмыми
    step_len = beat / 2
    for index, tone in enumerate(melody):
        place(track, note(freq(tone), step_len * 0.85, "square", 0.14), index * step_len)

    return track


def build_sfx() -> dict[str, np.ndarray]:
    sfx: dict[str, np.ndarray] = {}

    # награда: восходящее арпеджио
    award = np.concatenate([
        note(freq("C5"), 0.09, "square", 0.3),
        note(freq("E5"), 0.09, "square", 0.3),
        note(freq("G5"), 0.16, "square", 0.32),
    ])
    sfx["award"] = award

    # новый уровень: короткие фанфары
    fanfare = np.concatenate([
        note(freq("G4"), 0.1, "square", 0.3),
        note(freq("C5"), 0.1, "square", 0.3),
        note(freq("E5"), 0.1, "square", 0.3),
        note(freq("G5"), 0.36, "triangle", 0.34),
    ])
    sfx["levelup"] = fanfare

    # взял задачу: щелчок-поп
    sfx["claim"] = mix(
        note(520, 0.05, "sine", 0.35),
        note(880, 0.08, "triangle", 0.2),
    )

    # вернул в очередь: нисходящий блип
    sfx["release"] = mix(
        note(420, 0.09, "triangle", 0.28),
        np.concatenate([np.zeros(int(RATE * 0.05)), note(300, 0.12, "triangle", 0.25)]),
    )

    # одобрено: двойной «дзынь»
    sfx["approve"] = np.concatenate([
        note(freq("E5"), 0.1, "sine", 0.3),
        note(freq("A5"), 0.22, "sine", 0.3),
    ])

    # возврат на доработку: мягкий низкий сигнал
    sfx["reject"] = np.concatenate([
        note(freq("A4"), 0.12, "triangle", 0.26),
        note(freq("F4"), 0.2, "triangle", 0.24),
    ])

    # напоминание о дедлайне
    sfx["remind"] = np.concatenate([
        note(freq("C6"), 0.1, "sine", 0.28),
        np.zeros(int(RATE * 0.06)),
        note(freq("C6"), 0.14, "sine", 0.26),
    ])

    # значок
    sfx["badge"] = np.concatenate([
        note(freq("D6"), 0.07, "square", 0.24),
        note(freq("G6"), 0.07, "square", 0.24),
        note(freq("B6"), 0.2, "square", 0.24),
    ])

    return sfx


def main() -> None:
    # note/noise/save читают глобальный RATE в момент вызова — переключаем его между партиями.
    global RATE

    RATE = MUSIC_RATE
    save(OUT / "music-loop.wav", build_music())

    RATE = SFX_RATE
    for name, data in build_sfx().items():
        save(SFX / f"{name}.wav", data)


if __name__ == "__main__":
    main()
