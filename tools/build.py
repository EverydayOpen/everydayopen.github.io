"""Render the EverydayOpen homepage's app list from projects.json. Standard library only; the site has no build step,
this just rewrites the generated parts of the committed files.

    python tools/build.py            update the cards and footer links in index.html, the app colors in style.css, llms.txt
    python tools/build.py --check    exit 1 if any of those are out of date with projects.json
    python tools/build.py --images   also draw favicon-32.png, apple-touch-icon.png and render og.png (headless Edge or Chrome)

Adding an app = one entry in projects.json, then run this. The WebGL scene reads the cards from the page.
"""
import html
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://everydayopen.github.io/"
EXT = 'rel="noopener noreferrer"'
GH = '<svg width="16" height="16" aria-hidden="true"><use href="#gh"/></svg>'


def card(p):
    e = {k: html.escape(str(v)) for k, v in p.items()}
    return f"""<li class="app app--{e['id']} reveal" data-theme="{e['theme']}" data-glow="{e['glow']}" data-glow-light="{e['glowLight']}">
  <div class="app-head">
    <img src="{e['icon']}" alt="{e['name']} app icon" width="84" height="84" loading="lazy" decoding="async">
    <div>
      <h3><a href="{e['site']}">{e['name']}</a></h3>
      <p class="app-meta"><span class="pill">{e['status']}</span>{e['requires']} · Free</p>
    </div>
  </div>
  <p class="app-tag">{e['tagline']}</p>
  <div class="app-links">
    <a class="btn btn-accent" href="{e['download']}" {EXT}>Download<span class="sr"> {e['name']}</span> <small>{e['version']}</small></a>
    <a class="btn btn-line" href="{e['site']}">Website<span class="sr"> for {e['name']}</span></a>
    <a class="btn btn-text" href="{e['source']}" {EXT}>{GH}Source<span class="sr"> code for {e['name']}</span></a>
  </div>
</li>
"""


def foot(p):
    return f'      <a href="{html.escape(p["site"])}">{html.escape(p["name"])}</a>\n'


def css(p):
    return f".app--{p['id']} {{ --accent: {p['accent']}; --on-accent: {p['onAccent']}; --glow: {p['glow']}; }}\n"


def llms(apps):
    lines = [
        "# EverydayOpen", "",
        "> EverydayOpen is an independent studio making small, free, open-source utilities for macOS. Each app fixes one "
        "real problem, explains itself in plain English and keeps your data on your Mac. No accounts, no analytics, no trackers.", "",
        "## Apps", "",
    ]
    for p in apps:
        lines.append(f"- [{p['name']}]({p['site']}): {p['tagline']} {p['requires']}, {p['status'].lower()} "
                     f"({p['version']}). Source: {p['source']} Download: {p['download']}")
    lines += ["", "## Studio", "", "- [GitHub](https://github.com/EverydayOpen): source code for every app",
              f"- [Principles]({SITE}#principles): free, open source, private by default, look before touching", ""]
    return "\n".join(lines)


def splice(text, start, end, body):
    a, b = text.index(start) + len(start), text.index(end)
    return text[:a] + "\n" + body + text[b:]


def outputs():
    apps = json.loads((ROOT / "projects.json").read_text(encoding="utf-8"))
    for p in apps:
        missing = {"id", "name", "tagline", "requires", "status", "version", "site", "source", "download", "icon",
                   "theme", "accent", "onAccent", "glow", "glowLight"} - p.keys()
        assert not missing, f"{p.get('id')}: missing {sorted(missing)}"
        assert p["theme"] in ("light", "dark"), p["theme"]
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    index = splice(index, "<!-- apps:start -->", "<!-- apps:end -->", "".join(map(card, apps)))
    index = splice(index, "<!-- foot:start -->", "<!-- foot:end -->", "".join(map(foot, apps)))
    style = (ROOT / "style.css").read_text(encoding="utf-8")
    return {
        "index.html": index,
        "style.css": splice(style, "/* apps:start */", "/* apps:end */", "".join(map(css, apps))),
        "llms.txt": llms(apps),
    }


def png(path, w, h, pixel):
    rows = b"".join(b"\0" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def mark_icon(path, size, bg=None, pad=0.11):
    """The open-ring mark from favicon.svg, 4x4 supersampled; transparent unless bg is given."""
    s, off = size * (1 - 2 * pad) / 32, size * pad
    cx = cy = off + 16 * s
    r, half = 10.5 * s, 2.5 * s
    a0, sweep = math.radians(-30), 52 / 10.5            # dash start and length in radians (SVG y points down)
    ends = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in (a0, a0 + sweep)]
    dot, dot_r = (off + 19.9 * s, off + 6.3 * s), 2.6 * s
    blue, lime = (61, 107, 255), (198, 242, 60)

    def ink(x, y):
        if math.dist((x, y), dot) <= dot_r:
            return (*lime, 255)
        on_ring = abs(math.dist((x, y), (cx, cy)) - r) <= half and (math.atan2(y - cy, x - cx) - a0) % math.tau <= sweep
        if on_ring or any(math.dist((x, y), e) <= half for e in ends):
            t = min(max(((x - cx) - (y - cy)) / (4 * r) + 0.5, 0), 1)
            return (*(round(b + (l - b) * t) for b, l in zip(blue, lime)), 255)
        return (*bg, 255) if bg else (0, 0, 0, 0)

    def pixel(x, y):
        acc = [0, 0, 0, 0]
        for i in range(16):
            c = ink(x + (i % 4 + 0.5) / 4, y + (i // 4 + 0.5) / 4)
            acc = [a + v * (c[3] if k < 3 else 1) for k, (a, v) in enumerate(zip(acc, c))]
        a = acc[3] / 16
        return [round(v / max(acc[3], 1)) for v in acc[:3]] + [round(a)]

    png(path, size, size, pixel)


def browser():
    for c in (os.environ.get("BROWSER"),
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              shutil.which("microsoft-edge"), shutil.which("google-chrome"), shutil.which("chromium")):
        if c and Path(c).exists():
            return c
    sys.exit("No Edge or Chrome found; set BROWSER to one.")


def og_image(path):
    path.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([browser(), "--headless=new", "--hide-scrollbars", "--no-first-run", f"--user-data-dir={profile}",
                        "--window-size=1200,630", "--force-prefers-reduced-motion",
                        "--blink-settings=preferredColorScheme=0", "--virtual-time-budget=4000",
                        f"--screenshot={path}", (ROOT / "tools" / "og.html").as_uri()], capture_output=True, timeout=120)
        for _ in range(60):                             # the Windows launcher returns before the file is written
            if path.exists() and path.stat().st_size:
                time.sleep(1)
                return
            time.sleep(1)
    sys.exit("og.png was not written")


def main():
    stale = [name for name, text in outputs().items()
             if not (ROOT / name).exists() or (ROOT / name).read_text(encoding="utf-8") != text]
    if "--check" in sys.argv:
        print("stale: " + ", ".join(stale) if stale else "up to date")
        sys.exit(1 if stale else 0)
    for name, text in outputs().items():
        (ROOT / name).write_text(text, encoding="utf-8", newline="\n")
    print("updated: " + (", ".join(stale) or "nothing"))
    if "--images" in sys.argv:
        mark_icon(ROOT / "favicon-32.png", 32, pad=0.02)
        mark_icon(ROOT / "apple-touch-icon.png", 180, bg=(11, 12, 15))
        og_image(ROOT / "og.png")
        print("rendered favicon-32.png, apple-touch-icon.png, og.png")


if __name__ == "__main__":
    main()
