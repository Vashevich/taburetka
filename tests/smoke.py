"""Автотест «Табуретки» (Толя, 15.11.2026).
Открывает страницу в Chromium, ждёт загрузки сцены и пробует основные кнопки.
Падает, если в странице есть ошибки JavaScript, пропала сцена или кнопка не откликается.
Запуск: python -m http.server 8767 & python -u tests/smoke.py
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8767/index.html"
SHOTS = pathlib.Path(__file__).parent / "shots"
SHOTS.mkdir(exist_ok=True)
errors, steps = [], []

def ok(name):
    steps.append(name); print("  ✓", name, flush=True)

def fail(name):
    print("  ✗", name, flush=True); errors.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.on("pageerror", lambda e: errors.append(f"ошибка JavaScript: {e}"))
    pg.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" and "favicon" not in m.text else None)
    pg.goto(URL, wait_until="networkidle", timeout=90000)
    try:
        pg.wait_for_function("window.__taburetka !== undefined", timeout=60000)
        ok("страница загрузилась, сцена создана")
    except Exception:
        fail("сцена не создалась за 60 секунд (window.__taburetka нет)")
    size = pg.evaluate("(() => { const c = document.getElementById('view'); return [c.width, c.height]; })()")
    ok("холст имеет размер") if size[0] > 0 and size[1] > 0 else fail(f"холст нулевого размера: {size}")
    for btn, name in (("btnPlan", "вид «План»"), ("btn3d", "вид «3D»")):
        try:
            pg.click("#" + btn, timeout=5000); pg.wait_for_timeout(600); ok(f"{name} включается")
        except Exception as e:
            fail(f"{name} не включается: {str(e)[:120]}")
    try:
        pg.click("#btnMenu", timeout=5000); pg.wait_for_timeout(300)
        ok("меню открывается") if pg.is_visible("#menu") else fail("меню не открылось")
    except Exception as e:
        fail(f"меню не открывается: {str(e)[:120]}")
    pg.screenshot(path=str(SHOTS / "final.png"))
    b.close()

print(f"\nпроверок прошло: {len(steps)}, ошибок: {len(errors)}")
for e in errors: print("  ОШИБКА:", e)
sys.exit(1 if errors else 0)
