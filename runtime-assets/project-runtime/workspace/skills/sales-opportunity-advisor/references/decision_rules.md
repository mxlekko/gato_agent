# Sales Opportunity Advisor Decision Rules

Use these rules to turn grounded facts into tighter推进建议. Apply only the rules supported by the available helper fields.

## Global rules

- `summary` should be one compact sentence or two short clauses, focusing on stage, key timing, amount, and the main risk/opportunity.
- `adviceText` should explain the immediate推进重点, not repeat all facts.
- `nextActions` must be specific and executable. Return `3` to `5` items.
- Never mention raw enum codes such as `销售阶段4` when the Chinese mapping is known.
- Do not mention fields that are absent, blank, or unsupported by the helper response.

## Opportunity status rules

- If `opportunityStatus = 赢单`, advice should shift from推进拿单 to执行落地、合同推进、交付风险控制.
- If `opportunityStatus = 输单`, advice should shift to复盘、竞争分析、客户关系修复. Do not pretend the opportunity is still actively推进.
- If `opportunityStatus = 进行中`, keep advice focused on current推进动作.

## Sales stage rules

- `未判定` or `已立项`:
  - Focus on qualifying the project, clarifying stakeholders, and确认预算/采购方式.
  - Recommended actions may include客户访谈、项目判断、需求核实.
- `明确需求`:
  - Focus on需求澄清、方案框架、决策链梳理.
  - Recommended actions may include确认关键需求、锁定决策人、推进初步方案.
- `深化方案` or `初步方案认可`:
  - Focus on方案确认、技术参数锁定、商务条件预热、关键人沟通.
  - Recommended actions may include方案评审会、参数确认、竞争应对.
- `招标与投标`:
  - Focus on投标倒排、竞争策略、招标节点、标书准备.
  - If `predictTenderDate` exists, one action should explicitly mention倒排时间表.
- `合同谈判与执行`:
  - Focus on商务条款、回款条件、合同风险.
- `项目建设`:
  - Focus on交付推进、验收、风险闭环.

## Budget and commercial rules

- If `budgetConfirmed = 否`, one of the `nextActions` should explicitly address预算确认 or预算审批推进.
- If `amount` is present and relatively large, advice should be more慎重 about决策链、竞争和节奏控制 rather than only giving generic suggestions.
- If `winRate` is present and low, advice should include补强短板 or重新评估机会质量.

## Tender and timing rules

- If `predictTenderDate` exists, mention the date directly and include a schedule-driven action.
- If `tenderType` or `tenderStatus` exists, use them to refine招标相关动作.
- If `canControlBid = 是`, advice can mention标前关系维护、需求引导、参数把控.
- If `canControlBid = 否`, advice should avoid pretending the bid is controllable and instead emphasize差异化竞争和合规准备.

## Competition and customer rules

- If `competitor` exists, one action should address竞争应对 or差异化 positioning.
- If `customerPainPoint` exists, one action or the main advice should directly respond to that pain point.
- If `customerConcern` exists, address it directly instead of giving broad generic advice.

## Output style rules

- Prefer concrete verbs such as `确认`, `推进`, `安排`, `梳理`, `准备`, `对齐`.
- Avoid vague phrases such as `持续跟进`, `加强沟通`, `提升转化` unless paired with a clear object and purpose.
- Keep the tone operational and business-facing.
