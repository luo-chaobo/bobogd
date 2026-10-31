# 订单财务权限与焊接产值统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private order unit pricing and calculated totals, then export welding report details and per-worker value totals for authorized staff.

**Architecture:** Keep money calculations and the exact-name-to-unique-account-ID rule in a small server-side helper. Enforce field validation and response redaction on the server, render inputs only from the returned permission, and extend the existing management workbook builder with an authorized-only welding sheet containing a worker summary and report detail.

**Tech Stack:** Node.js, existing HTTP server, vanilla JavaScript UI, ExcelJS XLSX export, node assert-based tests.

**Spec:** `docs/superpowers/specs/2026-10-20-order-financial-access-and-welding-value-design.md`

## Global Constraints

- Amounts use CNY with two decimal places; an empty unit price produces an empty total.
- Financial authorization resolves each exact specified employee name only when it uniquely matches one active account, then checks the matched account ID; missing or duplicate names fail closed.
- The server computes totals and enforces visibility and write access; UI hiding alone is not security.
- Welding value counts normal-route production reports only, excludes quality and rework, and inherits the report date range and existing Luo Chaobo exclusion.
- Unpriced welding reports remain in detail and are counted as unpriced; worker totals are labeled as priced value with the unpriced count visible.
- No online deployment, mini-program release, or changes to unrelated dirty files.

## Review Focus

- Nested order objects must not leak financial fields to unauthorized users — test bootstrap and dashboard payloads.
- Duplicate or missing employee names must fail closed — test unique, duplicate, inactive, and absent accounts.
- Empty price and numeric zero must remain distinct — test optional input, displayed total, and report amount.
- Unpriced reports must not look like complete performance totals — test priced subtotal and unpriced count together.
- Rework and quality reports must not inflate welding value — test both exclusions alongside a normal welding report.

---

### Task 1: Financial value and account authorization helper

**Files:**
- Create: `lib/order-financials.js`
- Create: `tests/order-financials.test.js`

**Interfaces:**
- Produces `normalizeUnitPrice(value) -> { value: number | null, error: string }`, `calculateOrderTotal(unitPrice, quantity) -> number | null`, and `financialAccessUserIds(users) -> Set<string>`.
- Resolve only active accounts with one exact match per configured name; do not grant access when a name has zero or multiple active matches.

- [x] **Step 1: Write failing helper tests** for empty versus zero price, two-decimal validation, negative/non-numeric/over-precision input, quantity multiplication, and unique/missing/duplicate/inactive account matching.
- [x] **Step 2: Run `node tests/order-financials.test.js`** and confirm failures identify missing exports/behavior.
- [x] **Step 3: Implement the three helper functions** using integer cents for money calculations and exact employee-name matches for account resolution.
- [x] **Step 4: Run `node tests/order-financials.test.js`** and confirm all helper assertions pass.

### Task 2: Secure order API and financial permissions

**Files:**
- Modify: `server.js`
- Create: `tests/order-financial-access.test.js`

**Interfaces:**
- Consumes Task 1 helper functions.
- Adds `permissions.viewOrderFinancials`; order create/update accepts `unitPrice` only from authorized accounts and returns server-computed `totalAmount` only to them.
- Unauthorized response serialization recursively removes `unitPrice` and `totalAmount` from order and nested objects without mutating stored state.

- [x] **Step 1: Add failing API tests** for authorized create/edit, unauthorized attempted writes, total tampering, bootstrap nested order redaction, dashboard redaction, and authorization failure for duplicate/missing names.
- [x] **Step 2: Run `node tests/order-financial-access.test.js`** and confirm the assertions fail because financial behavior is absent.
- [x] **Step 3: Add permission derivation, unit-price validation, server-side total calculation, and safe response serialization** in `server.js`; preserve existing role checks for order creation and editing.
- [x] **Step 4: Run `node tests/order-financial-access.test.js`** and confirm authorized and unauthorized cases pass.
- [x] **Step 5: Run `node tests/order-edit-quantity.test.js` and `node tests/quality-flow.test.js`** to check existing order update and creation behavior.

### Task 3: Order creation and editing fields

**Files:**
- Modify: `public/app.js`
- Create: `tests/order-financial-ui.test.js`

**Interfaces:**
- Consumes `data.permissions.viewOrderFinancials` and the API fields from Task 2.
- Produces side-by-side “单价” and read-only “总金额” fields below quantity/date on create and edit forms; submits only unit price.

- [x] **Step 1: Add failing UI assertions** for field order, authorized-only rendering, read-only total, empty price, quantity/price recalculation, and request body excluding client total.
- [x] **Step 2: Run `node tests/order-financial-ui.test.js`** and confirm the expected fields/behavior are absent.
- [x] **Step 3: Implement permission-gated fields and live display calculation** in `public/app.js`; keep server calculation authoritative.
- [x] **Step 4: Run `node tests/order-financial-ui.test.js`** and confirm the UI contract passes.
- [x] **Step 5: Run existing order UI tests** including `node tests/order-quantity-unit-ui.test.js` and `node tests/order-edit-quantity-ui.test.js`.

### Task 4: Authorized welding detail and worker totals workbook

**Files:**
- Modify: `lib/management-report-export.js`
- Modify: `server.js`
- Modify: `tests/management-report-export.test.js`
- Modify: `tests/management-report-export-api.test.js`

**Interfaces:**
- `buildManagementReportData(db, from, to)` adds welding detail rows and employee summaries derived from the already filtered reports and order unit price.
- `buildManagementWorkbook(data, { includeFinancials })` inserts “焊接统计” after “人员分析” only when `includeFinancials` is true.
- The summary displays priced value per worker plus unpriced-report count; detail displays each normal welding report, quantity, unit price, and amount.

- [x] **Step 1: Add failing report assertions** for sheet order, one row per normal welding production report, per-worker priced totals, unpriced count, and exclusion of rework, quality, out-of-period, and Luo Chaobo records.
- [x] **Step 2: Run `node tests/management-report-export.test.js`** and confirm the expected sheet and calculations are absent.
- [x] **Step 3: Add filtered welding detail/summary data and conditionally build the worksheet**; pass the requesting user’s financial permission from the export route.
- [x] **Step 4: Run `node tests/management-report-export.test.js`** and confirm XLSX contents and existing worksheets/charts pass.
- [x] **Step 5: Run `node tests/management-report-export-api.test.js`** and confirm authorized export includes the sheet while other managers’ exports do not.
- [x] **Step 6: Run all repository test scripts and `node --check server.js`**; report the known baseline child-server startup timeouts separately if they persist.

## Execution Notes

- The current worktree contains unrelated tracked and untracked changes. Stage only files named by this plan when committing.
- Before feature implementation, reproduce the existing test child-server startup timeout with captured child output; do not modify unrelated tests unless the failure is proven to be in the test harness and blocks required verification.
- Keep commits scoped to each completed testable task; never commit the existing worktree changes.
