# 企业官网与独立交易平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有企业官网扩充为完整信任型官网，并新增 `order.wljixie.com` 对应的高转化长页面、真实照片宣传片与底部客户订单中心。

**Architecture:** 保留当前 Node 24、原生 HTML/CSS/JS 和 SQLite 结构。新增 `/platform.html` 作为交易平台本地入口，复用 `/api/inquiries` 与 `/api/order-status`；正式子域名只在部署层映射，不复制后端服务。

**Tech Stack:** Node.js 24、原生 HTML/CSS/JavaScript、Node Test、现有真实 JPEG 素材、Remotion 或等效本地渲染流程生成 MP4。

**Spec:** `docs/superpowers/specs/2026-08-29-corporate-site-order-platform-design.md`

## Global Constraints

- 不执行阿里云部署、DNS、备案接入或正式子域名配置。
- 不编造设备数量、精度、认证、客户名称、交付天数或产能。
- 交易平台正式域名固定为 `order.wljixie.com`，本地入口固定为 `/platform.html`。
- 宣传片只能使用仓库内已有真实照片与可验证文字。
- 现有询价、附件与订单查询 API 必须向后兼容。
- 当前目录不是 Git 仓库，完成步骤不执行提交或分支操作。

---

### Task 1: 锁定交易平台路由与转化契约

**Files:**
- Modify: `test/static.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `GET /platform.html`、本地官网至平台链接、正式 canonical `https://order.wljixie.com/`

- [ ] 在 `test/static.test.js` 增加失败测试，要求 `/platform.html` 可访问，包含 `id="inquiry-form"`、`id="order-lookup-form"`、`order.wljixie.com` canonical 和客户订单中心。
- [ ] 运行 `node --test test/static.test.js`，确认因平台页面不存在而失败。
- [ ] 扩展安全静态路由白名单，使 `/platform.html` 可访问但继续拒绝 `src/`、`private/` 与未知文件。
- [ ] 重跑静态测试并保持私有目录测试通过。

### Task 2: 扩充企业官网首页内容结构

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `test/static.test.js`

**Interfaces:**
- Consumes: `/platform.html`
- Produces: 官网完整首页内容层级和平台入口

- [ ] 增加失败测试，断言首页包含可接需求、行业应用、精选案例、工厂质检、服务优势、流程、知识内容和最终行动区。
- [ ] 将首页所有快速下单主行动指向 `/platform.html`，订单查询仍指向 `/tracking.html`。
- [ ] 使用现有8张真实图片构建工艺、案例和工厂证据区，图片均含明确 `alt`、宽高或 `aspect-ratio`，非首屏图片使用 `loading="lazy"`。
- [ ] 扩展共享视觉令牌、卡片、证据数字、媒体布局和响应式规则；保持现有其他页面兼容。
- [ ] 运行静态测试确认首页结构与导航通过。

### Task 3: 建设高转化交易平台长页面

**Files:**
- Create: `public/platform.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `test/static.test.js`

**Interfaces:**
- Consumes: `POST /api/inquiries`、`GET /api/order-status`
- Produces: 单页下单转化流程及底部客户订单中心

- [ ] 增加失败测试，断言平台具备首屏承诺、六类需求、真实媒体、工艺证据、服务流程、无图指南、FAQ、完整表单和底部订单查询。
- [ ] 使用深蓝工业首屏与橙色主行动，加入页面内粘性“立即发需求”按钮和移动端三入口。
- [ ] 将现有询价表单完整嵌入平台，保留最多3个、单个20MB、总计30MB限制与隐私同意。
- [ ] 在页尾嵌入客户订单中心，复用现有安全 DOM 渲染逻辑，不通过 `innerHTML` 注入客户数据。
- [ ] 为表单提交、查询中、成功、失败、无结果和视频不可播放提供明确状态。
- [ ] 运行 `test/static.test.js` 和 `test/admin-ui.test.js`，确保转化改造不重新引入 XSS。

### Task 4: 制作真实照片宣传片并接入页面

**Files:**
- Create: `media/promo/*`
- Create: `public/assets/video/factory-service.mp4`
- Modify: `public/platform.html`
- Modify: `public/assets/images/README.md`

**Interfaces:**
- Consumes: `public/assets/images/*.jpg`
- Produces: 20–30秒、无音频、1920×1080 H.264 MP4

- [ ] 使用 Remotion 工作流建立6个镜头：工厂全景、激光、折弯、焊接、表面处理、成品与下单行动；每镜头只使用真实照片和已核实文案。
- [ ] 渲染 `factory-service.mp4`，控制文件体积并提供 `factory-workshop.jpg` 作为 poster。
- [ ] 在平台媒体区加入 `video controls muted playsinline preload="metadata"`，不自动播放声音，不遮挡下单主行动。
- [ ] 在图片来源说明中记录视频由哪些自有照片组成，并注明可被现场视频替换。
- [ ] 使用本地请求确认 MP4 返回正确 MIME 与非零长度。

### Task 5: 子域名、SEO与内容导航收口

**Files:**
- Modify: `public/sitemap.xml`
- Modify: `public/robots.txt`
- Modify: `docs/launch-checklist.md`
- Create: `docs/order-subdomain.md`

**Interfaces:**
- Produces: `order.wljixie.com` 部署映射说明

- [ ] 更新 sitemap，主站保留企业内容页面，交易平台使用 `https://order.wljixie.com/` 独立 URL。
- [ ] 记录 Nginx/阿里云后续映射：子域根路径内部服务 `/platform.html`，API保持同源 `/api/*`。
- [ ] 记录正式切换前需要的证书、DNS、备案接入、微信 request 合法域名和回退检查，但不执行部署。
- [ ] 检查官网与交易平台页脚均可到达隐私、服务规则、联系和客户订单中心。

### Task 6: 全量验证与本地预览

**Files:**
- Modify: `docs/local-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Produces: 可复现的本地验收步骤

- [ ] 运行 `node --experimental-strip-types --test test/*.test.js`，要求0失败。
- [ ] 使用临时 SQLite 和上传目录启动最新本地服务，避免改动用户现有数据。
- [ ] 请求首页、平台、询价、订单查询、视频、后台和健康接口，要求全部返回成功。
- [ ] 打开 `/` 与 `/platform.html` 供用户检查视觉和内容层级。
- [ ] 在验收文档中明确正式微信、阿里云和子域名仍是后续外部联调项。
