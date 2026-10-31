# 平台订单来源隔离设计

## 目标

平台订单进入波波现有派工、报工、质检和履约流程，同时与工厂手工订单在标识、筛选、统计和导出中保持可区分。

## 数据模型

订单保存 `orderOrigin`、`sourceChannel` 和 `externalOrderNumber`。工厂人工订单固定为 `factory/factory_manual`；平台接口仅接受 `platform` 下的 `website`、`order_platform`、`miniprogram`。历史无字段订单只读兼容为工厂手工单，普通编辑不得修改来源，返单继承原来源。

## 外部接口

`POST /api/external/work-orders` 要求以下请求头：`Content-Type: application/json`、`X-Integration-Timestamp`（13 位毫秒时间戳）、`X-Integration-Nonce`（唯一字符串）和 `X-Integration-Signature`。签名原文为 `timestamp + "." + nonce + "." + rawBody`，使用共享密钥执行 HMAC-SHA256，并以小写十六进制传输。服务器允许时间偏差 5 分钟，nonce 保留 24 小时防重放。

平台订单号同时作为波波订单号和幂等键；同号同内容返回 `200` 原记录，首次创建返回 `201`，同号不同内容或与工厂单冲突返回 `409`。签名无效/重放返回 `401`，字段或渠道不合法返回 `422`，未配置密钥返回 `503`。新工单为待排产，不自动创建工序或派工。

## 展示与统计

车间执行页面默认合并显示全部生产订单并标记来源；管理统计按全部、工厂单和平台单分组，平台单再按三个渠道拆分。Excel 使用相同口径。

## 安全边界

仅在 `D:\波波本地联调` 使用模拟数据调试。测试网站通过受限反向隧道访问本地服务。未经单独授权，不连接或修改生产 MySQL、生产附件、微信生产配置和 `bobogd.wljixie.com`。
