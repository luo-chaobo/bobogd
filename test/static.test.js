const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApplication } = require("../src/server");
global.document = { getElementById: () => null };
const { NAV_GROUPS, fileSelectionProblem, fileToAttachment, localDate, parseApiResponse, renderOrderResult, runLockedRequest } = require("../public/app");
delete global.document;

test("defines accessible deep links for the three priority navigation groups", () => {
  assert.deepEqual(NAV_GROUPS.map(({ label, items }) => [label, items.map(({ href }) => href)]), [
    ["加工能力", ["/capabilities.html#laser-cutting", "/capabilities.html#cnc-bending", "/capabilities.html#welding", "/capabilities.html#finishing", "/capabilities.html#assembly", "/capabilities.html#no-drawing"]],
    ["行业方案", ["/solutions.html#automation", "/solutions.html#energy", "/solutions.html#cabinet", "/solutions.html#retrofit"]],
    ["项目案例", ["/cases.html#control-cabinet", "/cases.html#machine-cover", "/cases.html#equipment-base", "/cases.html#turnover-bin"]]
  ]);
});

test("publishes evidence-led corporate sections without unsupported blanket tolerance claims", () => {
  const publicDir = path.join(__dirname, "../public");
  const capabilities = fs.readFileSync(path.join(publicDir, "capabilities.html"), "utf8");
  const solutions = fs.readFileSync(path.join(publicDir, "solutions.html"), "utf8");
  const cases = fs.readFileSync(path.join(publicDir, "cases.html"), "utf8");
  const factory = fs.readFileSync(path.join(publicDir, "factory.html"), "utf8");

  for (const id of ["laser-cutting", "cnc-bending", "welding", "finishing", "assembly", "no-drawing", "materials-files", "quality"])
    assert.match(capabilities, new RegExp(`id="${id}"`));
  for (const id of ["automation", "energy", "cabinet", "retrofit"])
    assert.match(solutions, new RegExp(`id="${id}"`));
  for (const id of ["control-cabinet", "machine-cover", "equipment-base", "turnover-bin"])
    assert.match(cases, new RegExp(`id="${id}"`));

  for (const model of ["GP 4020D-C 6000Pro", "HQ-LC4020", "HQ-LCF3000", "WC67Y-100T-3200", "S2-110T-3200"])
    assert.match(factory, new RegExp(model));
  assert.match(factory, /实际公差[^<]*材料、厚度、工艺和确认图纸/);
  assert.doesNotMatch(factory, /统一承诺[^<]*±0\.1/);
  assert.match(factory, /质量检查节点/);
  assert.match(factory, /包装与交付/);
});

test("provides consistent three-way conversion panels and responsive dropdown styles", () => {
  const publicDir = path.join(__dirname, "../public");
  for (const page of ["capabilities.html", "solutions.html", "cases.html", "factory.html", "process.html", "news.html", "contact.html", "tracking.html", "about.html"]) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    assert.match(html, /class="conversion-panel"/);
    assert.match(html, />提交加工需求</);
    assert.match(html, />无图需求说明</);
    assert.match(html, />联系客服</);
  }
  const styles = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(styles, /\.nav-group/);
  assert.match(styles, /\.nav-menu/);
  assert.match(styles, /scroll-margin-top:\s*110px/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.nav-menu/);
});

function formFragment(html, id) {
  const match = html.match(new RegExp(`<form\\b[^>]*id="${id}"[\\s\\S]*?</form>`));
  assert.ok(match, `${id} form must exist`);
  return match[0];
}

test("renders order status data as text nodes instead of HTML", () => {
  const createdTags = [];
  const createElement = (tagName) => {
    createdTags.push(tagName);
    return {
    children: [],
    className: "",
    textContent: "",
    append(...children) { this.children.push(...children); }
    };
  };
  const malicious = '<img src=x onerror="globalThis.pwned=true">';
  globalThis.pwned = false;
  const container = { children: [], ownerDocument: { createElement }, append(...children) { this.children.push(...children); } };
  renderOrderResult(container, {
    orderNumber: malicious,
    status: malicious,
    events: [{ title: malicious, occurredAt: malicious }]
  });
  const card = container.children[0];
  assert.equal(card.className, "order-card");
  assert.equal(card.children[0].textContent, malicious);
  assert.equal(card.children[1].textContent, `当前状态：${malicious}`);
  assert.equal(card.children[2].children[0].children[0].textContent, malicious);
  assert.equal(card.children[2].children[0].children[1].textContent, "Invalid Date");
  assert.deepEqual(createdTags, ["div", "strong", "p", "ol", "li", "strong", "time"]);
  assert.equal(globalThis.pwned, false);
});

test("keeps a file read failure specific to the selected file", async () => {
  const originalFileReader = global.FileReader;
  try {
    global.FileReader = class { readAsDataURL() { this.onerror(); } };
    await assert.rejects(() => fileToAttachment({ name: "drawing.dxf", size: 1 }), { message: "drawing.dxf 读取失败" });
  } finally {
    global.FileReader = originalFileReader;
  }
});

test("normalizes non-JSON API failures to a customer-safe message", async () => {
  const response = { ok: false, headers: { get: () => "text/html" }, text: async () => "<html>gateway error</html>" };
  await assert.rejects(() => parseApiResponse(response), { message: "服务暂时不可用，请稍后重试或电话联系" });
});

test("locks a form while its request is pending and restores the button afterwards", async () => {
  let resolveRequest;
  let calls = 0;
  const button = { disabled: false };
  const attributes = new Map();
  const form = {
    dataset: {},
    querySelector: () => button,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  };
  const request = () => new Promise((resolve) => { calls += 1; resolveRequest = resolve; });
  const first = runLockedRequest(form, request);
  const duplicate = runLockedRequest(form, request);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(calls, 1);
  assert.equal(await duplicate, undefined);
  resolveRequest();
  await first;
  assert.equal(button.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);
});

test("blocks attachment selections beyond count and real byte limits", () => {
  const mib = 1024 * 1024;
  assert.equal(fileSelectionProblem([{ name: "a.pdf", size: 10 * mib }, { name: "b.pdf", size: 10 * mib }, { name: "c.pdf", size: 10 * mib }]), null);
  assert.equal(fileSelectionProblem([{ name: "a.pdf", size: 1 }, { name: "b.pdf", size: 1 }, { name: "c.pdf", size: 1 }, { name: "d.pdf", size: 1 }]), "附件最多3个");
  assert.equal(fileSelectionProblem([{ name: "large.pdf", size: 20 * mib + 1 }]), "单个附件不能超过20MB");
  assert.equal(fileSelectionProblem([{ name: "a.pdf", size: 16 * mib }, { name: "b.pdf", size: 15 * mib }]), "附件总大小不能超过30MB");
});

test("uses the browser local calendar date for expected delivery minimum", () => {
  assert.equal(localDate(new Date(2026, 7, 9, 0, 30)), "2026-08-09");
});

test("serves the platform conversion contract without exposing unlisted static files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-platform-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const platform = await fetch(`${baseUrl}/platform.html`);
    const platformText = await platform.text();
    assert.equal(platform.status, 200);
    assert.match(platform.headers.get("content-type"), /text\/html/);
    assert.match(platformText, /<link rel="canonical" href="https:\/\/order\.wljixie\.com\/">/);
    assert.match(platformText, /id="inquiry-form"/);
    assert.match(platformText, /id="order-lookup-form"/);
    assert.match(platformText, /客户订单中心/);

    for (const pathname of ["/src/server.js", "/private/secret.txt", "/not-a-public-file.html"]) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 404, `${pathname} must not fall back to a public page`);
    }
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("presents the platform hero as a full-bleed background with an overlay content panel", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-platform-hero-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/platform.html`);
    const platform = await response.text();
    const hero = platform.match(/<section class="platform-hero"[\s\S]*?<\/section>/)?.[0] || "";
    assert.match(hero, /<div class="platform-hero-content">/);
    assert.doesNotMatch(hero, /<img\b/);

    const styles = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
    assert.match(styles, /\.platform-hero\s*\{[\s\S]*?background-image:[\s\S]*?hero-laser-cutting\.jpg/);
    assert.match(styles, /\.platform-hero-content\s*\{[\s\S]*?max-width:/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("serves the approved website brand mark", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-brand-mark-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/brand/wl-mark.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.ok((await response.text()).includes("<svg"));
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("serves the factory service film as a non-empty MP4 asset", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-platform-video-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/video/factory-service.mp4`);
    const content = await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.ok(content.byteLength > 0, "factory service film must not be empty");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("serves a single byte range for the factory service film", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-platform-video-range-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/video/factory-service.mp4`, { headers: { range: "bytes=0-1023" } });
    const content = await response.arrayBuffer();
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.match(response.headers.get("content-range"), /^bytes 0-1023\/\d+$/);
    assert.equal(response.headers.get("content-length"), "1024");
    assert.equal(content.byteLength, 1024);

    const invalid = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/video/factory-service.mp4`, { headers: { range: "bytes=999999999-" } });
    assert.equal(invalid.status, 416);
    assert.match(invalid.headers.get("content-range"), /^bytes \*\/\d+$/);
    assert.equal((await invalid.arrayBuffer()).byteLength, 0);

    const fullSize = fs.statSync(path.join(__dirname, "../public/assets/video/factory-service.mp4")).size;
    for (const range of ["items=0-10", "bytes=0-1,3-4", "bytes=-"]) {
      const ignored = await fetch(`http://127.0.0.1:${app.server.address().port}/assets/video/factory-service.mp4`, { headers: { range } });
      assert.equal(ignored.status, 200, `${range} must fall back to a full response`);
      assert.equal((await ignored.arrayBuffer()).byteLength, fullSize);
    }
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("presents a complete industrial order-platform journey with accessible media and service rules", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-platform-content-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/platform.html`);
    const platform = await response.text();
    assert.equal(response.status, 200);

    for (const heading of ["急件、小批量、无图纸", "六类常见需求", "工厂现场与加工证据", "加工如何推进", "无图也能提交需求", "付款确认后再开工", "常见问题", "客户订单中心"]) {
      assert.match(platform, new RegExp(heading));
    }
    for (const label of ["有图纸加工", "无图沟通", "维修替换", "小批量打样", "设备罩壳", "机架机箱"]) assert.match(platform, new RegExp(label));
    assert.match(platform, /<video[^>]*controls[^>]*muted[^>]*playsinline[^>]*preload="metadata"[^>]*poster="\/assets\/images\/factory-workshop\.jpg"[^>]*>/);
    assert.match(platform, /<source src="\/assets\/video\/factory-service\.mp4" type="video\/mp4">/);
    assert.match(platform, /class="[^"]*desktop-platform-cta[^"]*"[^>]*href="#submit-inquiry"/);
    assert.match(platform, /href="tel:13456125046">电话联系/);
    assert.match(platform, /href="\/privacy\.html">隐私政策/);
    assert.match(platform, /href="\/service-rules\.html">服务规则/);
    assert.match(platform, /href="https:\/\/www\.jianweilingtuo\.com\/">国际业务/);
    assert.match(platform, /<form id="inquiry-form"[^>]*action="\/api\/inquiries"/);
    for (const field of ["drawingMode", "contactName", "phone", "region", "quantity", "expectedDate", "material", "dimensions", "description", "attachments", "consent"]) {
      assert.match(platform, new RegExp(`name="${field}"`));
    }
    for (const field of ["contactName", "phone", "region", "quantity", "expectedDate", "description", "consent"]) assert.match(platform, new RegExp(`name="${field}"[^>]*required`));
    assert.match(platform, /type="radio" name="drawingMode" value="drawing" checked/);
    assert.match(platform, /type="radio" name="drawingMode" value="none"/);
    assert.match(platform, /name="attachments" type="file" multiple accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp,\.dxf,\.dwg,\.step,\.stp,\.zip"/);
    assert.match(platform, /最多3个、单个20MB、总计30MB/);
    const orderForm = formFragment(platform, "order-lookup-form");
    assert.match(orderForm, /data-api="\/api\/order-status"/);
    assert.match(orderForm, /name="orderNumber"[^>]*required/);
    assert.match(orderForm, /name="phone" inputmode="tel" required/);
    assert.match(platform, /<div class="mobile-actions"><a href="tel:13456125046">电话联系<\/a><a href="#order-center">订单查询<\/a><a class="active" href="#submit-inquiry">提交需求<\/a>/);
    const platformImages = {
      "laser-equipment.jpg": [1600, 1066], "bending-equipment.jpg": [1600, 1066],
      "welding-process.jpg": [961, 502], "finishing-line.jpg": [961, 502], "case-machine-cover.jpg": [800, 800], "case-control-cabinet.jpg": [1600, 1200]
    };
    for (const [filename, [width, height]] of Object.entries(platformImages)) {
      assert.match(platform, new RegExp(`src="/assets/images/${filename}"[^>]*alt="[^"]+"[^>]*width="${width}" height="${height}"`));
    }
    assert.equal([...platform.matchAll(/loading="lazy"/g)].length, 6);
    const styles = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
    assert.match(styles, /#service-entry,[\s\S]*?#evidence,[\s\S]*?#submit-inquiry,[\s\S]*?#order-center,[\s\S]*?#no-drawing\s*\{\s*scroll-margin-top:\s*96px/);
    assert.match(styles, /@media \(max-width: 900px\)\s*\{[\s\S]*?#service-entry,[\s\S]*?#evidence,[\s\S]*?#submit-inquiry,[\s\S]*?#order-center,[\s\S]*?#no-drawing\s*\{\s*scroll-margin-top:\s*156px/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("serves every public page with its own metadata and shared conversion actions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-static-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const pages = [
      ["/", "宁波未来机械"],
      ["/capabilities.html", "加工能力"],
      ["/solutions.html", "行业解决方案"],
      ["/cases.html", "项目案例"],
      ["/factory.html", "工厂实力"],
      ["/quote.html", "快速下单"],
      ["/process.html", "服务流程"],
      ["/tracking.html", "订单查询"],
      ["/news.html", "资讯中心"],
      ["/news/no-drawing-quote.html", "无图纸询价"],
      ["/about.html", "关于未来机械"],
      ["/contact.html", "联系未来机械"],
      ["/privacy.html", "隐私政策"],
      ["/service-rules.html", "服务规则"]
    ];

    for (const [pathname, pageHeading] of pages) {
      const page = await fetch(`${baseUrl}${pathname}`);
      const text = await page.text();
      assert.equal(page.status, 200, `${pathname} should be public`);
      assert.match(page.headers.get("content-type"), /text\/html/);
      assert.match(text, new RegExp(`<title>[^<]*${pageHeading}`));
      assert.match(text, /<meta name="description" content="[^"]+">/);
      assert.match(text, new RegExp(`<link rel="canonical" href="https://wljixie\\.com${pathname === "/" ? "/" : pathname}">`));
      assert.match(text, /href="\/capabilities\.html"[^>]*>加工能力/);
      assert.match(text, pathname === "/" ? /href="\/platform\.html"[^>]*>快速下单/ : /href="\/quote\.html"[^>]*>快速下单/);
      assert.match(text, /href="\/tracking\.html"[^>]*>订单查询/);
      assert.match(text, /class="desktop-links"[^>]*>.*href="\/tracking\.html">订单查询.*href="\/news\.html">资讯中心.*href="\/contact\.html">联系我们/s);
      assert.match(text, /https:\/\/www\.jianweilingtuo\.com\//);
      assert.match(text, /class="mobile-actions"/);
      assert.match(text, /上线前核对：宁波市北仑区柴桥街道河南顾106号/);
      assert.match(text, /08:00–17:00/);
      assert.match(text, /浙ICP备2026043336号/);
    }

    const home = await fetch(baseUrl);
    const homeText = await home.text();
    assert.match(homeText, /企业微信二维码待提供/);
    assert.match(homeText, /application\/ld\+json/);

    const quote = await fetch(`${baseUrl}/quote.html`);
    const quoteText = await quote.text();
    assert.match(quoteText, /id="inquiry-form"/);
    assert.match(quoteText, /action="\/api\/inquiries"/);
    assert.match(quoteText, /最多3个、单个20MB、总计30MB/);

    const tracking = await fetch(`${baseUrl}/tracking.html`);
    const trackingText = await tracking.text();
    assert.match(trackingText, /id="order-lookup-form"/);
    assert.match(trackingText, /data-api="\/api\/order-status"/);

    const admin = await fetch(`${baseUrl}/admin.html`);
    const adminText = await admin.text();
    assert.equal(admin.status, 200);
    assert.match(adminText, /客服工作台/);
    assert.match(adminText, /id="admin-token"/);
    assert.match(adminText, /id="order-list"/);

    const image = await fetch(`${baseUrl}/assets/images/factory-workshop.jpg`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /image\/jpeg/);
    assert.ok((await image.arrayBuffer()).byteLength > 10000);

    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Sitemap: https:\/\/wljixie\.com\/sitemap\.xml/);

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    const sitemapText = await sitemap.text();
    assert.match(sitemapText, /https:\/\/wljixie\.com\/quote\.html/);
    assert.match(sitemapText, /https:\/\/wljixie\.com\/news\/no-drawing-quote\.html/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("presents the corporate homepage journey with valid media, conversion actions and shared styles", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-home-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(baseUrl);
    const home = await response.text();
    assert.equal(response.status, 200);

    for (const heading of ["可接需求", "核心工艺", "行业应用", "精选案例", "工厂与质检", "服务优势", "交付流程", "知识内容", "开始您的加工需求"]) {
      assert.match(home, new RegExp(`<h2[^>]*>${heading}`));
    }

    assert.doesNotMatch(home, /href="\/quote\.html"/);
    assert.match(home, /href="\/tracking\.html"/);
    assert.doesNotMatch(home, />1 件起</);
    assert.match(home, />小批量可沟通</);

    const conversionActions = [...home.matchAll(/<a class="button(?: [^"]*)?" href="([^"]+)">(快速下单|提交加工需求|发起需求沟通|进入下单平台)<\/a>/g)];
    assert.equal(conversionActions.length, 5);
    assert.deepEqual(conversionActions.map(([, href]) => href), Array(5).fill("/platform.html"));
    assert.match(home, /class="active" href="\/platform\.html">快速下单/);

    const assets = {
      "hero-laser-cutting.jpg": [1920, 1080],
      "laser-equipment.jpg": [1600, 1066],
      "bending-equipment.jpg": [1600, 1066],
      "welding-process.jpg": [961, 502],
      "finishing-line.jpg": [961, 502],
      "case-machine-cover.jpg": [800, 800],
      "case-control-cabinet.jpg": [1600, 1200],
      "factory-floor.jpg": [1600, 1066]
    };
    assert.equal([...home.matchAll(/<img\b/g)].length, Object.keys(assets).length + 1);
    for (const [filename, [width, height]] of Object.entries(assets)) {
      assert.match(home, new RegExp(`src="/assets/images/${filename}"[^>]*alt="[^"]+"[^>]*width="${width}" height="${height}"`));
    }
    assert.equal([...home.matchAll(/loading="lazy"/g)].length, 7);

    const styles = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
    for (const token of ["--ink", "--line", "--muted", "--orange", "--shadow", "--steel"]) {
      assert.match(styles, new RegExp(`${token}:`));
    }
    for (const selector of [".site-header", ".brand", ".section", ".page-hero", ".site-footer", ".mobile-actions", ".button", ".form-card", ".lookup-form", "select:focus-visible"]) {
      assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    for (const selector of [".admin-page", ".promise-bar", ".service-grid", ".button-ghost"]) {
      assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(styles, /--orange-text:\s*#b84612/);
    assert.match(styles, /\.text-link\s*\{[^}]*color:\s*var\(--orange-text\)/);
    assert.match(styles, /\.button-small\s*\{[^}]*min-height:\s*46px/);
    assert.doesNotMatch(styles, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.site-header nav\s*\{\s*display:\s*none/);
    assert.match(styles, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.site-header nav\s*\{[\s\S]*overflow-x:\s*auto/);
    assert.match(styles, /\.site-header nav a:hover,[\s\S]*?color:\s*var\(--orange-text\)/);
    assert.match(styles, /\.eyebrow\s*\{[^}]*color:\s*var\(--orange-text\)/);
    assert.match(styles, /\.page-hero \.eyebrow,[\s\S]*?color:\s*#ff9a6c/);
    assert.match(styles, /\.promise-bar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns/);
    assert.match(styles, /\.service-grid\s*\{[^}]*display:\s*grid[^}]*minmax\(280px, 1fr\)/);
    assert.match(styles, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.admin-page #load-admin\s*\{[^}]*display:\s*inline-flex/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("does not expose private upload paths", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-private-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(`${baseUrl}/private/uploads/file.pdf`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("uses the 1320px desktop system and curated local imagery", () => {
  const publicDir = path.join(__dirname, "../public");
  const styles = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const home = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const platform = fs.readFileSync(path.join(publicDir, "platform.html"), "utf8");
  const capabilities = fs.readFileSync(path.join(publicDir, "capabilities.html"), "utf8");
  const cases = fs.readFileSync(path.join(publicDir, "cases.html"), "utf8");
  const factory = fs.readFileSync(path.join(publicDir, "factory.html"), "utf8");
  const solutions = fs.readFileSync(path.join(publicDir, "solutions.html"), "utf8");
  const news = fs.readFileSync(path.join(publicDir, "news.html"), "utf8");

  assert.match(styles, /--content-max:\s*1320px/);
  assert.doesNotMatch(styles, /1180px/);
  for (const selector of [".site-header", ".page-hero", ".section", ".site-footer", ".platform-hero"]) {
    assert.match(styles, new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]*?var\\(--content-max\\)`));
  }

  const heroPattern = /<img[^>]*src="\/assets\/images\/hero-laser-cutting\.jpg"[^>]*alt="[^"]+"[^>]*width="1920" height="1080"[^>]*>/;
  assert.match(home, heroPattern);
  assert.doesNotMatch(home.match(heroPattern)[0], /loading="lazy"/);
  assert.match(styles, /\.platform-hero\s*\{[\s\S]*?url\("\/assets\/images\/hero-laser-cutting\.jpg"\)/);

  for (const filename of ["laser-equipment.jpg", "bending-equipment.jpg", "welding-process.jpg", "finishing-line.jpg"]) {
    assert.match(capabilities, new RegExp(`src="/assets/images/${filename}"[^>]*loading="lazy"`));
  }
  for (const filename of ["case-control-cabinet.jpg", "case-machine-cover.jpg", "case-sheet-metal-base.jpg", "case-turnover-bin.jpg"]) {
    assert.match(cases, new RegExp(`src="/assets/images/${filename}"[^>]*loading="lazy"`));
  }
  assert.match(factory, /src="\/assets\/images\/factory-floor\.jpg"[^>]*loading="lazy"/);
  for (const filename of ["industry-automation.jpg", "industry-energy.jpg", "industry-telecom.jpg", "industry-agriculture.jpg"]) {
    assert.match(solutions, new RegExp(`src="/assets/images/${filename}"[^>]*loading="lazy"`));
  }
  assert.equal([...solutions.matchAll(/class="scene-label">应用场景示意/g)].length, 4);
  for (const filename of ["news-rfq.jpg", "news-material.jpg", "news-welding.jpg"]) {
    assert.match(news, new RegExp(`src="/assets/images/${filename}"[^>]*loading="lazy"`));
  }
});

test("uses the approved WL brand mark across public website headers", () => {
  const publicDir = path.join(__dirname, "../public");
  const pages = fs.readdirSync(publicDir, { recursive: true })
    .filter((name) => name.endsWith(".html") && name !== "admin.html");
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    assert.match(html, /class="brand-mark"[^>]*src="\/assets\/brand\/wl-mark\.svg"/,
      `${page} must use the formal WL logo`);
    assert.doesNotMatch(html, /<span class="brand-mark">WL<\/span>/);
  }
});

test("the WL mark expresses fabricated structural-metal construction", () => {
  const logo = fs.readFileSync(path.join(__dirname, "../brand/logo/wl-mark.svg"), "utf8");
  assert.match(logo, /id="box-section"/);
  assert.match(logo, /id="tube-openings"/);
  assert.match(logo, /id="channel-l"/);
  assert.match(logo, /id="weld-seam"/);
  assert.match(logo, /stroke-dasharray=/);
});

test("ships the selected 3D WL logo application suite", () => {
  const base = path.join(__dirname, "..");
  const assets = [
    "brand/source/wl-3d-selected.png",
    "brand/wechat-mini-avatar-144.png",
    "brand/wecom-avatar-1024.png",
    "public/assets/brand/wl-mark-1024.png",
    "public/assets/brand/wl-mark-144.png",
    "public/assets/brand/wl-mark-transparent.png",
    "public/assets/brand/wl-favicon-32.png",
    "public/assets/brand/wl-social-card-1200x630.jpg",
    "miniprogram/assets/brand/share-card.jpg"
  ];
  for (const asset of assets) {
    const filename = path.join(base, asset);
    assert.ok(fs.existsSync(filename), `${asset} must exist`);
    assert.ok(fs.statSync(filename).size > 1000, `${asset} must not be empty`);
  }
  const home = fs.readFileSync(path.join(base, "public/index.html"), "utf8");
  assert.match(home, /rel="icon" href="\/assets\/brand\/wl-favicon-32\.png"/);
});
