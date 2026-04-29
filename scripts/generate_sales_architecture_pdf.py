from __future__ import annotations

import html
import math
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_FILE = OUTPUT_DIR / "销售机会推进建议系统架构与数据流图.pdf"

PAGE_WIDTH, PAGE_HEIGHT = landscape(A4)
MARGIN_X = 26
MARGIN_Y = 18

BG = colors.HexColor("#F6F8FB")
TITLE_BG = colors.HexColor("#153E75")
TITLE_TEXT = colors.white
TEXT = colors.HexColor("#1C2733")
MUTED = colors.HexColor("#5B6673")
BORDER = colors.HexColor("#D5DDE8")
ARROW = colors.HexColor("#5378A8")
BLUE = colors.HexColor("#DDEBFF")
GREEN = colors.HexColor("#DFF3EA")
ORANGE = colors.HexColor("#FFF0D9")
TEAL = colors.HexColor("#D8F0F4")
ROSE = colors.HexColor("#FDE5E6")
YELLOW = colors.HexColor("#FFF7C7")


def register_fonts() -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))


def clone_style(style: ParagraphStyle, name: str, **kwargs) -> ParagraphStyle:
    return ParagraphStyle(name=name, parent=style, **kwargs)


def make_styles() -> dict[str, ParagraphStyle]:
    base = ParagraphStyle(
        name="base",
        fontName="STSong-Light",
        fontSize=9.3,
        leading=13.2,
        textColor=TEXT,
        wordWrap="CJK",
    )
    return {
        "hero": clone_style(
            base,
            "hero",
            fontSize=22,
            leading=28,
            textColor=TITLE_TEXT,
        ),
        "subtitle": clone_style(
            base,
            "subtitle",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#E9EEF8"),
        ),
        "section": clone_style(
            base,
            "section",
            fontSize=14,
            leading=18,
            textColor=TITLE_TEXT,
        ),
        "card_title": clone_style(
            base,
            "card_title",
            fontSize=12.4,
            leading=16,
            textColor=TEXT,
        ),
        "card_body": clone_style(base, "card_body", fontSize=9.2, leading=13.3),
        "small": clone_style(base, "small", fontSize=8.3, leading=11.5, textColor=MUTED),
        "tiny": clone_style(base, "tiny", fontSize=7.6, leading=10.5, textColor=MUTED),
        "tag": clone_style(
            base,
            "tag",
            fontSize=9.1,
            leading=11.5,
            textColor=colors.HexColor("#29425F"),
        ),
    }


def ptext(content: str | list[str]) -> str:
    if isinstance(content, str):
        return html.escape(content).replace("\n", "<br/>")
    return "<br/>".join(html.escape(line) for line in content)


def draw_paragraph(
    c: canvas.Canvas,
    text: str,
    style: ParagraphStyle,
    x: float,
    y: float,
    width: float,
    height: float,
    min_font_size: float = 7.2,
) -> float:
    font_size = style.fontSize
    leading_ratio = style.leading / style.fontSize
    paragraph = Paragraph(text, style)
    _, needed = paragraph.wrap(width, height)
    while needed > height and font_size > min_font_size:
        font_size -= 0.3
        trial = clone_style(
            style,
            f"{style.name}_{font_size:.1f}",
            fontSize=font_size,
            leading=max(font_size * leading_ratio, font_size + 2),
        )
        paragraph = Paragraph(text, trial)
        _, needed = paragraph.wrap(width, height)
    paragraph.drawOn(c, x, y + height - needed)
    return needed


def draw_round_box(
    c: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    fill: colors.Color,
    stroke: colors.Color = BORDER,
    radius: float = 14,
    line_width: float = 1,
) -> None:
    c.saveState()
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(line_width)
    c.roundRect(x, y, width, height, radius, stroke=1, fill=1)
    c.restoreState()


def draw_card(
    c: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    body: str | list[str],
    fill: colors.Color,
    accent: colors.Color,
    badge: str | None = None,
    title_style: ParagraphStyle | None = None,
    body_style: ParagraphStyle | None = None,
) -> None:
    draw_round_box(c, x, y, width, height, fill=fill)
    c.saveState()
    c.setStrokeColor(accent)
    c.setLineWidth(3)
    c.line(x + 12, y + height - 15, x + width - 12, y + height - 15)
    c.restoreState()
    if badge:
        draw_tag(c, styles, x + width - 70, y + height - 28, 56, 16, badge, YELLOW)
    draw_paragraph(c, ptext(title), title_style or styles["card_title"], x + 12, y + height - 56, width - 24, 30)
    draw_paragraph(c, ptext(body), body_style or styles["card_body"], x + 12, y + 12, width - 24, height - 56)


def draw_tag(
    c: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    x: float,
    y: float,
    width: float,
    height: float,
    text: str,
    fill: colors.Color,
) -> None:
    draw_round_box(c, x, y, width, height, fill=fill, stroke=fill, radius=8)
    draw_paragraph(c, ptext(text), styles["tag"], x + 6, y + 2, width - 12, height - 4)


def draw_arrow(
    c: canvas.Canvas,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    dashed: bool = False,
    label: str | None = None,
) -> None:
    c.saveState()
    c.setStrokeColor(ARROW)
    c.setFillColor(ARROW)
    c.setLineWidth(2)
    if dashed:
        c.setDash(5, 4)
    c.line(x1, y1, x2, y2)
    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_size = 7
    c.line(
        x2,
        y2,
        x2 - arrow_size * math.cos(angle - math.pi / 6),
        y2 - arrow_size * math.sin(angle - math.pi / 6),
    )
    c.line(
        x2,
        y2,
        x2 - arrow_size * math.cos(angle + math.pi / 6),
        y2 - arrow_size * math.sin(angle + math.pi / 6),
    )
    if label:
        mid_x = (x1 + x2) / 2
        mid_y = (y1 + y2) / 2
        draw_tag(c, STYLES, mid_x - 34, mid_y + 8, 68, 16, label, colors.white)
    c.restoreState()


def draw_elbow_arrow(
    c: canvas.Canvas,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    via_x: float | None = None,
    via_y: float | None = None,
    dashed: bool = False,
) -> None:
    c.saveState()
    c.setStrokeColor(ARROW)
    c.setFillColor(ARROW)
    c.setLineWidth(2)
    if dashed:
        c.setDash(5, 4)
    if via_x is not None:
        c.line(x1, y1, via_x, y1)
        c.line(via_x, y1, via_x, y2)
        c.line(via_x, y2, x2, y2)
    elif via_y is not None:
        c.line(x1, y1, x1, via_y)
        c.line(x1, via_y, x2, via_y)
        c.line(x2, via_y, x2, y2)
    else:
        c.line(x1, y1, x2, y2)
    angle = math.atan2(y2 - (via_y if via_y is not None else y1), x2 - (via_x if via_x is not None else x1))
    arrow_size = 7
    c.line(
        x2,
        y2,
        x2 - arrow_size * math.cos(angle - math.pi / 6),
        y2 - arrow_size * math.sin(angle - math.pi / 6),
    )
    c.line(
        x2,
        y2,
        x2 - arrow_size * math.cos(angle + math.pi / 6),
        y2 - arrow_size * math.sin(angle + math.pi / 6),
    )
    c.restoreState()


def draw_page_shell(c: canvas.Canvas, title: str, page_no: int) -> None:
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
    c.setFillColor(TITLE_BG)
    c.roundRect(18, PAGE_HEIGHT - 72, PAGE_WIDTH - 36, 54, 18, stroke=0, fill=1)
    draw_paragraph(c, ptext(title), STYLES["section"], 34, PAGE_HEIGHT - 62, 440, 28)
    draw_paragraph(
        c,
        ptext("来源文档：销售机会推进建议系统架构.md"),
        STYLES["subtitle"],
        34,
        PAGE_HEIGHT - 82,
        360,
        20,
    )
    c.setFillColor(colors.HexColor("#EDF2FA"))
    c.circle(PAGE_WIDTH - 52, PAGE_HEIGHT - 45, 16, stroke=0, fill=1)
    c.setFillColor(TITLE_BG)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(PAGE_WIDTH - 52, PAGE_HEIGHT - 49, str(page_no))
    c.setStrokeColor(colors.HexColor("#DCE6F2"))
    c.setLineWidth(1)
    c.line(24, 20, PAGE_WIDTH - 24, 20)
    draw_paragraph(
        c,
        ptext("交付物：系统架构图 + 数据流转图 + Skill 模块图"),
        STYLES["tiny"],
        28,
        8,
        300,
        10,
    )


def page_cover(c: canvas.Canvas) -> None:
    draw_page_shell(c, "销售机会推进建议系统架构与数据流图", 1)
    draw_round_box(c, 28, 372, PAGE_WIDTH - 56, 160, fill=TITLE_BG, stroke=TITLE_BG, radius=22)
    draw_paragraph(
        c,
        ptext("销售机会推进建议系统架构与数据流图"),
        STYLES["hero"],
        44,
        468,
        420,
        42,
    )
    draw_paragraph(
        c,
        ptext(
            "基于《销售机会推进建议系统架构》整理，覆盖首版边界、分层组件、"
            "端到端请求链路、三层数据结构以及 Skill 内部执行闭环。"
        ),
        STYLES["subtitle"],
        44,
        412,
        470,
        50,
    )
    draw_tag(c, STYLES, 536, 474, 118, 22, "scene 固定", YELLOW)
    draw_tag(c, STYLES, 660, 474, 144, 22, "opportunityId 输入", YELLOW)
    draw_tag(c, STYLES, 536, 444, 118, 22, "单表取数", TEAL)
    draw_tag(c, STYLES, 660, 444, 144, 22, "结构化 JSON 输出", TEAL)

    stage_y = 334
    stage_w = 142
    stages = [
        ("01 机会ID输入", "POST /api/agent/run"),
        ("02 单表取数", "t_sales_opportunity"),
        ("03 字段映射", "枚举值 -> 业务文本"),
        ("04 事实约束推理", "模型只基于事实生成建议"),
        ("05 统一回传", "HTTP 响应 data / error"),
    ]
    for idx, (title, body) in enumerate(stages):
        x = 28 + idx * (stage_w + 14)
        draw_card(c, STYLES, x, stage_y, stage_w, 74, title, body, colors.white, colors.HexColor("#7FA7D7"))
        if idx < len(stages) - 1:
            draw_arrow(c, x + stage_w, stage_y + 37, x + stage_w + 14, stage_y + 37)

    draw_card(
        c,
        STYLES,
        28,
        160,
        380,
        150,
        "目标与边界",
        [
            "- 对外统一暴露 sales-opportunity-advisor 场景。",
            "- 调用方只传 scene + bizParams.opportunityId，不接触 SQL、prompt、skill。",
            "- 首版只查询 t_sales_opportunity 单表，并使用所有非空字段作为事实来源。",
            "- 输出聚焦销售机会推进建议，不做多场景 schema 分流。",
        ],
        colors.white,
        colors.HexColor("#6C93C6"),
    )
    draw_card(
        c,
        STYLES,
        430,
        160,
        384,
        150,
        "设计原则",
        [
            "- API 层保持轻量：参数校验、request file、runtime 调用、响应封装。",
            "- 确定性业务逻辑下沉到 skill：查库、字段字典映射、事实加工。",
            "- 大模型只负责建议生成，不查库、不猜字段含义、不自由选表。",
            "- skill 输出结构化 JSON，API 再转换为稳定 HTTP 响应。",
        ],
        colors.white,
        colors.HexColor("#4EA081"),
    )
    draw_card(
        c,
        STYLES,
        28,
        50,
        PAGE_WIDTH - 56,
        88,
        "核心落点",
        [
            "系统的关键不是让模型直接理解数据库，而是由 sales-opportunity-advisor skill "
            "先把数据库原始字段加工成可推理的业务事实，再由模型基于事实输出推进建议。"
        ],
        colors.white,
        colors.HexColor("#D8902E"),
    )


def page_architecture(c: canvas.Canvas) -> None:
    draw_page_shell(c, "系统架构图", 2)
    draw_tag(c, STYLES, 34, 514, 154, 22, "旁路 AI 服务架构", BLUE)
    draw_tag(c, STYLES, 196, 514, 150, 22, "API 薄 Skill 厚", GREEN)
    draw_tag(c, STYLES, 354, 514, 154, 22, "模型只做建议生成", ORANGE)

    cards = [
        ("调用方", ["前端页面 / 业务后端", "发起 POST /api/agent/run", "仅传 scene + opportunityId"], 34, 330, 126, 136, colors.white, "#6B92C3"),
        ("AI API 服务", ["server.js / routes/agent.js", "参数校验", "requestId 生成", "request file 写入"], 182, 330, 138, 136, colors.white, "#5A8DA9"),
        ("Runtime / Gateway", ["services/runtime.js", "openclaw agent --json", "stdout / stderr / timeout", "路由到 sales-agent"], 342, 330, 146, 136, colors.white, "#5F7AB1"),
        ("sales-agent", ["固定执行容器", "承接 sales-opportunity-advisor scene", "调度并执行 skill"], 510, 330, 118, 136, colors.white, "#7D7BC5"),
        ("sales-opportunity-advisor skill", ["request-reader", "context-query", "context-normalizer", "prompt-builder", "model-call / output-parser"], 650, 320, 162, 156, colors.white, "#D28C32"),
    ]

    for title, body, x, y, w, h, fill, accent in cards:
        draw_card(c, STYLES, x, y, w, h, title, body, fill, colors.HexColor(accent))

    for idx in range(len(cards) - 1):
        _, _, x, y, w, h, _, _ = cards[idx]
        _, _, nx, ny, _, nh, _, _ = cards[idx + 1]
        draw_arrow(c, x + w, y + h / 2, nx, ny + nh / 2)

    draw_card(
        c,
        STYLES,
        596,
        156,
        110,
        106,
        "数据层",
        ["SQL Server", "ERP_yfb", "t_sales_opportunity", "按 opportunityId 查 1 条"],
        TEAL,
        colors.HexColor("#3D8C98"),
    )
    draw_card(
        c,
        STYLES,
        716,
        156,
        96,
        106,
        "规则层",
        ["字段标签", "枚举映射", "事实格式", "输出 schema"],
        GREEN,
        colors.HexColor("#4C9B7E"),
    )
    draw_card(
        c,
        STYLES,
        596,
        42,
        216,
        96,
        "推理层",
        ["大模型仅基于已整理事实生成 summary / adviceText / nextActions / basisFields", "不查库，不解释枚举，不决定 SQL"],
        ORANGE,
        colors.HexColor("#CF8D36"),
    )

    draw_arrow(c, 651, 320, 651, 262)
    draw_arrow(c, 764, 320, 764, 262)
    draw_arrow(c, 704, 320, 704, 138)

    draw_elbow_arrow(c, 650, 398, 320, 214, via_y=292, dashed=True)
    draw_elbow_arrow(c, 320, 214, 160, 214, dashed=True)
    draw_tag(c, STYLES, 356, 224, 138, 18, "结构化 JSON 返回", colors.white)
    draw_tag(c, STYLES, 172, 224, 122, 18, "HTTP JSON 响应", colors.white)

    draw_card(
        c,
        STYLES,
        34,
        52,
        520,
        178,
        "职责边界",
        [
            "API 层：scene 与 bizParams 校验、requestId 生成、request file 管理、runtime 调用、HTTP 回传。",
            "Runtime / Gateway：执行 openclaw agent --json、处理 stdout / stderr / timeout、路由 agent。",
            "Agent：固定承载该业务场景，不内嵌复杂业务规则。",
            "Skill：查库、非空字段过滤、字段字典映射、事实构造、模型调用、输出校验。",
            "模型：仅对已知事实做推进建议生成。",
        ],
        colors.white,
        colors.HexColor("#61748B"),
    )


def page_data_flow(c: canvas.Canvas) -> None:
    draw_page_shell(c, "端到端数据流转图", 3)
    box_w = 180
    box_h = 122
    gap = 18
    top_y = 322
    bottom_y = 126
    xs = [32 + i * (box_w + gap) for i in range(4)]

    top_boxes = [
        ("01 HTTP Request", ["scene", "bizParams.opportunityId"], BLUE),
        ("02 Request File", ["requestId", "scene", "bizParams", "meta.createdAt/source"], TEAL),
        ("03 OpportunityRawContext", ["opportunityId", "rawRow", "仅保留非空字段"], colors.white),
        ("04 OpportunityFactContext", ["profile", "facts[]", "label / valueText / factText"], colors.white),
    ]
    bottom_boxes = [
        ("05 OpportunityAgentInput", ["task", "businessObject", "facts[]", "rules / outputSchema"], colors.white),
        ("06 Model Output", ["summary", "adviceText", "nextActions[]", "basisFields[]"], colors.white),
        ("07 Skill Result", ["success / scene / requestId", "payload 或 error", "factsUsed"], colors.white),
        ("08 HTTP Response", ["success", "requestId", "data / error"], BLUE),
    ]

    for idx, (title, body, fill) in enumerate(top_boxes):
        draw_card(c, STYLES, xs[idx], top_y, box_w, box_h, title, body, fill, colors.HexColor("#7698C7"))
        if idx < len(top_boxes) - 1:
            draw_arrow(c, xs[idx] + box_w, top_y + 61, xs[idx + 1], top_y + 61)

    for idx, (title, body, fill) in enumerate(bottom_boxes):
        draw_card(c, STYLES, xs[idx], bottom_y, box_w, box_h, title, body, fill, colors.HexColor("#7698C7"))
        if idx < len(bottom_boxes) - 1:
            draw_arrow(c, xs[idx] + box_w, bottom_y + 61, xs[idx + 1], bottom_y + 61)

    draw_arrow(c, xs[3] + box_w / 2, top_y, xs[0] + box_w / 2, bottom_y + box_h)

    support_y = 480
    supports = [
        (xs[2] + 28, "数据库查询", "ERP_yfb / t_sales_opportunity"),
        (xs[3] + 34, "字段字典", "label + enumMap + priority"),
        (xs[0] + 28, "Prompt 规则", "只能基于事实 / 输出 JSON"),
        (xs[1] + 44, "模型调用", "基于 AgentInput 生成建议"),
    ]
    support_targets = [
        xs[2] + box_w / 2,
        xs[3] + box_w / 2,
        xs[0] + box_w / 2,
        xs[1] + box_w / 2,
    ]
    support_rows = [top_y + box_h, top_y + box_h, bottom_y + box_h, bottom_y + box_h]
    support_fills = [TEAL, GREEN, ORANGE, ROSE]
    for idx, (sx, title, body) in enumerate(supports):
        draw_card(c, STYLES, sx, support_y, 154, 54, title, body, support_fills[idx], colors.HexColor("#7B8998"))
        draw_arrow(c, sx + 77, support_y, support_targets[idx], support_rows[idx])

    draw_card(
        c,
        STYLES,
        32,
        42,
        PAGE_WIDTH - 64,
        60,
        "固定数据链",
        ["OpportunityRawContext -> OpportunityFactContext -> OpportunityAgentInput -> Model Output -> Skill Result -> HTTP Response"],
        colors.white,
        colors.HexColor("#7A8DA4"),
    )


def page_skill_modules(c: canvas.Canvas) -> None:
    draw_page_shell(c, "Skill 内部模块与结构化产物", 4)
    module_y = 386
    module_w = 104
    module_h = 94
    module_gap = 10
    module_title_style = clone_style(STYLES["card_title"], "module_title", fontSize=10.4, leading=12.6)
    module_body_style = clone_style(STYLES["small"], "module_body", fontSize=8.0, leading=10.2, textColor=TEXT)
    modules = [
        ("request-reader", "解析 requestId / scene / opportunityId"),
        ("context-query", "按 opportunityId 查主表并过滤空值"),
        ("field-dictionary", "维护 label / enumMap / group / priority"),
        ("context-normalizer", "将 rawRow 转为 profile + facts[]"),
        ("prompt-builder", "生成 task / facts / rules / outputSchema"),
        ("model-call", "调用模型输出建议 JSON"),
        ("output-parser", "校验输出并包装 success / payload"),
    ]
    for idx, (title, body) in enumerate(modules):
        x = 32 + idx * (module_w + module_gap)
        draw_card(
            c,
            STYLES,
            x,
            module_y,
            module_w,
            module_h,
            title,
            body,
            colors.white,
            colors.HexColor("#7592BB"),
            title_style=module_title_style,
            body_style=module_body_style,
        )
        if idx < len(modules) - 1:
            draw_arrow(c, x + module_w, module_y + module_h / 2, x + module_w + module_gap, module_y + module_h / 2)

    bottom_cards = [
        ("OpportunityRawContext", ["requestId", "scene", "opportunityId", "rawRow"], TEAL, 32),
        ("OpportunityFactContext", ["profile", "facts[]", "group / priority"], GREEN, 230),
        ("OpportunityAgentInput", ["task", "businessObject", "facts[]", "rules", "outputSchema"], ORANGE, 428),
        ("Skill 标准返回", ["success", "scene", "requestId", "payload / error"], ROSE, 626),
    ]
    for title, body, fill, x in bottom_cards:
        draw_card(c, STYLES, x, 198, 184, 122, title, body, fill, colors.HexColor("#7A8DA4"))
    draw_arrow(c, 216, 259, 230, 259)
    draw_arrow(c, 414, 259, 428, 259)
    draw_arrow(c, 612, 259, 626, 259)

    draw_card(
        c,
        STYLES,
        32,
        44,
        378,
        120,
        "异常处理映射",
        [
            "400：scene 或 opportunityId 参数非法，由 API 层直接返回。",
            "404：机会不存在，由 skill 返回业务错误，API 映射为 HTTP 404。",
            "502 / 504：runtime、Gateway 或超时异常。",
            "500：本机服务内部异常或模型输出解析失败。",
        ],
        colors.white,
        colors.HexColor("#CA7A7C"),
    )
    draw_card(
        c,
        STYLES,
        430,
        44,
        378,
        120,
        "日志与可观测性",
        [
            "建议全链路记录：requestId、scene、opportunityId、runtime duration、数据库状态、模型状态、最终响应状态。",
            "日志分层：API 接入日志、runtime 调用日志、skill 业务日志、模型调用日志、错误日志。",
            "日志中避免直接输出数据库账号与完整敏感数据。",
        ],
        colors.white,
        colors.HexColor("#5E8C80"),
    )


def build_pdf() -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT_FILE), pagesize=landscape(A4))
    c.setTitle("销售机会推进建议系统架构与数据流图")
    c.setAuthor("Codex")
    c.setSubject("sales-opportunity-advisor architecture and data flow")
    c.setCreator("reportlab")

    page_cover(c)
    c.showPage()
    page_architecture(c)
    c.showPage()
    page_data_flow(c)
    c.showPage()
    page_skill_modules(c)
    c.save()
    return OUTPUT_FILE


register_fonts()
STYLES = make_styles()


if __name__ == "__main__":
    output = build_pdf()
    print(output)
