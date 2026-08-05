"""将 styles.css 中的硬编码颜色迁移到设计 token（CSS 变量）。

策略：
1. 按声明属性确定语义上下文（text/bg/border/shadow）。
2. 按色相族确定强调色归属（neutral/primary/danger/success/warning/pink）。
3. 在同族锚点中按 RGB 距离选择最近 token。
4. box-shadow 整条替换为阴影/焦点环 token。

用法：python scripts/migrate_styles_to_tokens.py [--write]
"""

from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

CSS_PATH = Path("apps/web/src/styles.css")

# ---------------------------------------------------------------------------
# Token 定义：浅色（现有调色板归一）与深色（新设计）
# ---------------------------------------------------------------------------

TOKENS: dict[str, tuple[str, str]] = {
    # 中性表面
    "color-bg-app": ("#e9edf2", "#0e1319"),
    "color-bg-surface": ("#ffffff", "#161c26"),
    "color-bg-raised": ("#f8fafc", "#1b2330"),
    "color-bg-subtle": ("#f4f7fa", "#121821"),
    "color-bg-inset": ("#e7ebf0", "#0b0f15"),
    "color-bg-active": ("#dde4eb", "#232d3d"),
    "color-bg-disabled": ("#cbd3dc", "#1e2633"),
    # 文本
    "color-text-primary": ("#172231", "#e6ecf4"),
    "color-text-secondary": ("#526174", "#a3b1c2"),
    "color-text-muted": ("#6f7d90", "#6e7d90"),
    "color-text-inverse": ("#ffffff", "#10161f"),
    # 边框
    "color-border-subtle": ("#e3e9f0", "#222c3a"),
    "color-border-default": ("#c6ced8", "#303c4d"),
    "color-border-strong": ("#9aa8b8", "#465870"),
    "color-border-emphasis": ("#7d91a8", "#5d738d"),
    # 主色（蓝）
    "color-primary": ("#1d5f88", "#3d9ad1"),
    "color-primary-hover": ("#174c6d", "#56ace0"),
    "color-primary-active": ("#133f59", "#2f86bb"),
    "color-primary-softer": ("#eef7fb", "#152230"),
    "color-primary-soft": ("#e2eef6", "#1a2b3a"),
    "color-primary-border": ("#c7dcea", "#274a63"),
    "color-primary-text": ("#174c6d", "#7fc0e6"),
    # 危险（红）
    "color-danger": ("#8b3030", "#e06c6c"),
    "color-danger-hover": ("#7a2929", "#e88282"),
    "color-danger-strong": ("#6f2525", "#ef9494"),
    "color-danger-soft": ("#fdf1f1", "#2c1a1c"),
    "color-danger-border": ("#dca5a5", "#5c2e30"),
    "color-danger-text": ("#8b3030", "#ef9c9c"),
    "color-danger-muted": ("#bd5b5b", "#d98a8a"),
    # 成功（绿）
    "color-success": ("#27633f", "#4cbf82"),
    "color-success-hover": ("#205233", "#63cc94"),
    "color-success-soft": ("#eef8f2", "#16281e"),
    "color-success-border": ("#8bb99f", "#2c4d3a"),
    "color-success-text": ("#27633f", "#83d3a8"),
    "color-success-muted": ("#4d7162", "#6fae8d"),
    # 警告（琥珀）
    "color-warning": ("#a15309", "#d9a944"),
    "color-warning-hover": ("#8a4708", "#e2b95f"),
    "color-warning-soft": ("#fff8e7", "#2a2416"),
    "color-warning-border": ("#d3bd92", "#55431f"),
    "color-warning-text": ("#76591d", "#e0c37c"),
    # 粉（少量装饰）
    "color-pink": ("#d88ba6", "#db8fa9"),
    "color-pink-soft": ("#fde7ef", "#33202b"),
    # 半透明层
    "color-scrim": ("rgba(18, 30, 48, 0.38)", "rgba(4, 8, 14, 0.62)"),
    "color-scrim-soft": ("rgb(31 45 61 / 32%)", "rgb(4 8 14 / 45%)"),
    "color-surface-alpha": ("rgb(255 255 255 / 94%)", "rgb(22 28 38 / 94%)"),
    "color-surface-alpha-faint": ("rgb(255 255 255 / 48%)", "rgb(22 28 38 / 48%)"),
    "color-border-alpha": ("rgb(71 85 105 / 33%)", "rgb(148 163 184 / 22%)"),
    "color-primary-fill-soft": ("rgb(232 241 248 / 72%)", "rgb(26 43 58 / 72%)"),
    # 阴影与焦点环
    "shadow-xs": ("0 1px 2px rgba(15, 23, 42, 0.08)", "0 1px 2px rgba(0, 0, 0, 0.45)"),
    "shadow-sm": ("0 2px 8px rgba(15, 23, 42, 0.10)", "0 2px 8px rgba(0, 0, 0, 0.5)"),
    "shadow-md": ("0 10px 26px rgba(15, 23, 42, 0.13)", "0 10px 26px rgba(0, 0, 0, 0.55)"),
    "shadow-lg": ("0 18px 44px rgba(15, 23, 42, 0.18)", "0 18px 44px rgba(0, 0, 0, 0.6)"),
    "shadow-pop": ("0 24px 70px rgba(15, 23, 42, 0.26)", "0 24px 70px rgba(0, 0, 0, 0.65)"),
    "shadow-inset-highlight": ("inset 0 1px 0 rgba(255, 255, 255, 0.7)", "inset 0 1px 0 rgba(255, 255, 255, 0.06)"),
    "focus-ring-primary": ("0 0 0 3px rgba(29, 95, 136, 0.18)", "0 0 0 3px rgba(61, 154, 209, 0.35)"),
    "focus-ring-danger": ("0 0 0 3px rgba(139, 48, 48, 0.16)", "0 0 0 3px rgba(224, 108, 108, 0.35)"),
    "focus-ring-success": ("0 0 0 3px rgba(39, 99, 63, 0.18)", "0 0 0 3px rgba(76, 191, 130, 0.35)"),
}

# ---------------------------------------------------------------------------
# 锚点：按 (上下文, 色相族) 分组，(token, 浅色锚点)
# ---------------------------------------------------------------------------


def rgb_of(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:
        h = h[:6]
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


ANCHORS: dict[tuple[str, str], list[tuple[str, str]]] = {
    ("text", "neutral"): [
        ("color-text-primary", "#172231"),
        ("color-text-secondary", "#526174"),
        ("color-text-muted", "#6f7d90"),
        ("color-text-inverse", "#ffffff"),
    ],
    ("text", "primary"): [
        ("color-primary-text", "#174c6d"),
        ("color-primary", "#1d5f88"),
    ],
    ("text", "danger"): [
        ("color-danger-text", "#8b3030"),
        ("color-danger-muted", "#bd5b5b"),
        ("color-danger-strong", "#6f2525"),
    ],
    ("text", "success"): [
        ("color-success-text", "#27633f"),
        ("color-success-muted", "#4d7162"),
    ],
    ("text", "warning"): [
        ("color-warning-text", "#76591d"),
        ("color-warning", "#a15309"),
    ],
    ("text", "pink"): [("color-pink", "#d88ba6")],
    ("bg", "neutral"): [
        ("color-bg-surface", "#ffffff"),
        ("color-bg-raised", "#f8fafc"),
        ("color-bg-subtle", "#f4f7fa"),
        ("color-bg-inset", "#e7ebf0"),
        ("color-bg-app", "#e9edf2"),
        ("color-bg-active", "#dde4eb"),
        ("color-bg-disabled", "#cbd3dc"),
    ],
    ("bg", "primary"): [
        ("color-primary", "#1d5f88"),
        ("color-primary-hover", "#174c6d"),
        ("color-primary-active", "#133f59"),
        ("color-primary-softer", "#eef7fb"),
        ("color-primary-soft", "#e2eef6"),
    ],
    ("bg", "danger"): [
        ("color-danger", "#8b3030"),
        ("color-danger-hover", "#7a2929"),
        ("color-danger-strong", "#6f2525"),
        ("color-danger-soft", "#fdf1f1"),
    ],
    ("bg", "success"): [
        ("color-success", "#27633f"),
        ("color-success-hover", "#205233"),
        ("color-success-soft", "#eef8f2"),
    ],
    ("bg", "warning"): [
        ("color-warning", "#a15309"),
        ("color-warning-soft", "#fff8e7"),
    ],
    ("bg", "pink"): [("color-pink-soft", "#fde7ef"), ("color-pink", "#d88ba6")],
    ("border", "neutral"): [
        ("color-border-subtle", "#e3e9f0"),
        ("color-border-default", "#c6ced8"),
        ("color-border-strong", "#9aa8b8"),
        ("color-border-emphasis", "#7d91a8"),
    ],
    ("border", "primary"): [
        ("color-primary-border", "#c7dcea"),
        ("color-primary", "#1d5f88"),
        ("color-border-default", "#c6ced8"),
    ],
    ("border", "danger"): [
        ("color-danger-border", "#dca5a5"),
        ("color-danger", "#8b3030"),
    ],
    ("border", "success"): [("color-success-border", "#8bb99f"), ("color-success", "#27633f")],
    ("border", "warning"): [("color-warning-border", "#d3bd92")],
    ("border", "pink"): [("color-pink", "#d88ba6")],
}

HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RGBA_RE = re.compile(r"rgba?\([^)]*\)")
DECL_RE = re.compile(r"^\s*([\w-]+)\s*:\s*(.+?)\s*;?\s*$")

# 精确匹配的非阴影 rgba → token
EXACT_RGBA = {
    "rgba(18, 30, 48, 0.38)": "color-scrim",
    "rgb(31 45 61 / 32%)": "color-scrim-soft",
    "rgb(255 255 255 / 94%)": "color-surface-alpha",
    "rgb(247 249 252 / 96%)": "color-surface-alpha",
    "rgb(255 255 255 / 48%)": "color-surface-alpha-faint",
    "rgb(71 85 105 / 32%)": "color-border-alpha",
    "rgb(71 85 105 / 34%)": "color-border-alpha",
    "rgb(232 241 248 / 72%)": "color-primary-fill-soft",
    "rgb(45 111 143 / 18%)": "focus-ring-primary",
}


def hue_family(hex_color: str) -> str:
    r, g, b = rgb_of(hex_color)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    deg = h * 360
    # 蓝灰调（深藏青文本/浅灰边框）饱和度偏低时归为中性色；
    # 真正的强调色（primary 蓝、success 绿等）饱和度更高，不受影响。
    if 190 <= deg < 265 and s < 0.45:
        return "neutral"
    if s < 0.20:
        return "neutral"
    if deg < 20 or deg >= 345:
        return "danger"
    if deg < 60:
        return "warning"
    if deg < 80:
        return "warning"
    if deg < 165:
        return "success"
    if deg < 265:
        return "primary"
    if deg < 345:
        return "pink"
    return "danger"


def context_of(prop: str) -> str:
    if prop == "color" or prop in {"fill", "stroke", "caret-color"}:
        return "text"
    if prop.startswith("background"):
        return "bg"
    if prop.startswith("border") or prop.startswith("outline"):
        return "border"
    return "text"


def distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def nearest_token(prop: str, hex_color: str) -> str:
    ctx = context_of(prop)
    fam = hue_family(hex_color)
    anchors = ANCHORS.get((ctx, fam)) or ANCHORS[(ctx, "neutral")]
    color = rgb_of(hex_color)
    best = min(anchors, key=lambda a: distance(color, rgb_of(a[1])))
    return best[0]


def shadow_token_for_layer(layer: str) -> str:
    """把单层阴影映射到阴影/焦点环 token。"""
    layer = layer.strip()
    if "inset" in layer:
        if HEX_RE.search(layer) and layer.startswith("inset 3px 0 0"):
            return f"inset 3px 0 0 var(--color-primary)"
        return "var(--shadow-inset-highlight)"
    match = re.search(r"0 0 0 (\d)px", layer)
    if match:  # 焦点环
        color_match = RGBA_RE.search(layer)
        if color_match:
            nums = re.findall(r"\d+", color_match.group(0))[:3]
            rgb_tuple = tuple(int(n) for n in nums)
            if distance(rgb_tuple, (29, 95, 136)) < 120 or distance(rgb_tuple, (59, 130, 246)) < 150:
                return "var(--focus-ring-primary)"
            if distance(rgb_tuple, (139, 48, 48)) < 150:
                return "var(--focus-ring-danger)"
            if distance(rgb_tuple, (15, 118, 110)) < 150:
                return "var(--focus-ring-success)"
        return "var(--focus-ring-primary)"
    blur_match = re.search(r"\b(\d+)px(?:\s+(\d+)px)?", layer)
    blur = 0
    if blur_match:
        parts = re.findall(r"(\d+)px", layer)
        blur = int(parts[1]) if len(parts) >= 2 else int(parts[0])
    if blur <= 4:
        return "var(--shadow-xs)"
    if blur <= 12:
        return "var(--shadow-sm)"
    if blur <= 28:
        return "var(--shadow-md)"
    if blur <= 48:
        return "var(--shadow-lg)"
    return "var(--shadow-pop)"


def migrate_shadow(value: str) -> str:
    if value.strip() == "none":
        return value
    layers = re.split(r",(?![^()]*\))", value)
    return ", ".join(shadow_token_for_layer(layer) for layer in layers)


def migrate_value(prop: str, value: str, stats: dict) -> str:
    if prop in {"box-shadow", "text-shadow"}:
        new = migrate_shadow(value)
        if new != value:
            stats["shadow"] = stats.get("shadow", 0) + 1
        return new

    def hex_sub(m: re.Match) -> str:
        token = nearest_token(prop, m.group(0))
        stats[f"--{token}"] = stats.get(f"--{token}", 0) + 1
        return f"var(--{token})"

    def rgba_sub(m: re.Match) -> str:
        raw = m.group(0)
        token = EXACT_RGBA.get(raw)
        if token is None:
            stats.setdefault("unmapped_rgba", [])
            if raw not in stats["unmapped_rgba"]:
                stats["unmapped_rgba"].append(raw)
            return raw
        stats[f"--{token}"] = stats.get(f"--{token}", 0) + 1
        return f"var(--{token})"

    value = HEX_RE.sub(hex_sub, value)
    value = RGBA_RE.sub(rgba_sub, value)
    return value


def token_block() -> str:
    light_lines = []
    dark_lines = []
    for name, (light, dark) in TOKENS.items():
        light_lines.append(f"  --{name}: {light};")
        dark_lines.append(f"  --{name}: {dark};")
    return (
        ":root {\n" + "\n".join(light_lines) + "\n}\n\n"
        '[data-theme="dark"] {\n' + "\n".join(dark_lines) + "\n}\n"
    )


def main() -> None:
    write = "--write" in sys.argv
    css = CSS_PATH.read_text(encoding="utf-8")
    lines = css.splitlines(keepends=True)
    stats: dict = {}
    out: list[str] = []
    for line in lines:
        m = DECL_RE.match(line.rstrip("\n"))
        if m and (HEX_RE.search(m.group(2)) or RGBA_RE.search(m.group(2))):
            prop, value = m.group(1), m.group(2)
            new_value = migrate_value(prop, value, stats)
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}{prop}: {new_value};\n")
        else:
            out.append(line)
    result = token_block() + "\n" + "".join(out)
    if write:
        CSS_PATH.write_text(result, encoding="utf-8")
        print(f"已写入 {CSS_PATH}")
    remaining = HEX_RE.findall("".join(out))
    print(f"剩余硬编码 hex: {len(remaining)}")
    print("未映射 rgba:", stats.get("unmapped_rgba", []))
    print(f"阴影替换: {stats.get('shadow', 0)}")
    top = sorted((k, v) for k, v in stats.items() if k.startswith("--"))
    for k, v in top[:50]:
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
