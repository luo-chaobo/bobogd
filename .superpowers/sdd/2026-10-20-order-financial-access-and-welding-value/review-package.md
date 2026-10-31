# Review package — order financial access and welding value

Base commit: 8b46403
Review target: current working-tree changes for this plan only. The checkout contains unrelated pre-existing edits in `server.js`, dashboard files, Handoff.md, mini-program files, and test fixtures; do not assess those changes as part of this review.

## Requirements

- Optional CNY unit price (0 is distinct from blank); server computes total using quantity and ignores client-supplied total.
- Only active user accounts uniquely matching the exact names 罗朝波, 郑金波, 郑学良 may view/edit price. Missing/duplicate matches fail closed.
- Unauthorized users must neither read nor write `unitPrice` or `totalAmount`; nested object responses such as bootstrap, dashboard, and delivery must be redacted.
- Authorized management exports add “焊接统计” after “人员分析” and before “指标口径与来源”; unauthorized management exports omit the worksheet.
- The worksheet summarizes each welder's priced subtotal and unpriced report count, marks partial totals, and lists report details. Include normal-route production welding only; exclude quality, rework, date-outside-range, and reporter 罗朝波.
- Existing orders without a unit price stay unpriced; no data migration or deployment.

## Files to inspect

- `lib/order-financials.js`
- `server.js` — only changes related to order financial authorization, serialization/redaction, order create/update, and management export permission
- `public/app.js` — only order creation/edit financial controls and recalculation
- `lib/management-report-export.js`
- `tests/order-financials.test.js`, `tests/order-financial-access.test.js`, `tests/order-financial-ui.test.js`
- `tests/management-report-export.test.js`, `tests/management-report-export-api.test.js`
- Fixture-copy hunks adding `lib/order-financials.js` to isolated server tests

## Review focus

- Recursive redaction must not mutate stored DB objects or accidentally expose finance fields from any JSON API.
- Permission derivation must use current active user IDs, not names/phones on requests or UI-only hiding.
- API update/create must reject unauthorized writes and ignore forged `totalAmount` for authorized users.
- Money validation/rounding should avoid over-precision and precision drift; blank/zero must remain distinct.
- Welding totals should remain tied to the order owning the report's work order; unpriced rows must remain visible and prevent misleading complete totals.
- Sheet insertion and table formatting must retain all pre-existing sheets/charts and be absent for unauthorized exports.

Read-only review. Do not modify files, index, HEAD, or branch.
