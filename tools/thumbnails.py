"""
Makes the small copies of the pictures that the cards and the list show.

Every picture under img/ gets a copy under img/thumbs/, at most 960 pixels wide and saved as
WebP - around a tenth of the size - named after the original with .webp added:
img/S_0x18BF9408F8FB6EB6.jpg becomes img/thumbs/S_0x18BF9408F8FB6EB6.jpg.webp. The viewer
still opens the original.

The Pages workflow runs this on every deploy, so only the originals are kept in git. The page
falls back to the original wherever there is no copy, so running it locally is only needed to
preview the copies:

    pip install Pillow
    python tools/thumbnails.py
"""

import pathlib
import sys

from PIL import Image, ImageOps

WIDTH = 960
QUALITY = 80

SOURCE = pathlib.Path(__file__).resolve().parent.parent / 'img'
TARGET = SOURCE / 'thumbs'
PICTURES = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}


def originals():
    """Every picture under img/, apart from the copies themselves."""
    for path in sorted(SOURCE.rglob('*')):
        if path.is_file() and path.suffix.lower() in PICTURES and TARGET not in path.parents:
            yield path


def copy_of(original):
    relative = original.relative_to(SOURCE)
    return TARGET / relative.parent / (relative.name + '.webp')


def main():
    wanted = set()
    made = 0

    for original in originals():
        copy = copy_of(original)
        wanted.add(copy)

        # Already made from this version of the picture.
        if copy.exists() and copy.stat().st_mtime >= original.stat().st_mtime:
            continue

        copy.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(original) as image:
            image = ImageOps.exif_transpose(image)  # a camera's rotation flag, applied
            image = image.convert('RGBA' if image.mode in ('RGBA', 'LA', 'P', 'PA') else 'RGB')
            if image.width > WIDTH:
                image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
            image.save(copy, 'WEBP', quality=QUALITY, method=6)

        made += 1
        print(f'{original.relative_to(SOURCE)}: {original.stat().st_size // 1024} KB '
              f'-> {copy.stat().st_size // 1024} KB')

    # Copies whose original has gone.
    for copy in TARGET.rglob('*.webp') if TARGET.exists() else []:
        if copy not in wanted:
            copy.unlink()
            print(f'removed {copy.relative_to(SOURCE)}')

    print(f'{made} made, {len(wanted) - made} already up to date')
    return 0


if __name__ == '__main__':
    sys.exit(main())
