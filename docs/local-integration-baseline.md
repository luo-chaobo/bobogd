# 本地联调版本基线

- 建立时间：2026-09-13（Asia/Shanghai）
- 正式源仓库：`D:\codex内容\copy黑湖小工单`
- 本地联调仓库：`D:\波波本地联调`
- 初始分支：`main`
- 初始提交：`a52c0cb6019fe7e9f52ab53e7f3fcf9374ec1d24`
- 开发分支：`feat/platform-order-source`
- 复制前已有修改：`Handoff.md`
- 数据边界：仅使用本地模拟数据，禁止连接生产 MySQL、生产附件和 `bobogd.wljixie.com`。

基线核验时，两仓库 HEAD、`Handoff.md` SHA256 和未提交 diff SHA256 均一致，且均无未跟踪文件。

基线全量测试为 66/67；`tests/dxf-inline-preview.test.js` 在并行全量运行时因固定端口碰撞失败，随后单独连续运行两次均通过。该问题属于既有测试基础设施，不作为平台订单功能回归结果。
