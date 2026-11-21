"""
הסרת רקע לתמונות מוצר (Open Food Facts) עם rembg + BiRefNet, ובדיקת איכות שדוחה חיתוך גרוע.
  tools/.venv/Scripts/python tools/cutout.py <in_dir> <out_dir> [model]
לכל <barcode>.jpg ב-in_dir: אם החיתוך עובר את הבדיקה → out_dir/<barcode>.png (שקוף). אחרת לא נכתב כלום
(והאתר נשאר עם התמונה המקורית על לבן). report.json מסכם למה כל תמונה נדחתה.
"""
import json, sys, pathlib
import numpy as np
from PIL import Image
from scipy import ndimage
from rembg import new_session, remove

src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
model = sys.argv[3] if len(sys.argv) > 3 else "birefnet-general"
dst.mkdir(parents=True, exist_ok=True)
session = new_session(model)
report = {}

def check(alpha: np.ndarray) -> str | None:
    """None = חיתוך טוב; אחרת סיבת הדחייה"""
    m = alpha > 128
    frac = m.mean()
    if frac < 0.12: return f"too little kept ({frac:.0%})"
    if frac > 0.97: return "background not removed"
    lab, n = ndimage.label(m)
    if n == 0: return "empty"
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    if sizes.max() / m.sum() < 0.93: return f"fragmented ({n} parts)"
    filled = ndimage.binary_fill_holes(m)
    holes = (filled & ~m).sum() / filled.sum()
    if holes > 0.015: return f"holes in product ({holes:.1%})"
    soft = ((alpha > 25) & (alpha < 230)).sum() / max(1, m.sum())
    if soft > 0.12: return f"unsure edges ({soft:.0%})"
    # המוצר נחתך בשולי התמונה מכמה צדדים = כנראה צילום צפוף ולא מוצר שלם
    edges = sum([m[0, :].mean() > 0.5, m[-1, :].mean() > 0.5, m[:, 0].mean() > 0.5, m[:, -1].mean() > 0.5])
    if edges >= 3: return "product fills the frame (cropped photo)"
    # קעירות חדה בקו המתאר (״ביס״ שנלקח מהמוצר): השוואה למעטפת קמורה גסה
    ys, xs = np.nonzero(m)
    box = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    if box.mean() < 0.55: return f"irregular outline ({box.mean():.0%} of its box)"
    return None

for f in sorted(src.glob("*.jpg")):
    try:
        img = Image.open(f).convert("RGB")
        out = remove(img, session=session, post_process_mask=True)
        alpha = np.array(out.split()[-1])
        why = check(alpha)
        if why:
            report[f.stem] = why
            continue
        bbox = out.getbbox()
        out.crop(bbox).save(dst / f"{f.stem}.png")
        report[f.stem] = "ok"
    except Exception as e:  # noqa
        report[f.stem] = f"error: {e}"
    print(f.stem, report[f.stem], flush=True)

(dst / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
ok = sum(1 for v in report.values() if v == "ok")
print(f"done: {ok} of {len(report)} passed the quality check")
