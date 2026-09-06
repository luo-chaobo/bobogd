# Future Machinery Product Knowledge and Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready Future Machinery product knowledge base, editable architecture diagrams, repository documentation indexes, and an explicit-only Codex Skill that restores and updates project context across new conversations.

**Architecture:** Obsidian is the cross-system product master and is synchronized through Nutstore; each Git repository remains the technical source of truth for its own implementation. The explicit `$future-machinery-product` Skill reads Obsidian, root and repository handoffs, and verified Git state before work, then updates affected records after work and asks before committing.

**Tech Stack:** Obsidian Markdown, Nutstore shared folders, Git, Draw.io XML, SVG, PNG rendered with local Chrome headless, Codex Skills, PowerShell validation scripts.

**Spec:** `docs/superpowers/specs/2026-09-06-product-knowledge-collaboration-design.md`

## Global Constraints

- Obsidian Vault root is `D:\Obsidian\未来机械\未来机械`.
- The Skill name is `future-machinery-product` and implicit invocation must be disabled.
- Complex diagrams use `.drawio` as the editable source and include same-name `.png` previews; SVG may be retained as the deterministic intermediate.
- Never copy database files, customer drawings, full phone numbers, credentials, private keys, AccessKey, AppSecret, webhook secrets, or production tokens into Obsidian or Git.
- Existing uncommitted work belongs to the user or other developers and must not be overwritten or included in a commit.
- Git commits require explicit user approval and are never pushed automatically.
- Cloud deployment, Nutstore invitations, database changes, and external messages require separate authorization at the time of action.
- This plan documents the phase-one anonymized export contract; it does not implement the export job or migrate SQLite to RDS.

---

### Task 1: Establish the repository product-documentation boundary

**Files:**
- Create: `Handoff.md`
- Create: `CHANGELOG.md`
- Create: `docs/product/README.md`
- Create: `docs/product/system-catalog.md`
- Create: `docs/architecture/README.md`
- Create: `docs/data/analytics-access.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: current `README.md`, root `../Handoff.md`, `docs/bobo-api.md`, `docs/order-subdomain.md`, `docs/wechat-launch-checklist.md`, current Git branch and commit.
- Produces: repository-local entry points that Obsidian and the Skill can cite without duplicating implementation details.

- [ ] **Step 1: Capture verified repository state**

Run:

```powershell
git status --short
git log -5 --oneline --decorate
& "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --experimental-strip-types --test .\test\*.test.js
```

Expected: record the current branch, HEAD, dirty files, and exact test total. Do not reuse counts from an older Handoff if the command differs.

- [ ] **Step 2: Create repository-local `Handoff.md`**

Use these fixed sections:

```markdown
# Website Repository Handoff

第二行写入执行时通过 `Get-Date -Format 'yyyy-MM-dd HH:mm'` 获取的实际时间，并标注 `Asia/Shanghai`。

## 仓库职责
## 当前版本与验证
## 已实现
## 尚未上线或待验证
## 当前阻塞
## 下一步
## 安全边界
## 新会话接续
```

Populate only facts verified in Step 1 and current source documents. Link to the root `../Handoff.md` for cross-system status.

- [ ] **Step 3: Create `docs/product/system-catalog.md`**

Document these systems with owner, users, entry point, responsibilities, stored data, upstream/downstream dependencies, current implementation status, and next milestone:

```text
企业网站
钣金服务微信小程序
快速接单平台
客服管理后台
波波工单及车间看板
企业微信通知与客服
私有OSS附件存储
SQLite业务数据库
阿里云ECS/Nginx/HTTPS
```

Mark cloud and production claims as `待线上验证` unless checked directly.

- [ ] **Step 4: Create the analytics-access contract**

In `docs/data/analytics-access.md`, define:

```text
Phase 1 source: ECS-local SQLite, application access only
Allowed team output: aggregated CSV/XLSX with generation time and schema version
Mandatory masking: phone, contact identity, attachment URL, drawing metadata, payment evidence, internal cost, internal notes
Initial metrics: inquiry count, first-response duration, timeout rate, quotes, quote-to-order rate, delivery cycle, order state distribution, source channel, failed notification count
Forbidden output: SQLite/-wal/-shm, raw attachments, credentials, full audit logs
Phase 2: RDS MySQL + independent RAM identities + DMS least-privilege query access
```

- [ ] **Step 5: Add navigation without duplicating content**

Update `README.md` with a “产品与协作文档” section linking repository Handoff, system catalog, architecture index, data access contract, API docs, deployment docs, and the Obsidian product master path. Add an initial `CHANGELOG.md` entry that cites the current commit rather than rewriting Git history.

- [ ] **Step 6: Validate links and sensitive-content boundary**

Run:

```powershell
rg -n "TODO|TBD|待补充|AccessKeyId|AccessKeySecret|AppSecret|BEGIN .*PRIVATE KEY|viewerToken=" README.md Handoff.md CHANGELOG.md docs
```

Expected: no unfinished placeholders or credential values. Legitimate security warnings may contain credential field names but never values.

---

### Task 2: Create canonical editable architecture diagrams

**Files:**
- Create: `docs/architecture/sources/system-landscape.drawio`
- Create: `docs/architecture/sources/deployment-and-data-flow.drawio`
- Create: `docs/architecture/sources/product-update-loop.drawio`
- Create: `docs/architecture/images/system-landscape.svg`
- Create: `docs/architecture/images/system-landscape.png`
- Create: `docs/architecture/images/deployment-and-data-flow.svg`
- Create: `docs/architecture/images/deployment-and-data-flow.png`
- Create: `docs/architecture/images/product-update-loop.svg`
- Create: `docs/architecture/images/product-update-loop.png`
- Create: `scripts/render-architecture-diagrams.ps1`
- Modify: `docs/architecture/README.md`

**Interfaces:**
- Consumes: `docs/product/system-catalog.md` and verified deployment facts.
- Produces: editable Draw.io sources, deterministic SVG intermediates, PNG previews, and a repeatable render command.

- [ ] **Step 1: Define the diagram inventory in `docs/architecture/README.md`**

Record exactly:

| Diagram | Purpose | Required nodes |
|---|---|---|
| `system-landscape` | Product and actor overview | customers, staff, website, mini-program, order platform, WeCom, Bobo, ECS, OSS |
| `deployment-and-data-flow` | Runtime and protected data flow | browsers, WeChat, Nginx, Node app, SQLite, private OSS, Bobo HTTPS integration, backup boundary |
| `product-update-loop` | Knowledge and version update process | explicit Skill, Obsidian, Handoff, Git verification, tests, review, commit |

- [ ] **Step 2: Write valid uncompressed Draw.io XML**

Each `.drawio` file must contain one `mxfile`, one diagram page, an `mxGraphModel`, root cells `0` and `1`, labeled vertex cells, and directed edge cells. Use Chinese labels, a legend, and `更新时间：2026-09-06` in the diagram footer. Do not include URLs containing tokens or public IP addresses.

- [ ] **Step 3: Create matching SVG previews**

Create one accessible SVG per source with:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-labelledby="title desc">
  <title id="title">图表中文名称</title>
  <desc id="desc">图表关系摘要</desc>
  <!-- labeled groups, nodes, arrow markers, and footer -->
</svg>
```

Text, node order, arrows, colors, version date, and legend must match the corresponding Draw.io source.

- [ ] **Step 4: Add the deterministic PNG renderer**

Create `scripts/render-architecture-diagrams.ps1` with this interface:

```powershell
param(
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe",
  [string]$ImageDirectory = "$PSScriptRoot\..\docs\architecture\images"
)
```

For every `.svg` in `$ImageDirectory`, call Chrome headless with `--headless=new`, `--disable-gpu`, `--hide-scrollbars`, `--window-size=1600,900`, `--screenshot=<same-name.png>`, and the absolute file URI. Exit non-zero when Chrome is missing or any PNG is missing/empty.

- [ ] **Step 5: Render and inspect all previews**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\render-architecture-diagrams.ps1
Get-ChildItem .\docs\architecture\images\*.png | Select-Object Name,Length
```

Expected: three non-empty PNG files at 1600×900. Open each PNG and verify text is legible, arrows terminate at the intended nodes, no boxes overlap, and no sensitive value appears.

- [ ] **Step 6: Validate Draw.io XML**

Run:

```powershell
Get-ChildItem .\docs\architecture\sources\*.drawio | ForEach-Object {
  [xml](Get-Content -Raw -LiteralPath $_.FullName) | Out-Null
  Write-Output "VALID $($_.Name)"
}
```

Expected: all three print `VALID` without an XML parse error.

---

### Task 3: Build the Obsidian product master

**Files:**
- Create under `D:\Obsidian\未来机械\未来机械`: the directory tree and Markdown files specified below.
- Copy under the Vault: the three `.drawio`, `.svg`, and `.png` diagram sets from Task 2.

**Interfaces:**
- Consumes: repository Handoff, system catalog, architecture assets, API docs, deployment docs, and root `Handoff.md`.
- Produces: the team-facing product master and the stable first files read by the Skill.

- [ ] **Step 1: Request and verify Vault write permission**

Create a temporary note only after approval, verify it exists, then remove it. Do not change `.obsidian` settings during this check.

- [ ] **Step 2: Create the approved directory tree**

Create:

```text
00-产品总览
01-业务与产品
02-系统架构
03-子系统
04-技术与数据
05-项目管理/决策记录
05-项目管理/更新日志
06-协作指南
90-归档
```

- [ ] **Step 3: Create the stable entry notes**

Create `首页.md`, `00-产品总览/产品全景.md`, and `00-产品总览/当前状态.md`.

`首页.md` must link every top-level section and show: product purpose, current phase, current website repository commit, production deployment status, and the recommended new-conversation invocation.

`当前状态.md` must use these sections:

```markdown
# 当前状态
第二行写入执行时通过 `Get-Date -Format 'yyyy-MM-dd HH:mm'` 获取的实际时间，并标注 `Asia/Shanghai`。
## 当前阶段
## 子系统版本与环境
## 最近验证
## 当前阻塞
## 下一步
## 事实来源
```

- [ ] **Step 4: Create product and subsystem notes**

Create the following notes with purpose, target users, main flows, owned data, dependencies, current implementation, known gaps, acceptance criteria, and repository links:

```text
01-业务与产品/产品介绍.md
01-业务与产品/用户与角色.md
01-业务与产品/快速接单业务闭环.md
01-业务与产品/订单与工序状态.md
01-业务与产品/需求路线图.md
01-业务与产品/验收标准.md
03-子系统/企业网站.md
03-子系统/钣金服务小程序.md
03-子系统/接单平台.md
03-子系统/波波工单.md
03-子系统/企业微信.md
```

- [ ] **Step 5: Create architecture, data, project, and collaboration notes**

Create:

```text
02-系统架构/总体架构.md
02-系统架构/部署架构.md
02-系统架构/系统数据流.md
04-技术与数据/API目录.md
04-技术与数据/数据字典.md
04-技术与数据/环境与域名.md
04-技术与数据/数据分析与脱敏.md
04-技术与数据/RDS与DMS迁移方案.md
05-项目管理/里程碑.md
05-项目管理/风险与阻塞.md
05-项目管理/决策记录/ADR-001-知识与数据协作架构.md
05-项目管理/更新日志/2026-09-06-建立产品知识体系.md
06-协作指南/新开发者上手.md
06-协作指南/坚果云协作规范.md
06-协作指南/Git版本管理.md
06-协作指南/数据访问申请.md
```

Every architecture note must embed the PNG and link the `.drawio` source. Every implementation claim must cite a repository file and commit or be marked `待验证`.

- [ ] **Step 6: Validate Vault links and forbidden content**

Run a PowerShell link checker that extracts `[[...]]` links, resolves note and attachment targets, and fails on missing files. Then run:

```powershell
rg -n "BEGIN .*PRIVATE KEY|AccessKeySecret\s*[:=]|AppSecret\s*[:=]|viewerToken=|password\s*[:=]" "D:\Obsidian\未来机械\未来机械"
```

Expected: no missing internal links and no credential values.

---

### Task 4: Create the explicit-only Future Machinery product Skill

**Files:**
- Create: `C:\Users\luoch\.codex\skills\future-machinery-product\SKILL.md`
- Create: `C:\Users\luoch\.codex\skills\future-machinery-product\agents\openai.yaml`
- Create: `C:\Users\luoch\.codex\skills\future-machinery-product\references\product-locations.md`
- Create: `C:\Users\luoch\.codex\skills\future-machinery-product\references\update-contract.md`
- Create: `C:\Users\luoch\.codex\skills\future-machinery-product\references\system-map.md`

**Interfaces:**
- Consumes: stable Obsidian entry notes, root/repository Handoffs, Git state, and task-specific source files.
- Produces: a reusable `$future-machinery-product` workflow that resumes, executes, verifies, documents, and prepares reviewed commits.

- [ ] **Step 1: Request Skill-directory write permission**

Ask permission specifically for `C:\Users\luoch\.codex\skills\future-machinery-product`. Do not request broad write access to the complete Codex home.

- [ ] **Step 2: Initialize the Skill**

Run the Skill Creator initializer with references only:

```powershell
& "C:\Users\luoch\.codex\skills\.system\skill-creator\scripts\init_skill.py" future-machinery-product `
  --path "C:\Users\luoch\.codex\skills" `
  --resources references `
  --interface "display_name=未来机械产品" `
  --interface "short_description=接续并维护未来机械产品、代码、架构和项目记录" `
  --interface "default_prompt=核对未来机械产品当前状态，并继续完成我本次指定的工作。"
```

- [ ] **Step 3: Configure explicit invocation**

Ensure `agents/openai.yaml` contains:

```yaml
policy:
  allow_implicit_invocation: false
```

Preserve the generated interface fields.

- [ ] **Step 4: Write a concise router `SKILL.md`**

Required frontmatter:

```yaml
---
name: future-machinery-product
description: Resume and maintain the Future Machinery product ecosystem, including the corporate website, sheet-metal mini-program, order platform, Bobo work orders, WeCom integrations, architecture records, and repository handoffs. Use only when explicitly invoked by the user.
---
```

Required workflow:

```text
1. Read product-locations.md.
2. Read Obsidian 首页.md and 当前状态.md completely.
3. Read root Handoff.md and the relevant repository Handoff/README.
4. Verify filesystem paths, Git branch/status/log, and relevant tests; label unavailable facts as unverified.
5. State current phase, changed repositories, user-owned dirty files, task scope, and required permissions.
6. Execute only the user's explicit task; do not infer deployment, external messaging, cloud mutation, or database-write authority.
7. Verify proportionally to risk.
8. Update affected Obsidian notes, current status, dated update log, repository Handoff/CHANGELOG/docs, and diagrams when architecture changes.
9. Scan updated records for secrets and personal data.
10. Show diffs and verification results; ask before each Git commit; never push automatically.
```

- [ ] **Step 5: Write the three references**

`product-locations.md` contains only stable paths, repository roles, required first reads, and discovery fallback rules.

`update-contract.md` defines which records change for product, architecture, API/schema, deployment, bugfix, documentation-only, and roadmap updates. It also defines the mandatory end-of-task reconciliation between Obsidian `当前状态.md` and Handoffs.

`system-map.md` summarizes the five user-facing systems, cloud components, integration direction, and the boundary between implemented, deployed, and planned states. It points to canonical Obsidian/repository files rather than copying large documents.

- [ ] **Step 6: Validate the Skill package**

Run:

```powershell
& "C:\Users\luoch\.codex\skills\.system\skill-creator\scripts\quick_validate.py" `
  "C:\Users\luoch\.codex\skills\future-machinery-product"
```

Expected: validation succeeds, no scaffold placeholders remain, and implicit invocation is disabled.

- [ ] **Step 7: Perform a new-conversation dry run**

Use this exact scenario without modifying production or cloud state:

```text
$future-machinery-product 请核对当前产品状态，告诉我企业网站、钣金服务小程序、接单平台和波波工单分别完成到哪里，以及下一步是什么。不要修改文件。
```

Expected: the response reads current records, verifies Git status, distinguishes local implementation from production deployment, identifies current blockers, and performs no write or external action.

---

### Task 5: Reconcile records, review, and prepare Nutstore onboarding

**Files:**
- Modify: `Handoff.md`
- Modify: `CHANGELOG.md`
- Modify: `D:\WMR\lcb\未来网站改造\Handoff.md`
- Modify: `D:\Obsidian\未来机械\未来机械\00-产品总览\当前状态.md`
- Modify: `D:\Obsidian\未来机械\未来机械\05-项目管理\更新日志\2026-09-06-建立产品知识体系.md`

**Interfaces:**
- Consumes: all artifacts and validation results from Tasks 1–4.
- Produces: synchronized current-state records, a reviewed Git change set, and a safe manual Nutstore invitation procedure.

- [ ] **Step 1: Reconcile the three current-state records**

Ensure repository Handoff, root Handoff, and Obsidian current status agree on:

```text
website HEAD and test result
Bobo repository/worktree location and verified status
local versus production environment status
ECS/OSS facts that remain screenshot-derived or unverified
current blockers
next executable milestone
```

- [ ] **Step 2: Document Nutstore setup without performing external invitations**

In `06-协作指南/坚果云协作规范.md`, include:

```text
Shared folder: actual Vault root
Owner: product owner
Core developers: upload/download
Business/production: download-only or preview-only
External collaborators: selected subfolder, preview-only, expiry date
Conflict rule: retain both copies, compare, merge, then delete only after review
Offboarding rule: remove access immediately when role or project ends
Forbidden files: database, WAL/SHM, raw customer attachments, credentials, unmasked exports
```

Actual Nutstore client binding and member invitations remain user-confirmed UI operations.

- [ ] **Step 3: Run final validation**

Run:

```powershell
git status --short
git diff --check
& "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --experimental-strip-types --test .\test\*.test.js
powershell -ExecutionPolicy Bypass -File .\scripts\render-architecture-diagrams.ps1
```

Also validate all Draw.io XML, Obsidian links, PNG existence, Skill package, and sensitive-content scans from earlier tasks.

- [ ] **Step 4: Present the review package**

Report separately:

```text
Repository files changed
Obsidian files created/changed
Skill files created
Diagram source and preview pairs
Tests and validators run
Unverified cloud/Nutstore facts
Proposed Git commit file list and message
```

- [ ] **Step 5: Commit only after user approval**

Proposed repository commit:

```powershell
git add -- README.md Handoff.md CHANGELOG.md docs/product docs/architecture docs/data scripts/render-architecture-diagrams.ps1
git commit -m "docs: 建立未来机械产品知识与架构主档"
```

Do not commit Obsidian Vault files or the locally installed Skill into the website repository. Do not push.
