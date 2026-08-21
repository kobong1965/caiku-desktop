async (page) => {
  const cases = [
    { name: "source", url: "http://127.0.0.1:4173/index.html?module=source" },
    { name: "library", url: "http://127.0.0.1:4173/index.html?module=library" },
    { name: "scripts", url: "http://127.0.0.1:4173/index.html?module=scripts" },
    { name: "editing-step1", url: "http://127.0.0.1:4173/index.html?module=editing&step=1" },
    { name: "editing-step5", url: "http://127.0.0.1:4173/index.html?module=editing&step=5" },
    {
      name: "settings",
      url: "http://127.0.0.1:4173/index.html?module=source",
      setup: async () => page.evaluate(() => document.querySelector('[data-route="settings"]')?.click())
    },
    {
      name: "material-picker",
      url: "http://127.0.0.1:4173/index.html?module=editing&step=1",
      setup: async () => page.evaluate(() => document.querySelector("#openMaterialPicker")?.click())
    }
  ];
  const viewports = [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 768, height: 900 }
  ];
  const zooms = [1, 1.25, 1.5];
  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const zoom of zooms) {
      for (const testCase of cases) {
        await page.goto(testCase.url);
        if (testCase.setup) await testCase.setup();
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
        await page.waitForTimeout(60);

        const metrics = await page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          const dialog = document.querySelector("dialog[open]");
          const main = document.querySelector("main");
          const header = document.querySelector(".workspace-header");
          const sidebar = document.querySelector(".workflow-sidebar");
          return {
            rootOverflowX: Math.max(0, root.scrollWidth - root.clientWidth),
            bodyOverflowX: Math.max(0, body.scrollWidth - body.clientWidth),
            dialogOverflowX: dialog ? Math.max(0, dialog.scrollWidth - dialog.clientWidth) : 0,
            mainScrollable: main ? main.scrollHeight > main.clientHeight : false,
            headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
            sidebarTop: sidebar ? Math.round(sidebar.getBoundingClientRect().top) : null,
            openDialog: Boolean(dialog)
          };
        });

        const zoomLabel = String(zoom).replace(".", "_");
        const file = `D:/codex项目/抖音素材分配器/output/playwright/ui-matrix/${viewport.name}-z${zoomLabel}-${testCase.name}.png`;
        await page.screenshot({ path: file });
        results.push({ viewport: viewport.name, zoom, page: testCase.name, ...metrics });
      }
    }
  }

  return results;
}
