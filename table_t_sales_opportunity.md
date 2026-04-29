# 表结构说明：t_sales_opportunity（销售机会）

> 对应实体：`SalesOpportunityPO`
> 对应 VO：`SalesOpportunityVO`

---

## 字段总览

| 列名 | Java 类型 | 数据库类型 | 说明 |
|---|---|---|---|
| id | Long | bigint IDENTITY(1,1) | 自增主键，不对外暴露，业务逻辑不使用 |
| opportunityId | Long | bigint | 雪花业务ID，所有 API 入参与表间关联均使用此字段 |
| opportunityCode | String | nvarchar | 机会编号，系统自动生成，格式如 `OPP-20240414-001` |
| opportunityName | String | nvarchar | 机会名称，必填 |
| customerId | Long | bigint | 关联客户的业务ID（来自 `t_sales_customer.customerId`） |
| customerName | String | nvarchar | 客户名称，冗余存储，与 `customerId` 对应 |
| ownerId | Long | bigint | 负责人用户ID |
| ownerName | String | nvarchar | 负责人姓名，冗余存储 |
| deptId | Long | bigint | 负责人所属部门ID |
| deptName | String | nvarchar | 部门名称，冗余存储 |
| opportunitySource | String | nvarchar | 机会来源，见枚举说明 |
| leadId | Long | bigint | 关联线索业务ID；从线索转化时写入，NULL 表示手动新建 |
| sourceLeadName | String | nvarchar | 来源线索名称，线索转化时冗余存储 |
| sourceLeadOwnerName | String | nvarchar | 来源线索负责人，线索转化时冗余存储 |
| convertUserId | Long | bigint | 线索转化操作人ID；手动新建时为 NULL |
| convertUserName | String | nvarchar | 线索转化操作人姓名；手动新建时为 NULL |
| salesScene | String | nvarchar | 销售场景 code，见枚举说明，必填 |
| salesStage | String | nvarchar | 当前销售阶段 code，见枚举说明 |
| opportunityStatus | String | nvarchar | 机会状态 code，见枚举说明 |
| winRate | Integer | int | 赢单概率，0-100 整数，单位 % |
| industry | String | nvarchar | 行业 code（来自系统行业字典） |
| productCategory | String | nvarchar | 产品品类，自由文本 |
| amount | BigDecimal | decimal | 预计合同金额，单位元 |
| discountRate | String | nvarchar | 折扣率，自由文本（如 "9折"、"85%"） |
| predictCloseDate | String | nvarchar | 预计成交日期，格式 `YYYY-MM-DD` |
| predictTenderDate | String | nvarchar | 预计开标日期，格式 `YYYY-MM-DD` |
| tenderType | Integer | int | 招标类型，见枚举说明 |
| tenderBlueprintDate | String | nvarchar | 设计蓝图日期，格式 `YYYY-MM-DD` |
| tenderStatus | Integer | int | 招标状态（历史字段，当前业务已停用，保留兼容） |
| visitType | String | nvarchar | 拜访方式，前端自由文本输入 |
| isProjectStarted | Integer | int | 项目是否启动（历史字段，当前业务已停用，保留兼容） |
| budgetConfirmed | Integer | int | 预算是否确认（历史字段，当前业务已停用，保留兼容） |
| budgetAmount | BigDecimal | decimal | 预算金额（历史字段，当前业务已停用，保留兼容） |
| salesScene | String | nvarchar | 销售场景（同上，以最终 PO 字段为准） |
| stageHistory | String | nvarchar(max) | 阶段变更历史，JSON 数组字符串，格式见下方说明 |
| isClosed | Integer | int | 是否已关闭（赢单/输单均视为关闭）：0=未关闭，1=已关闭 |
| projectBudgetAndSchedule | String | nvarchar | 项目预算及进度说明，自由文本 |
| projectReasonAndStandard | String | nvarchar | 立项原因及标准说明，自由文本 |
| productShare | String | nvarchar | 核心参数是否满足 code，见枚举说明 |
| canControlBid | String | nvarchar | 推荐品牌能否替换 code，见枚举说明 |
| controlBidPlan | String | nvarchar | 控标方案说明，自由文本 |
| integratorCoverage | String | nvarchar | 集成商控制力 code，见枚举说明（VO 对应字段名 `integratorControl`） |
| integratorInfluence | String | nvarchar | 其他集成商影响说明，自由文本（VO 对应字段名 `otherIntegratorInfluence`） |
| integratorKeyPerson | String | nvarchar | 集成商关键人说明，自由文本 |
| competitorSituation | String | nvarchar | 竞争对手情况，自由文本 |
| competitor | String | nvarchar | 竞争对手名称（历史字段，当前被 `competitorSituation` 替代，保留兼容） |
| tenderFlowAndKeyPerson | String | nvarchar | 招标流程及关键人说明，自由文本 |
| tenderTime | String | nvarchar | 投标时间，格式 `YYYY-MM-DD` |
| bidTime | String | nvarchar | 开标时间，格式 `YYYY-MM-DD` |
| purchaseTime | String | nvarchar | 采购时间，格式 `YYYY-MM-DD` |
| customerPainPoint | String | nvarchar | 客户痛点说明，自由文本（历史字段，当前已合并入 `remark`） |
| initialPlanSummary | String | nvarchar | 初步方案摘要，自由文本 |
| smartInputText | String | nvarchar(max) | 智能录入原始文本，用户粘贴的原始内容 |
| smartContacts | String | nvarchar(max) | 智能录入解析出的联系人，JSON 数组字符串 |
| loseReason | String | nvarchar | 输单原因，多选时逗号分隔存储；兼容旧整数编码，见枚举说明 |
| loseDesc | String | nvarchar | 输单说明，自由文本 |
| customerConcern | String | nvarchar | 客户关切（历史字段，当前已合并入 `remark`，写入时不再单独存储） |
| loseTime | String | nvarchar | 输单时间，格式 `YYYY-MM-DD HH:mm:ss` |
| loseUserId | Long | bigint | 输单操作人ID |
| loseUserName | String | nvarchar | 输单操作人姓名 |
| latestFollowTime | String | nvarchar | 最近跟进时间，每次新增跟进记录时自动更新 |
| remark | String | nvarchar | 备注，自由文本 |
| createUserId | Long | bigint | 创建人用户ID |
| createUser | String | nvarchar | 创建人姓名 |
| updateUserId | Long | bigint | 最后更新人用户ID |
| updateUser | String | nvarchar | 最后更新人姓名 |
| createTime | String | nvarchar | 创建时间，格式 `YYYY-MM-DD HH:mm:ss` |
| updateTime | String | nvarchar | 最后更新时间，格式 `YYYY-MM-DD HH:mm:ss` |

---

## 枚举说明

### opportunitySource（机会来源）

自由文本字符串，非枚举类管控，当前业务写入值为：

| 值 | 说明 |
|---|---|
| 线索转化 | 由线索转化而来（`leadId` 不为 NULL） |
| 手动录入 | 直接新建，未关联线索 |

### salesScene（销售场景）— `SalesSceneEnum`

| code | 名称 |
|---|---|
| tenderNoDesign | 招标未设计 |
| tenderDesigned | 招标已设计 |
| noTender | 不招标 |
| smallProject | 小项目 |
| designInstitute | 设计院 |

### salesStage（销售阶段）— `SalesStageEnum`

| code | 名称 | 排序 |
|---|---|---|
| none | 空 | 0 |
| preliminary | 初步方案认可 | 1 |
| decisionChain | 决策链覆盖 | 2 |
| deepenPlan | 深化方案及认可 | 3 |
| designControl | 设计控标方案并采用 | 4 |
| tenderBid | 招标与投标 | 5 |
| confirmBidder | 投标前确认参标单位 | 6 |
| designLiaison | 设计联络会 | 7 |
| purchasePlan | 确认采购计划 | 8 |
| factoryInspection | 厂验 | 9 |
| contractExecution | 合同谈判与执行 | 10 |

> 阶段与场景绑定：`none` 在所有场景共用，其余阶段按销售场景不同有所差异，由 `SalesSceneConfig` 管理。

### opportunityStatus（机会状态）— `SalesOpportunityStatusEnum`

| code | 名称 |
|---|---|
| progressing | 进行中 |
| won | 赢单 |
| lost | 输单 |

### tenderType（招标类型）— 整数编码（1-3）

| 值 | 名称 |
|---|---|
| 1 | 公开招标 |
| 2 | 邀标 |
| 3 | 不招标 |

### productShare（核心参数是否满足）

| code | 名称 |
|---|---|
| satisfied | 满足 |
| partiallySatisfied | 部分满足 |
| notSatisfied | 不满足 |
| pending | 待确认 |

### canControlBid（推荐品牌能否替换）

| code | 名称 |
|---|---|
| replaceable | 可以替换 |
| partialReplaceable | 部分可替换 |
| nonReplaceable | 不能替换 |
| pending | 待确认 |

### integratorCoverage（集成商控制力）— VO 字段名 `integratorControl`

| code | 名称 |
|---|---|
| strong | 强 |
| medium | 中 |
| weak | 弱 |
| pending | 待确认 |

### loseReason（输单原因）

多选时逗号分隔存储，兼容旧整数编码（1-13）：

| 文本值（新格式）| 整数编码（旧格式，兼容读取） |
|---|---|
| 价格原因 | 1 |
| 质量原因 | 2 |
| 客户关系原因 | 3 |
| 产品功能 | 4 |
| 产品品牌 | 5 |
| 服务问题 | 6 |
| 付款方式 | 7 |
| 工程商未中标 | 8 |
| 人脉关系 | 9 |
| 用户搁置或取消 | 10 |
| 销售场景错误 | 11 |
| 未投标 | 12 |
| 其他 | 13 |

---

## stageHistory JSON 格式

`stageHistory` 字段以 JSON 数组字符串存储，每条记录结构如下：

```json
[
  {
    "stage": "preliminary",
    "enterTime": "2024-04-01 10:00:00",
    "leaveTime": "2024-04-10 15:30:00",
    "stayDays": 9
  }
]
```

| 字段 | 说明 |
|---|---|
| stage | 阶段 code，对应 `SalesStageEnum` |
| enterTime | 进入该阶段的时间 |
| leaveTime | 离开该阶段的时间；当前所在阶段为 NULL |
| stayDays | 在该阶段的停留天数；历史数据缺失时由后端自动补算 |

---

## 备注

- **已停用字段**：`tenderStatus`、`isProjectStarted`、`budgetConfirmed`、`budgetAmount`、`competitor`、`customerPainPoint` 为历史遗留字段，当前业务不再写入新值，保留是为了兼容旧数据查询，新功能开发不得依赖这些字段。
- **PO 与 VO 字段名差异**：部分字段在 PO（数据库列名）和 VO（API 对外名称）不一致，主要差异见下表：

| PO 字段名 | VO 字段名 | 说明 |
|---|---|---|
| predictCloseDate | expectedDealDate | 预计成交日期 |
| predictTenderDate | expectedBidDate | 预计开标日期 |
| integratorCoverage | integratorControl | 集成商控制力 |
| integratorInfluence | otherIntegratorInfluence | 其他集成商影响 |
