const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.value = "";
    this.className = "";
    this._text = "";
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._text = String(value);
    this.children = [];
    if (/onerror\s*=|onload\s*=|<script/i.test(this._text)) globalThis.adminXssExecuted = true;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._text = "";
    this.children = [...children];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = { target: this, preventDefault() {} }) {
    await Promise.all((this.listeners.get(type) || []).map((listener) => listener(event)));
  }

  querySelector() {
    return new Element("button");
  }
}

function adminDocument() {
  const ids = [
    "admin-token", "load-admin", "inquiry-list", "admin-summary", "order-list",
    "workflow-dialog", "workflow-form", "workflow-result", "event-dialog", "event-form"
  ];
  const elements = new Map(ids.map((id) => [id, new Element()]));
  return {
    elements,
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => elements.get(id)
  };
}

test("renders malicious inquiry fields as text without executing event handlers", async () => {
  const document = adminDocument();
  const malicious = '<img src=x onerror="globalThis.adminXssExecuted=true">';
  globalThis.adminXssExecuted = false;
  const context = {
    document,
    sessionStorage: { getItem: () => "token", setItem() {}, removeItem() {} },
    fetch: async (url) => ({
      ok: true,
      json: async () => {
        if (url === "/api/admin/inquiries") return [{
          id: malicious,
          inquiryNumber: malicious,
          contactName: malicious,
          region: malicious,
          description: malicious,
          quantity: malicious,
          expectedDate: malicious,
          source: malicious,
          claimedAt: null,
          slaStatus: "overdue"
        }];
        if (url === "/api/admin/orders") return [{
          id: malicious,
          orderNumber: malicious,
          contactName: malicious,
          phone: malicious,
          status: malicious
        }];
        return [];
      }
    }),
    FormData: class {},
    console
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/admin.js"), "utf8"), context, { filename: "admin.js" });
  await document.elements.get("load-admin").dispatch("click");

  assert.equal(globalThis.adminXssExecuted, false);
  assert.match(document.elements.get("inquiry-list").textContent, /<img src=x onerror=/);
  assert.match(document.elements.get("order-list").textContent, /<img src=x onerror=/);
});
