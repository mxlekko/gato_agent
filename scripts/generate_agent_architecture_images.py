from __future__ import annotations

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "architecture-images"

CANVAS_WIDTH = 1800
CANVAS_HEIGHT = 1080

BG_TOP = (248, 243, 232)
BG_BOTTOM = (236, 246, 250)
INK = (23, 33, 48)
MUTED = (84, 97, 118)
LINE = (114, 133, 166)
SHADOW = (36, 48, 71, 52)

NAVY = (31, 56, 102)
BLUE = (69, 113, 196)
TEAL = (51, 141, 145)
AMBER = (213, 141, 62)
ROSE = (189, 96, 104)
MOSS = (97, 135, 86)

WHITE = (255, 255, 255)
PANEL = (255, 252, 248)
PANEL_ALT = (248, 251, 255)
PANEL_SOFT = (247, 250, 244)
PANEL_WARM = (255, 248, 239)
PANEL_MINT = (239, 248, 244)
PANEL_BLUE = (239, 244, 252)
PANEL_ROSE = (252, 242, 243)


def pick_font(*candidates: str) -> str:
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError("No usable system font found for image rendering.")


BODY_FONT_PATH = pick_font(
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
)

HEADING_FONT_PATH = pick_font(
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
)


def font(size: int, heading: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(HEADING_FONT_PATH if heading else BODY_FONT_PATH, size=size)


TITLE_FONT = font(56, heading=True)
SUBTITLE_FONT = font(24)
SECTION_FONT = font(32, heading=True)
CARD_TITLE_FONT = font(26, heading=True)
CARD_BODY_FONT = font(18)
SMALL_FONT = font(16)
TAG_FONT = font(16, heading=True)
STEP_NO_FONT = font(26, heading=True)
STEP_TITLE_FONT = font(24, heading=True)
STEP_BODY_FONT = font(16)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        color = (
            lerp(BG_TOP[0], BG_BOTTOM[0], t),
            lerp(BG_TOP[1], BG_BOTTOM[1], t),
            lerp(BG_TOP[2], BG_BOTTOM[2], t),
            255,
        )
        draw.line((0, y, width, y), fill=color)

    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    o = ImageDraw.Draw(overlay)
    o.ellipse((-80, -60, 520, 420), fill=(255, 255, 255, 120))
    o.ellipse((1320, -120, 1920, 420), fill=(222, 236, 255, 115))
    o.ellipse((1080, 690, 1880, 1320), fill=(255, 238, 214, 105))
    o.ellipse((-120, 760, 700, 1450), fill=(222, 244, 237, 95))
    return Image.alpha_composite(image, overlay)


def with_alpha(color: tuple[int, int, int], alpha: int) -> tuple[int, int, int, int]:
    return color[0], color[1], color[2], alpha


def draw_shadow(base: Image.Image, bbox: tuple[int, int, int, int], radius: int, offset: tuple[int, int] = (0, 12)) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    left, top, right, bottom = bbox
    dx, dy = offset
    draw.rounded_rectangle((left + dx, top + dy, right + dx, bottom + dy), radius=radius, fill=SHADOW)
    layer = layer.filter(ImageFilter.GaussianBlur(16))
    base.alpha_composite(layer)


def draw_panel(
    base: Image.Image,
    bbox: tuple[int, int, int, int],
    fill: tuple[int, int, int],
    outline: tuple[int, int, int],
    radius: int = 28,
    width: int = 2,
) -> None:
    draw_shadow(base, bbox, radius)
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle(bbox, radius=radius, fill=fill, outline=outline, width=width)


def text_length(draw: ImageDraw.ImageDraw, text: str, use_font: ImageFont.FreeTypeFont) -> float:
    return draw.textlength(text, font=use_font)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, use_font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        current = ""
        tokens = re.findall(r"[A-Za-z0-9_./:+-]+|\s+|.", paragraph)
        for token in tokens:
            candidate = current + token
            if current and text_length(draw, candidate, use_font) > max_width:
                if text_length(draw, token, use_font) > max_width:
                    for char in token:
                        char_candidate = current + char
                        if current and text_length(draw, char_candidate, use_font) > max_width:
                            lines.append(current.rstrip())
                            current = "" if char == " " else char
                        else:
                            current = char_candidate
                    continue
                lines.append(current.rstrip())
                current = "" if token.isspace() else token
            else:
                current = candidate
        if current:
            lines.append(current.rstrip())
    return lines or [""]


def draw_text_block(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    use_font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    max_width: int,
    line_gap: int = 8,
) -> int:
    x, y = xy
    line_height = use_font.size + line_gap
    lines = wrap_text(draw, text, use_font, max_width)
    current_y = y
    for line in lines:
        draw.text((x, current_y), line, font=use_font, fill=fill)
        current_y += line_height
    return current_y


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    x_center: int,
    y: int,
    text: str,
    use_font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
) -> int:
    bbox = draw.textbbox((0, 0), text, font=use_font)
    width = bbox[2] - bbox[0]
    draw.text((x_center - width / 2, y), text, font=use_font, fill=fill)
    return bbox[3] - bbox[1]


def draw_tag(
    base: Image.Image,
    xy: tuple[int, int],
    text: str,
    fill: tuple[int, int, int],
    text_fill: tuple[int, int, int] = INK,
    h_pad: int = 20,
    v_pad: int = 10,
) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(base)
    bbox = draw.textbbox((0, 0), text, font=TAG_FONT)
    width = int(bbox[2] - bbox[0] + h_pad * 2)
    height = int(bbox[3] - bbox[1] + v_pad * 2)
    x, y = xy
    rect = (x, y, x + width, y + height)
    draw.rounded_rectangle(rect, radius=height // 2, fill=fill, outline=fill)
    draw.text((x + h_pad, y + v_pad - 2), text, font=TAG_FONT, fill=text_fill)
    return rect


def draw_card(
    base: Image.Image,
    bbox: tuple[int, int, int, int],
    title: str,
    body: str,
    accent: tuple[int, int, int],
    fill: tuple[int, int, int] = WHITE,
    badge: str | None = None,
) -> None:
    draw_panel(base, bbox, fill=fill, outline=with_alpha(accent, 155)[:3], radius=28)
    draw = ImageDraw.Draw(base)
    left, top, right, bottom = bbox
    draw.rounded_rectangle((left + 18, top + 18, left + 34, bottom - 18), radius=8, fill=accent)
    title_x = left + 54
    title_y = top + 28
    title_max_width = right - title_x - 26
    if badge:
        badge_bbox = draw_tag(base, (right - 138, top + 24), badge, with_alpha(accent, 40)[:3], text_fill=accent, h_pad=16, v_pad=8)
        title_max_width = badge_bbox[0] - title_x - 20
    body_y = draw_text_block(draw, (title_x, title_y), title, CARD_TITLE_FONT, INK, title_max_width, line_gap=6) + 14
    draw_text_block(draw, (title_x, body_y), body, CARD_BODY_FONT, MUTED, right - title_x - 26, line_gap=8)


def draw_container(
    base: Image.Image,
    bbox: tuple[int, int, int, int],
    title: str,
    accent: tuple[int, int, int],
    fill: tuple[int, int, int],
    title_fill: tuple[int, int, int] = WHITE,
) -> None:
    draw_panel(base, bbox, fill=fill, outline=with_alpha(accent, 130)[:3], radius=34, width=3)
    draw_tag(base, (bbox[0] + 24, bbox[1] - 22), title, accent, text_fill=title_fill, h_pad=18, v_pad=8)


def draw_number_step(
    base: Image.Image,
    bbox: tuple[int, int, int, int],
    number: int,
    title: str,
    body: str,
    accent: tuple[int, int, int],
    fill: tuple[int, int, int] = WHITE,
) -> None:
    draw_panel(base, bbox, fill=fill, outline=with_alpha(accent, 155)[:3], radius=28)
    draw = ImageDraw.Draw(base)
    left, top, _, _ = bbox
    draw.rounded_rectangle((left + 18, top + 18, left + 34, bbox[3] - 18), radius=8, fill=accent)
    text_x = left + 76
    draw.text((text_x, top + 18), title, font=STEP_TITLE_FONT, fill=INK)
    draw.text((text_x, top + 54), body, font=STEP_BODY_FONT, fill=MUTED)
    circle = (left + 20, top - 18, left + 74, top + 36)
    draw_shadow(base, circle, radius=27, offset=(0, 6))
    draw.ellipse(circle, fill=accent, outline=accent)
    number_text = f"{number:02d}"
    nb = draw.textbbox((0, 0), number_text, font=STEP_NO_FONT)
    draw.text((left + 47 - (nb[2] - nb[0]) / 2, top - 7), number_text, font=STEP_NO_FONT, fill=WHITE)


def draw_segment(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    fill: tuple[int, int, int],
    width: int,
    dashed: bool = False,
) -> None:
    if dashed:
        total = math.dist(start, end)
        if total == 0:
            return
        dx = (end[0] - start[0]) / total
        dy = (end[1] - start[1]) / total
        dash = 18
        gap = 12
        progress = 0.0
        while progress < total:
            seg_start = progress
            seg_end = min(progress + dash, total)
            x1 = start[0] + dx * seg_start
            y1 = start[1] + dy * seg_start
            x2 = start[0] + dx * seg_end
            y2 = start[1] + dy * seg_end
            draw.line((x1, y1, x2, y2), fill=fill, width=width)
            progress += dash + gap
        return

    draw.line((start, end), fill=fill, width=width)


def draw_arrowhead(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    fill: tuple[int, int, int],
    size: int = 18,
) -> None:
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    left = (
        end[0] - size * math.cos(angle - math.pi / 7),
        end[1] - size * math.sin(angle - math.pi / 7),
    )
    right = (
        end[0] - size * math.cos(angle + math.pi / 7),
        end[1] - size * math.sin(angle + math.pi / 7),
    )
    draw.polygon([end, left, right], fill=fill)


def draw_connector(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    fill: tuple[int, int, int] = LINE,
    width: int = 6,
    dashed: bool = False,
) -> None:
    if len(points) < 2:
        return
    for idx in range(len(points) - 1):
        draw_segment(draw, points[idx], points[idx + 1], fill=fill, width=width, dashed=dashed)
    draw_arrowhead(draw, points[-2], points[-1], fill=fill)


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    fill: tuple[int, int, int] = LINE,
    width: int = 6,
    dashed: bool = False,
) -> None:
    if dashed:
        total = math.dist(start, end)
        if total == 0:
            return
        dx = (end[0] - start[0]) / total
        dy = (end[1] - start[1]) / total
        dash = 18
        gap = 12
        progress = 0.0
        while progress < total:
            seg_start = progress
            seg_end = min(progress + dash, total)
            x1 = start[0] + dx * seg_start
            y1 = start[1] + dy * seg_start
            x2 = start[0] + dx * seg_end
            y2 = start[1] + dy * seg_end
            draw.line((x1, y1, x2, y2), fill=fill, width=width)
            progress += dash + gap
    else:
        draw.line((start, end), fill=fill, width=width)

    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    arrow_size = 18
    left = (
        end[0] - arrow_size * math.cos(angle - math.pi / 7),
        end[1] - arrow_size * math.sin(angle - math.pi / 7),
    )
    right = (
        end[0] - arrow_size * math.cos(angle + math.pi / 7),
        end[1] - arrow_size * math.sin(angle + math.pi / 7),
    )
    draw.polygon([end, left, right], fill=fill)


def draw_elbow_arrow(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    fill: tuple[int, int, int] = LINE,
    width: int = 6,
    dashed: bool = False,
) -> None:
    for idx in range(len(points) - 1):
        draw_arrow(draw, points[idx], points[idx + 1], fill=fill, width=width, dashed=dashed if idx == len(points) - 2 else False)


def add_header(base: Image.Image, title: str, subtitle: str, tags: list[tuple[str, tuple[int, int, int]]]) -> None:
    draw = ImageDraw.Draw(base)
    header_box = (48, 36, CANVAS_WIDTH - 48, 214)
    draw_panel(base, header_box, fill=NAVY, outline=NAVY, radius=40, width=0)
    draw_centered_text(draw, CANVAS_WIDTH // 2, 72, title, TITLE_FONT, WHITE)
    draw_centered_text(draw, CANVAS_WIDTH // 2, 144, subtitle, SUBTITLE_FONT, (224, 234, 252))

    current_x = 82
    for text, color in tags:
        rect = draw_tag(base, (current_x, 232), text, color, text_fill=INK if color != NAVY else WHITE)
        current_x = rect[2] + 16


def add_footer(base: Image.Image, text: str) -> None:
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle((48, CANVAS_HEIGHT - 92, CANVAS_WIDTH - 48, CANVAS_HEIGHT - 34), radius=24, fill=WHITE, outline=(219, 226, 236), width=2)
    draw_text_block(draw, (76, CANVAS_HEIGHT - 77), text, SMALL_FONT, MUTED, CANVAS_WIDTH - 160, line_gap=6)


def build_overview_image() -> Path:
    base = gradient_background((CANVAS_WIDTH, CANVAS_HEIGHT))
    draw = ImageDraw.Draw(base)
    add_header(
        base,
        "本地 API / Platform Gateway / LangGraph 架构框图",
        "强调部署边界、职责归属，以及请求与回包的项目内主链路",
        [
            ("当前入口：POST /api/agent/run", PANEL_WARM),
            ("scene-config 驱动", PANEL_BLUE),
            ("Runtime：LangGraph StateGraph", PANEL_MINT),
        ],
    )

    caller_box = (76, 430, 300, 620)
    local_domain = (360, 314, 1720, 866)
    api_box = (430, 410, 720, 602)
    gateway_box = (790, 410, 1060, 602)
    agent_domain = (1120, 368, 1656, 626)
    agent_box = (1170, 430, 1606, 596)
    api_resp = (430, 668, 720, 812)
    gateway_resp = (790, 668, 1060, 812)
    agent_resp = (1120, 668, 1656, 812)

    draw_card(base, caller_box, "调用方", "业务系统 / 前端 / 内部服务\n只感知统一 API\n提交 scene + bizParams", BLUE, PANEL_BLUE)
    draw_container(base, local_domain, "本机部署域", NAVY, with_alpha(NAVY, 18)[:3])
    draw_container(base, agent_domain, "项目内运行域", AMBER, with_alpha(AMBER, 18)[:3], title_fill=WHITE)

    draw_card(base, api_box, "本地 API 服务", "server.js + routes/agent.js\n对外统一入口\n负责桥接而不做业务清洗", TEAL, PANEL_MINT, badge="API")
    draw_card(base, gateway_box, "Platform Gateway", "按 scene-config 决策\n统一进入 langgraph\n记录 routePlan", NAVY, PANEL_ALT, badge="gateway")
    draw_card(base, agent_box, "LangGraph Runtime", "编译 BusinessSkill + Template\n调度平台节点\n返回标准 result state", AMBER, PANEL_WARM, badge="graph")

    draw_card(base, api_resp, "API 负责什么", "校验请求\n读取 scene-config\n组装 runtime body\n解析返回并统一回包", TEAL, WHITE)
    draw_card(base, gateway_resp, "Gateway 负责什么", "执行 routing 策略\n统一 LangGraph 主链路\n不承载业务判断", NAVY, WHITE)
    draw_card(base, agent_resp, "Runtime 负责什么", "加载 workflow contract\n调用数据/LLM/校验节点\n产出统一 envelope", AMBER, WHITE)

    draw_connector(draw, [(300, 524), (430, 524)], fill=BLUE, width=7)
    draw_connector(draw, [(720, 524), (790, 524)], fill=TEAL, width=7)
    draw_connector(draw, [(1060, 524), (1170, 524)], fill=NAVY, width=7)

    draw_tag(base, (332, 470), "HTTP POST /api/agent/run", PANEL_BLUE, text_fill=BLUE, h_pad=16, v_pad=8)
    draw_tag(base, (715, 470), "routePlan", PANEL_MINT, text_fill=TEAL, h_pad=16, v_pad=8)
    draw_tag(base, (1050, 470), "执行项目内 LangGraph", PANEL_WARM, text_fill=AMBER, h_pad=16, v_pad=8)

    draw_connector(draw, [(1390, 596), (1390, 902), (575, 902), (575, 812)], fill=ROSE, width=6, dashed=True)
    draw_connector(draw, [(430, 740), (300, 740)], fill=ROSE, width=6, dashed=True)
    draw_tag(base, (930, 872), "Runtime -> API：标准 result state", PANEL_ROSE, text_fill=ROSE, h_pad=16, v_pad=8)
    draw_tag(base, (108, 770), "API -> 调用方：统一 HTTP response", PANEL_ROSE, text_fill=ROSE, h_pad=16, v_pad=8)

    draw_tag(base, (1188, 346), "scene 绑定 BusinessSkill 与模板", PANEL_WARM, text_fill=AMBER, h_pad=16, v_pad=8)
    draw_tag(base, (480, 336), "第二张图展开 node / tool / reference", PANEL_BLUE, text_fill=BLUE, h_pad=16, v_pad=8)

    add_footer(base, "宏观上只有一条主链：调用方 -> 本地 API -> Platform Gateway -> LangGraph Runtime；回程由 Runtime 产出标准 state，API 再统一封装给调用方。")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "agent-overview-chain.png"
    base.save(output_path)
    return output_path


def build_sales_internal_image() -> Path:
    base = gradient_background((CANVAS_WIDTH, CANVAS_HEIGHT))
    draw = ImageDraw.Draw(base)
    add_header(
        base,
        "sales-opportunity-advisor 架构框图",
        "明确 skill、tool、reference、DB 的边界，以及谁驱动谁",
        [
            ("scene：sales-opportunity-advisor", PANEL_WARM),
            ("skill：sales_opportunity_advisor", PANEL_BLUE),
            ("主驱动者：skill", PANEL_MINT),
        ],
    )

    local_domain = (54, 302, 1748, 936)
    agent_domain = (364, 368, 1126, 846)
    tool_domain = (1180, 368, 1700, 846)
    input_box = (84, 404, 328, 560)
    reference_box = (84, 620, 328, 826)
    skill_box = (422, 432, 1068, 780)
    data_tool_box = (1218, 408, 1660, 586)
    sql_box = (1270, 614, 1608, 704)
    model_tool_box = (1218, 728, 1660, 906)
    draw_container(base, local_domain, "本机运行域", NAVY, with_alpha(NAVY, 16)[:3])
    draw_container(base, agent_domain, "Agent 域：sales-agent", NAVY, with_alpha(BLUE, 18)[:3])
    draw_container(base, tool_domain, "Tool 域", TEAL, with_alpha(TEAL, 16)[:3])

    draw_card(base, input_box, "运行时输入", "来自 API / Gateway\nwrapped request\n含 requestId / scene /\nopportunityId", BLUE, PANEL_BLUE)
    draw_card(base, reference_box, "Reference 文件", "dictionary.tsv\ndecision_rules.md\noutput_schema.json\n\n供 skill 读取\n不主动执行", MOSS, PANEL_SOFT, badge="reference")
    draw_card(base, skill_box, "主 Skill：sales_opportunity_advisor", "skill 是当前场景的主驱动者。\n负责业务编排，并决定何时读取 reference、何时调用 data tool、何时调用 model tool。", AMBER, PANEL_WARM, badge="main skill")
    draw_card(base, data_tool_box, "ContextHelper", "输入：requestId + opportunityId\n职责：只读查数，只返回 rawRow\n不负责：字段清洗 / 建议生成", TEAL, PANEL_MINT, badge="data tool")
    draw_card(base, sql_box, "SQL Server", "ERP_yfb / t_sales_opportunity\n只读 SELECT", NAVY, PANEL_ALT)
    draw_card(base, model_tool_box, "ModelTool", "输入：scene + payload + schema\n职责：校验结构并轻量规范化\n不负责：取数 / 业务建议", AMBER, PANEL_WARM, badge="model tool")

    skill_mod_1 = (460, 588, 644, 708)
    skill_mod_2 = (654, 588, 838, 708)
    skill_mod_3 = (848, 588, 1032, 708)
    draw_card(base, skill_mod_1, "请求解析与编排", "解析 runtime request\n校验 scene / kind / version", BLUE, WHITE)
    draw_card(base, skill_mod_2, "字段清洗与映射", "读取字典\n生成 profile / facts", TEAL, WHITE)
    draw_card(base, skill_mod_3, "建议组装与封装", "形成 advice payload\n返回 wrapped result", ROSE, WHITE)
    draw_tag(base, (474, 730), "Skill 主动驱动 ContextHelper 与 ModelTool", PANEL_WARM, text_fill=AMBER, h_pad=18, v_pad=8)
    draw_tag(base, (452, 544), "Skill 负责什么", PANEL_BLUE, text_fill=BLUE, h_pad=18, v_pad=8)

    draw_tag(base, (88, 842), "Reference 只提供字典 / 规则 / schema", PANEL_SOFT, text_fill=MOSS, h_pad=16, v_pad=8)
    draw_tag(base, (540, 936), "实线 = skill 主动调用；虚线 = skill 本地读取", WHITE, text_fill=MUTED, h_pad=16, v_pad=8)

    draw_connector(draw, [(328, 484), (422, 484)], fill=BLUE, width=7)
    draw_tag(base, (336, 438), "runtime request", PANEL_BLUE, text_fill=BLUE, h_pad=16, v_pad=8)

    draw_connector(draw, [(328, 700), (380, 700), (380, 652), (422, 652)], fill=MOSS, width=6, dashed=True)
    draw_tag(base, (210, 646), "skill 读取 dictionary / rules / schema", PANEL_SOFT, text_fill=MOSS, h_pad=14, v_pad=8)

    draw_connector(draw, [(1068, 516), (1218, 516)], fill=TEAL, width=7)
    draw_tag(base, (1030, 462), "skill 驱动 data tool", PANEL_MINT, text_fill=TEAL, h_pad=16, v_pad=8)

    draw_connector(draw, [(1218, 548), (1068, 548)], fill=TEAL, width=7)
    draw_tag(base, (1050, 560), "返回 rawRow", PANEL_MINT, text_fill=TEAL, h_pad=16, v_pad=8)

    draw_connector(draw, [(1334, 586), (1334, 614)], fill=NAVY, width=7)
    draw_connector(draw, [(1544, 614), (1544, 586)], fill=NAVY, width=7)
    draw_tag(base, (1276, 590), "SELECT", PANEL_ALT, text_fill=NAVY, h_pad=16, v_pad=8)
    draw_tag(base, (1468, 712), "rawRow", PANEL_ALT, text_fill=NAVY, h_pad=16, v_pad=8)

    draw_connector(draw, [(1068, 742), (1218, 742)], fill=AMBER, width=7)
    draw_tag(base, (1040, 694), "skill 驱动 model tool", PANEL_WARM, text_fill=AMBER, h_pad=16, v_pad=8)

    draw_connector(draw, [(1218, 776), (1068, 776)], fill=AMBER, width=7)
    draw_tag(base, (1028, 788), "返回 validated payload / error", PANEL_WARM, text_fill=AMBER, h_pad=16, v_pad=8)

    draw_connector(draw, [(744, 780), (744, 878)], fill=ROSE, width=7)
    draw_tag(base, (620, 868), "返回 API / Gateway：wrapped result JSON", PANEL_ROSE, text_fill=ROSE, h_pad=16, v_pad=8)

    add_footer(base, "这个场景里，真正负责业务编排的是主 Skill。ContextHelper 只是 data tool，ModelTool 只是 validation tool，Reference 文件只提供静态依据，SQL 只承接只读查询。")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "sales-opportunity-advisor-internal-flow.png"
    base.save(output_path)
    return output_path


def main() -> None:
    overview = build_overview_image()
    internal = build_sales_internal_image()
    print(overview)
    print(internal)


if __name__ == "__main__":
    main()
