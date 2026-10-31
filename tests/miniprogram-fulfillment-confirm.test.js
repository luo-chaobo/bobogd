const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = require(path.join(root, "miniprogram", "utils", "api.js"));
const pagePath = path.join(root, "miniprogram", "pages", "completion-details", "completion-details.js");
let pageDefinition;
let confirmResult = false;
let requests = [];
let toasts = [];
let platformSyncResult = { ok: true, platformSync: "pending" };

global.Page = (definition) => { pageDefinition = definition; };
global.wx = {
  showModal(options) { options.success({ confirm: confirmResult }); },
  showToast(options) { toasts.push(options); }
};
api.request = async (url, options) => {
  requests.push({ url, options });
  return platformSyncResult;
};
require(pagePath);

function context() {
  return {
    data: {
      canManageOrderFulfillment: true,
      items: [{ orderId: "order", shipped: false, invoiced: false, submitting: false, canUpdateFulfillment: true }]
    },
    setData(values) {
      Object.entries(values).forEach(([key, value]) => {
        const match = key.match(/^items\[(\d+)]\.(\w+)$/);
        if (match) this.data.items[Number(match[1])][match[2]] = value;
      });
    },
    async load() {}
  };
}

async function run() {
  let ctx = context();
  confirmResult = false;
  requests = [];
  await pageDefinition.updateFulfillment.call(ctx, { currentTarget: { dataset: { orderId: "order", type: "shipped" } }, detail: { value: true } });
  assert.strictEqual(requests.length, 0);
  assert.strictEqual(ctx.data.items[0].shipped, false);

  ctx = context();
  confirmResult = true;
  requests = [];
  await pageDefinition.updateFulfillment.call(ctx, { currentTarget: { dataset: { orderId: "order", type: "invoiced" } }, detail: { value: true } });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, "/api/orders/fulfillment");
  assert.deepStrictEqual(requests[0].options.data, { orderId: "order", shipped: false, invoiced: true });

  ctx = context();
  requests = [];
  toasts = [];
  platformSyncResult = { ok: true, platformSync: "pending" };
  await pageDefinition.updateFulfillment.call(ctx, { currentTarget: { dataset: { orderId: "order", type: "shipped" } }, detail: { value: true } });
  assert.strictEqual(requests[0].options.data.shipped, true);
  assert.strictEqual(toasts[0].title, "已保存，平台同步中");
  console.log("miniprogram-fulfillment-confirm: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
