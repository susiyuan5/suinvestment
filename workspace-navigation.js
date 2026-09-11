(function (root) {
  "use strict";
  if (root.WorkspaceNavigation) return;
  const views = [
    "weekly",
    "holdings",
    "dip",
    "tools-watchlist",
    "tools-research",
    "tools-data",
  ];
  const byId = (id) => document.getElementById(id),
    menu = byId("moreTools");
  let current = "weekly";
  function resolve(hash) {
    let key;
    try {
      key = decodeURIComponent((hash || "").replace(/^#/, ""));
    } catch {
      return { view: "weekly" };
    }
    if (views.includes(key)) return { view: key };
    const target = byId(key),
      view = target?.closest("[data-workspace-view]")?.dataset.workspaceView;
    const settings = target?.closest("[data-settings-panel]")?.dataset
      .settingsPanel;
    return { view: view || "weekly", target, settings };
  }
  function reveal(target) {
    for (let node = target; node; node = node.parentElement)
      if (node.tagName === "DETAILS") node.open = true;
  }
  function render(hash, focus = false) {
    const route = resolve(hash);
    current = route.view;
    document.querySelectorAll("[data-workspace-view]").forEach((view) => {
      view.hidden = view.dataset.workspaceView !== current;
    });
    document.querySelectorAll("[data-view-link]").forEach((link) => {
      const active = link.dataset.viewLink === current;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (menu) menu.open = false;
    if (current === "tools-watchlist") byId("watchlist").open = true;
    if (current === "tools-data") byId("dataQualityPanel").open = true;
    if (route.target) reveal(route.target);
    if (route.settings)
      root.dispatchEvent(
        new CustomEvent("settings-center:open", {
          detail: { category: route.settings },
        }),
      );
    if (focus && !route.settings) {
      const target =
        route.target || byId("view-" + current).querySelector("h2");
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }
    requestAnimationFrame(() => root.dispatchEvent(new Event("resize")));
    root.dispatchEvent(
      new CustomEvent("workspace:view-changed", { detail: { view: current } }),
    );
  }
  function navigate(hash) {
    if (location.hash !== hash) history.pushState(null, "", hash);
    render(hash, true);
  }
  document.addEventListener("click", (event) => {
    const settings = event.target.closest("[data-open-settings]");
    if (settings) {
      root.dispatchEvent(
        new CustomEvent("settings-center:open", {
          detail: { category: settings.dataset.openSettings },
        }),
      );
      return;
    }
    const opener = event.target.closest("[data-open-section]");
    if (opener) {
      const target = byId(opener.dataset.openSection);
      if (target) {
        reveal(target);
        target.querySelector("input,select,summary")?.focus();
        target.scrollIntoView({ block: "start" });
      }
      return;
    }
    const link = event.target.closest('a[href^="#"]');
    if (
      !link ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const hash = link.getAttribute("href");
    if (
      hash === "#" ||
      (!views.includes(hash.slice(1)) && !byId(hash.slice(1)))
    )
      return;
    event.preventDefault();
    navigate(hash);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu?.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  });
  root.addEventListener("hashchange", () => render(location.hash, true));
  root.addEventListener("popstate", () => render(location.hash, true));
  for (const [source, target] of [
    ["weeklyBaseBudget", "weeklyNormalCompact"],
    ["weeklyCrashFund", "weeklyCrashCompact"],
  ]) {
    const sync = () => {
      byId(target).textContent = byId(source).textContent;
    };
    sync();
    new MutationObserver(sync).observe(byId(source), {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  const syncDip = () => {
    const value = byId("dipSummary").querySelector(
      '[data-metric="balance"] strong',
    );
    byId("weeklyDipCompact").textContent = value?.textContent || "账本待核对";
  };
  new MutationObserver(syncDip).observe(byId("dipSummary"), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  syncDip();
  root.WorkspaceNavigation = Object.freeze({
    navigate,
    resolve,
    get current() {
      return current;
    },
  });
  render(location.hash, Boolean(location.hash));
})(window);
