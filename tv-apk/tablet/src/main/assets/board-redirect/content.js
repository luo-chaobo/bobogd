(() => {
  if (location.pathname !== "/" && location.pathname !== "/index.html") return;

  let requesting = false;

  async function openBoardWhenLoggedIn() {
    if (requesting) return;
    let user;
    try {
      user = JSON.parse(localStorage.getItem("work_user") || "null");
    } catch {
      localStorage.removeItem("work_user");
      return;
    }
    if (!user?.id) return;

    requesting = true;
    try {
      const response = await fetch("/api/tv-viewer-token", {
        headers: { "x-user-id": String(user.id) },
      });
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("work_user");
        location.replace("/?tabletApp=1&loginExpired=1");
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.token) return;
      const query = new URLSearchParams({ mobile: "1", viewerToken: data.token });
      location.replace(`/tv.html?${query}`);
    } catch {
      // Keep the login page usable and retry after transient network failures.
    } finally {
      requesting = false;
    }
  }

  openBoardWhenLoggedIn();
  setInterval(openBoardWhenLoggedIn, 750);
})();
