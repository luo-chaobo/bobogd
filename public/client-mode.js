(function exposeClientMode(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.bobogdClientMode = api;
})(typeof globalThis === "undefined" ? null : globalThis, function createClientMode() {
  function params(search) {
    return new URLSearchParams(search || "");
  }

  function isTabletApp(search) {
    return params(search).get("tabletApp") === "1";
  }

  function interactiveBoardNavigation(token, dispatch, search) {
    const query = new URLSearchParams({ mobile: "1" });
    if (dispatch) query.set("dispatch", "1");
    query.set("viewerToken", String(token || ""));
    if (isTabletApp(search)) query.set("tabletApp", "1");
    return {
      url: `/tv.html?${query}`,
      target: isTabletApp(search) ? "self" : "blank",
    };
  }

  function pdfPreviewMode(fileType, search, compatible) {
    if (String(fileType || "").toLowerCase() !== "pdf") return "native";
    const query = params(search);
    if (compatible || (query.get("mobile") === "1" && query.get("compact") === "1")) return "canvas";
    return "iframe";
  }

  function startPdfIframeFallback(onFallback, schedule = setTimeout, cancel = clearTimeout) {
    const timer = schedule(onFallback, 8000);
    return () => cancel(timer);
  }

  return { interactiveBoardNavigation, isTabletApp, pdfPreviewMode, startPdfIframeFallback };
});
