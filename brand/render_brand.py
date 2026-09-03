from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


BASE = Path(__file__).resolve().parents[1]
W_POINTS = [(166, 286), (270, 286), (340, 624), (410, 374), (482, 624), (552, 286), (656, 286), (554, 814), (462, 814), (410, 608), (358, 814), (264, 814)]
W_EDGE_POINTS = [(x + 20, y + 20) for x, y in W_POINTS]
L_POINTS = [(662, 266), (774, 266), (774, 664), (876, 664), (876, 794), (642, 794), (642, 286)]
L_EDGE_POINTS = [(x + 20, y + 20) for x, y in L_POINTS]
WELD_LINE = [(676, 610), (676, 718), (818, 718)]


def render_simplified(size: int, transparent: bool) -> Image.Image:
    background = (0, 0, 0, 0) if transparent else "#102635"
    image = Image.new("RGBA", (1024, 1024), background)
    draw = ImageDraw.Draw(image)
    face = "#102635" if transparent else "#F2F5F6"
    opening = "#F2F5F6" if transparent else "#102635"
    draw.polygon(W_EDGE_POINTS, fill="#788894")
    draw.polygon(W_POINTS, fill=face)
    draw.polygon([(184, 300), (254, 300), (262, 334), (192, 334)], fill=opening, outline="#788894", width=14)
    draw.polygon([(568, 300), (638, 300), (630, 334), (560, 334)], fill=opening, outline="#788894", width=14)
    draw.polygon(L_EDGE_POINTS, fill="#788894")
    draw.polygon(L_POINTS, fill=face)
    draw.polygon([(700, 318), (736, 318), (736, 702), (858, 702), (858, 756), (690, 756), (690, 318)], fill=opening)
    for part in range(12):
        start = part / 12
        end = min(start + .045, 1)
        if start < .43:
            y1, y2 = 610 + 108 * start / .43, 610 + 108 * end / .43
            draw.line([(676, y1), (676, y2)], fill="#FF672B", width=22)
        else:
            x1, x2 = 676 + 142 * (start - .43) / .57, 676 + 142 * (end - .43) / .57
            draw.line([(x1, 718), (x2, 718)], fill="#FF672B", width=22)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def render_detailed(size: int, transparent: bool) -> Image.Image:
    source = Image.open(BASE / "brand/source/wl-3d-selected.png").convert("RGBA")
    source = source.crop(source.getbbox())
    source.thumbnail((int(size * .82), int(size * .72)), Image.Resampling.LANCZOS)
    background = (0, 0, 0, 0) if transparent else "#102635"
    image = Image.new("RGBA", (size, size), background)
    image.alpha_composite(source, ((size - source.width) // 2, (size - source.height) // 2))
    return image


detailed_outputs = [
    (BASE / "public/assets/brand/wl-mark-1024.png", 1024, False),
    (BASE / "public/assets/brand/wl-mark-144.png", 144, False),
    (BASE / "public/assets/brand/wl-mark-transparent.png", 1024, True),
    (BASE / "miniprogram/assets/brand/wl-mark-transparent.png", 256, True),
    (BASE / "miniprogram/assets/brand/wl-mark-144.png", 144, False),
]

for output, size, transparent in detailed_outputs:
    output.parent.mkdir(parents=True, exist_ok=True)
    render_detailed(size, transparent).save(output, optimize=True)

simplified_outputs = [
    (BASE / "public/assets/brand/wl-mark-72-preview.png", 72, False),
    (BASE / "public/assets/brand/wl-mark-36-preview.png", 36, False),
    (BASE / "public/assets/brand/wl-favicon-32.png", 32, False),
]

for output, size, transparent in simplified_outputs:
    render_simplified(size, transparent).save(output, optimize=True)

hero = Image.open(BASE / "miniprogram/assets/images/laser-cutting-hero.jpg").convert("RGB")
hero = hero.resize((500, 400), Image.Resampling.LANCZOS)
overlay = Image.new("RGBA", hero.size, (0, 0, 0, 0))
overlay_draw = ImageDraw.Draw(overlay)
overlay_draw.rectangle((0, 0, 330, 400), fill=(16, 38, 53, 230))
overlay_draw.polygon([(330, 0), (430, 0), (330, 400), (260, 400)], fill=(16, 38, 53, 150))
share = Image.alpha_composite(hero.convert("RGBA"), overlay)
share.alpha_composite(render_detailed(104, True), (18, 18))
font_path = Path("C:/Windows/Fonts/msyhbd.ttc")
title_font = ImageFont.truetype(font_path, 34)
body_font = ImageFont.truetype(font_path, 20)
share_draw = ImageDraw.Draw(share)
share_draw.text((28, 142), "未来机械钣金服务", font=title_font, fill="#F2F5F6")
share_draw.text((28, 205), "有图无图都可沟通", font=body_font, fill="#F2F5F6")
share_draw.text((28, 242), "小批量 · 急件 · 非标加工", font=body_font, fill="#FF672B")
share.convert("RGB").save(BASE / "miniprogram/assets/brand/share-card.jpg", quality=90, optimize=True)

social = Image.new("RGBA", (1200, 630), "#102635")
social.alpha_composite(render_detailed(520, True), (620, 55))
social_draw = ImageDraw.Draw(social)
social_title_font = ImageFont.truetype(font_path, 60)
social_body_font = ImageFont.truetype(font_path, 30)
social_draw.text((70, 170), "未来机械", font=social_title_font, fill="#F2F5F6")
social_draw.text((70, 260), "非标钣金制造", font=social_body_font, fill="#FF672B")
social_draw.text((70, 330), "有图 / 无图均可沟通", font=social_body_font, fill="#F2F5F6")
social.convert("RGB").save(BASE / "public/assets/brand/wl-social-card-1200x630.jpg", quality=92, optimize=True)
