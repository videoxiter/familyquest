"""Готовит арт: иконки приложения из icon-source.png и оптимизированные webp-иллюстрации.

Запуск: python scripts/prepare-art.py
Исходники лежат в public/art (их генерирует пользователь), результат — там же (webp)
и в public/icons.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# Исходники (тяжёлые PNG) лежат вне public, поэтому не попадают в сборку.
SRC = ROOT / "art-source"
ART = ROOT / "public" / "art"
ICONS = ROOT / "public" / "icons"

BG = (13, 17, 23)

# файл-источник -> (куда, максимальная сторона, качество webp, квадрат?)
ILLUSTRATIONS = [
    ("hero.png", "hero.webp", 900, 80, False),
    ("empty-tasks.png", "empty-tasks.webp", 520, 82, False),
    ("rewards.png", "rewards.webp", 520, 82, False),
    ("level-up.png", "level-up.webp", 420, 85, True),
    ("avatar-papa.png", "avatar-papa.webp", 256, 85, True),
    ("avatar-mama.png", "avatar-mama.webp", 256, 85, True),
    ("avatar-alyosha.png", "avatar-alyosha.webp", 256, 85, True),
]

ICON_SIZES = {
    "icon-1024.png": 1024,
    "icon-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "favicon-32.png": 32,
}


def square(img: Image.Image, fill=BG) -> Image.Image:
    side = max(img.size)
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(img.convert("RGB"), ((side - img.width) // 2, (side - img.height) // 2))
    return canvas


def build_icon_source() -> Image.Image:
    """Берём сгенерированную иконку и ужимаем содержимое до безопасной зоны маски."""
    raw = Image.open(SRC / "icon-source.png").convert("RGBA")
    canvas = square(raw)

    side = canvas.size[0]
    # 78% — содержимое не срежется круглой маской Android и скруглением iOS
    inner = int(side * 0.78)
    scaled = canvas.resize((inner, inner), Image.LANCZOS)

    final = Image.new("RGB", (side, side), BG)
    final.paste(scaled, ((side - inner) // 2, (side - inner) // 2))
    return final


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    base = build_icon_source()
    for name, size in ICON_SIZES.items():
        img = base if size == base.size[0] else base.resize((size, size), Image.LANCZOS)
        path = ICONS / name
        img.save(path, "PNG", optimize=True)
        print(f"иконка  {path.relative_to(ROOT)} — {size}x{size}, {path.stat().st_size // 1024} КБ")

    total = 0
    for source, target, max_side, quality, need_square in ILLUSTRATIONS:
        src = SRC / source
        if not src.exists():
            print(f"пропуск {source}: файла нет")
            continue

        img = Image.open(src)
        img = img.convert("RGBA")
        if need_square:
            img = square(img).convert("RGBA")
        img.thumbnail((max_side, max_side), Image.LANCZOS)

        out = ART / target
        img.save(out, "WEBP", quality=quality, method=6)
        size_kb = out.stat().st_size // 1024
        total += size_kb
        print(f"картинка {out.relative_to(ROOT)} — {img.width}x{img.height}, {size_kb} КБ")

    print(f"итого иллюстраций: {total} КБ")


if __name__ == "__main__":
    main()
