"use strict";

// Optional integration suite: node scripts/browser-tests.cjs.
// Install Playwright separately, or set PLAYWRIGHT_MODULE to its absolute path.
// CHROME_EXECUTABLE_PATH can select Chrome for Testing / Chromium without
// installing a second browser. No existing browser profile is ever opened.
// Branded Chrome additionally needs CHROME_LOAD_VIA_CDP=1 because its command
// line extension-loading flags are disabled in current releases.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch {
  console.error("Browser tests need Playwright. Install it separately or set PLAYWRIGHT_MODULE to its module path.");
  process.exit(1);
}

const extensionPath = path.resolve(__dirname, "..");
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "simple-mouse-gestures-test-"));
const origin = "https://gestures.test";
const frameOrigin = "https://frame.test";
const loadViaCDP = process.env.CHROME_LOAD_VIA_CDP === "1";
const testFilter = process.env.BROWSER_TEST_FILTER ? new RegExp(process.env.BROWSER_TEST_FILTER) : null;
let context;
let passed = 0;
let failed = 0;

async function fixture({ frame = null, svg = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/previous`);
  await page.goto(`${origin}/${svg ? "drawing.svg" : frame ? `${frame}-frame` : "current"}`);
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus());
  if (frame) {
    await page.frameLocator("iframe").locator("body").waitFor();
  }
  // Loading a cross-process frame does not synchronously install its compositor
  // hit-test region. Let the focused page and its frames paint before input.
  await Promise.all(page.frames().map(frame => frame.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }))));
  return { page, errors };
}

async function gesture(page, points, steps = 1) {
  await page.mouse.move(...points[0]);
  await page.mouse.down({ button: "right" });
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps });
  await page.mouse.up({ button: "right" });
}

async function expectClosed(page, operation) {
  const closed = page.waitForEvent("close", { timeout: 3000 });
  await Promise.all([closed, operation()]);
}

async function expectUnchanged(page, url = page.url()) {
  await delay(120);
  assert.equal(page.isClosed(), false, "gesture unexpectedly closed the tab");
  assert.equal(page.url(), url, "gesture unexpectedly navigated the tab");
}

async function test(name, run) {
  if (testFilter && !testFilter.test(name)) return;
  const existing = new Set(context.pages());
  try {
    await run();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failed++;
  } finally {
    for (const page of context.pages()) {
      if (!existing.has(page)) await page.close().catch(() => {});
    }
  }
}

async function dispatchSynthetic(page, kind) {
  return page.evaluate(kind => {
    const pointer = kind === "PointerEvent";
    const EventClass = pointer ? PointerEvent : MouseEvent;
    const prefix = pointer ? "pointer" : "mouse";
    const values = [
      ["down", 100, 100, 2], ["move", 100, 160, 2],
      ["move", 160, 160, 2], ["up", 160, 160, 0],
    ];
    return values.map(([phase, clientX, clientY, buttons]) => {
      const event = new EventClass(`${prefix}${phase}`, {
        bubbles: true, cancelable: true, button: phase === "move" ? -1 : 2,
        buttons, clientX, clientY, screenX: clientX, screenY: clientY,
        pointerId: 1, pointerType: "mouse", isPrimary: true,
      });
      document.dispatchEvent(event);
      return event.isTrusted;
    });
  }, kind);
}

(async () => {
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      ...(process.env.CHROME_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
        : { channel: "chromium" }),
      headless: process.env.HEADED !== "1",
      viewport: { width: 1000, height: 700 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: loadViaCDP ? ["--enable-unsafe-extension-debugging"] : [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    context.setDefaultTimeout(3000);
    context.setDefaultNavigationTimeout(3000);
    if (loadViaCDP) {
      const browserSession = await context.browser().newBrowserCDPSession();
      await browserSession.send("Extensions.loadUnpacked", { path: extensionPath });
      await browserSession.detach();
    }
    await context.addInitScript(() => {
      window.menuEvents = [];
      window.addEventListener("contextmenu", event => {
        const record = { trusted: event.isTrusted, button: event.button, prevented: null };
        window.menuEvents.push(record);
        // Capture at Window observes the event even if the extension suppresses
        // propagation later. Read the final cancellation state after dispatch.
        setTimeout(() => { record.prevented = event.defaultPrevented; }, 0);
      }, true);
    });
    await context.route("https://**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".svg")) {
        return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="100%" height="100%" fill="#ddd"/></svg>' });
      }
      const child = url.pathname.includes("-frame")
        ? `<iframe src="${url.pathname.includes("cross") ? frameOrigin : origin}/child" style="position:absolute;left:400px;top:100px;width:300px;height:250px;border:0"></iframe>`
        : "";
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body style="margin:0;min-height:700px"><p>${url.pathname}</p>${child}</body></html>` });
    });
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent("serviceworker", { timeout: 10000 });
    console.log(`Browser ${context.browser().version()}; extension ${worker.url()}`);

    for (const kind of ["MouseEvent", "PointerEvent"]) {
      await test(`ignores forged ${kind} close gestures`, async () => {
        const { page } = await fixture();
        assert.equal(await page.evaluate(() => window.opener), null);
        assert.ok(await page.evaluate(() => history.length) > 1);
        assert.deepEqual(await dispatchSynthetic(page, kind), [false, false, false, false]);
        await expectUnchanged(page);
      });
    }

    await test("forged move/up cannot hijack a trusted right-button press", async () => {
      const { page } = await fixture();
      await page.mouse.move(100, 100);
      await page.mouse.down({ button: "right" });
      await dispatchSynthetic(page, "PointerEvent");
      await expectUnchanged(page);
      await page.mouse.up({ button: "right" });
      await expectUnchanged(page);
    });

    await test("synthetic blur cannot cancel a trusted gesture", async () => {
      const { page } = await fixture();
      await page.mouse.move(100, 100);
      await page.mouse.down({ button: "right" });
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expectClosed(page, async () => {
        await page.mouse.move(100, 180, { steps: 8 });
        await page.mouse.move(180, 180, { steps: 8 });
        await page.mouse.up({ button: "right" });
      });
    });

    await test("trusted Escape cancels a recognized close gesture before release", async () => {
      const { page } = await fixture();
      await page.mouse.move(100, 100);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(100, 180, { steps: 8 });
      await page.mouse.move(180, 180, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.mouse.up({ button: "right" });
      await expectUnchanged(page);
    });

    await test("trusted left/right gestures navigate backward and forward", async () => {
      const { page, errors } = await fixture();
      const current = page.url();
      await gesture(page, [[300, 300], [180, 300]], 24);
      await page.waitForURL(`${origin}/previous`);
      await gesture(page, [[180, 300], [300, 300]], 24);
      await page.waitForURL(current);
      assert.deepEqual(errors, []);
    });

    for (const steps of [1, 40]) {
      await test(`down-right closes with ${steps === 1 ? "sparse" : "dense"} move sampling`, async () => {
        const { page } = await fixture();
        await expectClosed(page, () => gesture(page, [[100, 100], [100, 210], [210, 210]], steps));
      });
      await test(`U-turn is unrecognized with ${steps === 1 ? "sparse" : "dense"} move sampling`, async () => {
        const { page } = await fixture();
        await gesture(page, [[100, 100], [210, 100], [100, 100]], steps);
        await expectUnchanged(page);
      });
    }

    await test("short down-right turn survives an extra sample before the corner", async () => {
      const { page } = await fixture();
      await expectClosed(page, () => gesture(page, [[100, 100], [100, 125], [100, 144], [122, 144]]));
    });

    await test("short U-turn cancels after samples near its extremum", async () => {
      const { page } = await fixture();
      await gesture(page, [[300, 300], [280, 300], [260, 300], [256, 300], [278, 300]]);
      await expectUnchanged(page);
    });

    await test("ordinary click jitter does not navigate", async () => {
      const { page } = await fixture();
      await gesture(page, [[100, 100], [106, 102], [102, 103]]);
      await expectUnchanged(page);
    });

    await test("double right-click allows the second native menu", async () => {
      const { page } = await fixture();
      await page.mouse.click(100, 100, { button: "right" });
      await page.mouse.click(100, 100, { button: "right" });
      await delay(30);
      const menus = await page.evaluate(() => window.menuEvents.filter(event => event.trusted));
      assert.equal(menus.length, 2);
      assert.equal(menus[0].prevented, true);
      assert.equal(menus[1].prevented, false);
    });

    await test("a drag does not arm the double-right-click menu", async () => {
      const { page } = await fixture();
      await gesture(page, [[100, 100], [100, 180]]);
      await page.mouse.click(100, 100, { button: "right" });
      await delay(30);
      const menus = await page.evaluate(() => window.menuEvents.filter(event => event.trusted));
      assert.ok(menus.length >= 2);
      assert.equal(menus.at(-1).prevented, true);
    });

    await test("keyboard context menu remains available", async () => {
      const { page } = await fixture();
      await page.keyboard.press("Shift+F10");
      await page.keyboard.press("ContextMenu");
      await delay(30);
      const menus = await page.evaluate(() => window.menuEvents.filter(event => event.trusted));
      assert.ok(menus.length > 0, "browser did not generate a keyboard context menu");
      for (const menu of menus) assert.equal(menu.prevented, false);
    });

    await test("synthetic context menu is not intercepted", async () => {
      const { page } = await fixture();
      const prevented = await page.evaluate(() => {
        const event = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(prevented, false);
    });

    for (const frame of ["same", "cross"]) {
      await test(`${frame}-origin iframe gesture closes its containing tab`, async () => {
        const { page } = await fixture({ frame });
        await expectClosed(page, () => gesture(page, [[450, 140], [450, 210], [540, 210]], 8));
      });
      await test(`${frame}-origin iframe crossing from parent completes one gesture`, async () => {
        const { page } = await fixture({ frame });
        await expectClosed(page, () => gesture(page, [[350, 80], [350, 170], [500, 170]], 12));
      });
      await test(`${frame}-origin iframe crossing to parent completes one gesture`, async () => {
        const { page } = await fixture({ frame });
        await expectClosed(page, () => gesture(page, [[500, 140], [500, 220], [780, 220]], 16));
      });
    }

    await test("cross-origin frame crossing also handles sparse input", async () => {
      const { page } = await fixture({ frame: "cross" });
      await expectClosed(page, () => gesture(page, [[350, 80], [350, 170], [500, 170]]));
    });

    await test("a forged gesture inside a cross-origin frame cannot close the tab", async () => {
      const { page } = await fixture({ frame: "cross" });
      const child = page.frames().find(frame => frame.url() === `${frameOrigin}/child`);
      assert.ok(child, "cross-origin fixture frame missing");
      await dispatchSynthetic(child, "PointerEvent");
      await expectUnchanged(page);
    });

    await test("iframe back gesture navigates the containing tab", async () => {
      const { page } = await fixture({ frame: "cross" });
      await gesture(page, [[620, 200], [480, 200]], 16);
      await page.waitForURL(`${origin}/previous`);
    });

    await test("SVG documents support core gestures without script errors", async () => {
      const { page, errors } = await fixture({ svg: true });
      await gesture(page, [[300, 300], [180, 300]], 16);
      await page.waitForURL(`${origin}/previous`);
      assert.deepEqual(errors, []);
    });

    console.log(`\n${passed} passed; ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } finally {
    await context?.close();
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
