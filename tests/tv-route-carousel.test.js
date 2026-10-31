const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tvSource = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
const tvStyles = fs.readFileSync(path.join(root, "public", "tv.css"), "utf8");

assert.ok(tvSource.includes("order.routes.length > 7"), "Only routes beyond seven may enter the TV route carousel");
assert.ok(tvSource.includes("route-carousel"), "Long route rows must render a dedicated carousel viewport");
assert.ok(tvSource.includes("route-track"), "Long route rows must render a movable route track");
assert.ok(tvSource.includes("turnRouteCarousel"), "TV must advance long route carousels independently");
assert.ok(tvSource.includes("3000"), "Long route carousels must advance every three seconds");
assert.ok(tvSource.includes("routeDirection"), "Long route carousels must reverse at both ends");
assert.ok(tvStyles.includes(".routes.route-carousel"), "The route carousel viewport must clip overflow");
assert.ok(tvStyles.includes(".route-track"), "The route track must animate horizontal movement");
assert.ok(tvSource.includes("captureMobileRouteScroll"), "Mobile board must capture each route row scroll position before rendering");
assert.ok(tvSource.includes("restoreMobileRouteScroll"), "Mobile board must restore each route row scroll position after rendering");
assert.ok(tvSource.includes('data-route-key="${esc(routeCarouselKey(order))}"'), "Mobile route rows must expose a stable work-order key");
assert.ok(tvSource.includes("route.scrollLeft"), "Mobile board must read and restore horizontal scroll offsets");
assert.ok(tvSource.includes("route.scrollWidth - route.clientWidth"), "Restored offsets must be clamped to the current scroll range");
assert.ok(tvSource.includes("requestAnimationFrame"), "Mobile route offsets must be restored after the replacement DOM is laid out");

console.log("tv-route-carousel: ok");
