# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0"]
# ///
"""Affinity Mapping Studio app icon generator.

Concept: loose cards gathered into an affinity cluster (= affinity mapping).
Renders a 1024x1024 PNG (supersampled 2x then downscaled for smooth edges).
Run: uv run _gen_icon.py
"""
from __future__ import annotations
from PIL import Image, ImageDraw
import math

S = 2048              # supersample canvas
OUT = 1024            # final size
R_BG = int(S * 0.18)  # background corner radius


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size), top)
    px = img.load()
    for y in range(size):
        px[0, y] = lerp(top, bottom, y / max(1, size - 1))
    return img.resize((size, size))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def card(draw, box, fill, radius, outline=None, ow=0):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=ow)


def rotated_card(base, box, fill, radius, angle, shadow=True):
    """Draw a rounded card rotated by `angle` degrees, pasted onto base (RGBA)."""
    w = box[2] - box[0]
    h = box[3] - box[1]
    pad = int(max(w, h) * 0.6)
    layer = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if shadow:
        soff = int(S * 0.012)
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        ds = ImageDraw.Draw(sh)
        ds.rounded_rectangle(
            [pad + soff, pad + soff, pad + w + soff, pad + h + soff],
            radius=radius, fill=(20, 35, 55, 110),
        )
        from PIL import ImageFilter
        sh = sh.filter(ImageFilter.GaussianBlur(int(S * 0.012)))
        layer = Image.alpha_composite(layer, sh)
        d = ImageDraw.Draw(layer)
    d.rounded_rectangle([pad, pad, pad + w, pad + h], radius=radius, fill=fill)
    layer = layer.rotate(angle, resample=Image.BICUBIC, center=(pad + w / 2, pad + h / 2))
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    base.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


def main():
    # Brand slate-blue gradient (consistent with the previous icon palette).
    bg = vertical_gradient(S, (96, 128, 168), (62, 92, 130)).convert("RGBA")

    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Affinity group boundary: soft rounded container enclosing the cluster.
    gx0, gy0, gx1, gy1 = int(S * 0.20), int(S * 0.38), int(S * 0.80), int(S * 0.82)
    draw.rounded_rectangle(
        [gx0, gy0, gx1, gy1], radius=int(S * 0.07),
        fill=(255, 255, 255, 28), outline=(255, 255, 255, 150), width=int(S * 0.010),
    )

    # One incoming card being gathered (top), with a connector into the group.
    ix0, iy0, ix1, iy1 = int(S * 0.40), int(S * 0.11), int(S * 0.60), int(S * 0.27)
    draw.line(
        [int(S * 0.50), int(S * 0.27), int(S * 0.50), int(S * 0.40)],
        fill=(255, 255, 255, 150), width=int(S * 0.009),
    )

    # Clustered cards (white / amber / teal) — fanned for a "grouped" feel.
    AMBER = (243, 201, 76, 255)
    TEAL = (86, 204, 192, 255)
    WHITE = (245, 248, 252, 255)
    cw, ch = int(S * 0.205), int(S * 0.235)
    rad = int(S * 0.030)
    # back-left white
    rotated_card(canvas, [int(S * 0.255), int(S * 0.45), int(S * 0.255) + cw, int(S * 0.45) + ch], WHITE, rad, 8)
    # right teal
    rotated_card(canvas, [int(S * 0.545), int(S * 0.45), int(S * 0.545) + cw, int(S * 0.45) + ch], TEAL, rad, -7)
    # front-center amber (on top)
    rotated_card(canvas, [int(S * 0.40), int(S * 0.50), int(S * 0.40) + cw, int(S * 0.50) + ch], AMBER, rad, 1)
    # incoming card (drawn last so connector tucks under it)
    rotated_card(canvas, [ix0, iy0, ix1, iy1], WHITE, rad, 0)

    out = Image.alpha_composite(bg, canvas)

    # Clip to rounded square.
    mask = rounded_mask(S, R_BG)
    final = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    final.paste(out, (0, 0), mask)

    final = final.resize((OUT, OUT), Image.LANCZOS)
    final.save("source-1024.png")
    print("wrote source-1024.png", final.size)


if __name__ == "__main__":
    main()
