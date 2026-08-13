from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
target = root / "ios/KashStrap/KashStrap/Assets.xcassets/AppIcon.appiconset/KashStrap-1024.png"
size = 1024
image = Image.new("RGB", (size, size), "#09110e")
draw = ImageDraw.Draw(image)
for radius in range(720, 0, -4):
    fraction = radius / 720
    color = (round(8 + 8 * fraction), round(17 + 24 * fraction), round(14 + 20 * fraction))
    draw.ellipse((512-radius, 370-radius, 512+radius, 370+radius), fill=color)
font_paths = [
    "/System/Library/Fonts/SFNSRounded.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
font = next((ImageFont.truetype(path, 590) for path in font_paths if Path(path).exists()), ImageFont.load_default())
bounds = draw.textbbox((0, 0), "K", font=font)
x = (size - (bounds[2] - bounds[0])) / 2 - bounds[0]
y = (size - (bounds[3] - bounds[1])) / 2 - bounds[1] + 40
draw.text((x, y), "K", font=font, fill="#f4f7f5")
draw.ellipse((735, 220, 825, 310), fill="#34ea99")
target.parent.mkdir(parents=True, exist_ok=True)
image.save(target, "PNG", optimize=True)
print(target)

