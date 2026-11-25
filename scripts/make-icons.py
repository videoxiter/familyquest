"""Рисует иконки приложения в public/icons (без внешних картинок).

Запуск: python scripts/make-icons.py
Палитра совпадает с интерфейсом: фон #0d1117, акцент #6aa8ff, зелёный #7ecb8f.
Эмблема держится в центральных 60% кадра — это безопасная зона для maskable-иконок.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
BG = (13, 17, 23)
ACCENT = (106, 168, 255)
GREEN = (126, 203, 143)
WHITE = (240, 246, 252)
SHIELD_FILL = (19, 36, 58)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"


def shield_points(cx: float, top: float, width: float, height: float, sharp: float = 2.2):
    """Классический щит: ровный верх, сужающиеся бока, остриё снизу."""
    x0, x1 = cx - width / 2, cx + width / 2
    pts = [(x0, top), (x1, top)]
    steps = 60
    for i in range(1, steps + 1):
        t = i / steps
        pts.append((x1 - (x1 - cx) * (t**sharp), top + height * t))
    for i in range(steps, 0, -1):
        t = i / steps
        pts.append((x0 + (cx - x0) * (t**sharp), top + height * t))
    return pts


def sparkle(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, color: tuple[int, int, int]):
    """Четырёхконечная звезда."""
    pts = []
    for i in range(8):
        angle = i * math.pi / 4 - math.pi / 2
        radius = r if i % 2 == 0 else r * 0.34
        pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    draw.polygon(pts, fill=color + (255,))


def build() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), BG + (255,))
    draw = ImageDraw.Draw(img)

    # мягкое свечение под эмблемой
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for r in range(520, 80, -16):
        alpha = int(26 * (1 - r / 520) ** 2)
        glow_draw.ellipse(
            [SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r],
            fill=ACCENT + (alpha,),
        )
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(64)))

    cx = SIZE / 2
    top, width, height = 272, 396, 462

    # контур рисуем как «внешний щит минус внутренний» — без артефактов стыков линии
    outer = shield_points(cx, top, width, height)
    inner = shield_points(cx, top + 26, width - 52, height - 50)
    draw.polygon(outer, fill=ACCENT + (255,))
    draw.polygon(inner, fill=SHIELD_FILL + (255,))

    # галочка
    ck = [(cx - 92, top + 240), (cx - 18, top + 312), (cx + 108, top + 166)]
    draw.line(ck, fill=WHITE + (255,), width=40, joint="curve")
    for x, y in (ck[0], ck[-1]):
        draw.ellipse([x - 20, y - 20, x + 20, y + 20], fill=WHITE + (255,))

    # искры вокруг
    sparkle(draw, cx - 318, top + 96, 44, ACCENT)
    sparkle(draw, cx + 330, top + 60, 34, ACCENT)
    sparkle(draw, cx - 252, top + 410, 26, GREEN)
    sparkle(draw, cx + 286, top + 372, 20, GREEN)

    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = build()

    targets = {
        "icon-1024.png": 1024,
        "icon-512.png": 512,
        "icon-192.png": 192,
        "apple-touch-icon.png": 180,
        "favicon-32.png": 32,
    }

    for name, size in targets.items():
        resized = base if size == 1024 else base.resize((size, size), Image.LANCZOS)
        path = OUT / name
        resized.save(path, "PNG", optimize=True)
        print(f"{path.relative_to(ROOT)} — {size}x{size}, {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
