"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.join(__dirname, "..");
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function worker() {
  let now = 10000;
  let nextTimer = 1;
  let onMessage;
  let onRemoved;
  const timers = new Map();
  const notifications = [];
  const actions = [];
  const failedActions = new Set();
  let failNotifications = false;
  let context;
  const defaultSender = { id: "test-extension", tab: { id: 7 }, frameId: 0, documentId: "document-main" };
  const chrome = {
    runtime: { id: "test-extension", onMessage: { addListener(fn) { onMessage = fn; } } },
    tabs: {
      onRemoved: { addListener(fn) { onRemoved = fn; } },
      sendMessage(tabId, message) {
        notifications.push({ tabId, message: plain(message) });
        return failNotifications ? Promise.reject(new Error("Document gone")) : Promise.resolve();
      },
    },
  };
  for (const method of ["goBack", "goForward", "remove"]) {
    chrome.tabs[method] = async tabId => {
      actions.push({ method, tabId });
      if (failedActions.has(method)) throw new Error("Tab unavailable");
    };
  }
  context = vm.createContext({
    chrome,
    Date: { now: () => now },
    setTimeout(callback, ms) {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    importScripts(filename) {
      assert.equal(filename, "recognizer.js");
      vm.runInContext(fs.readFileSync(path.join(extensionRoot, filename), "utf8"), context);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8"), context);

  function packet(phase, fields = {}) {
    return { type: "gesture", phase, pointerId: 1, x: 100, y: 100, time: now,
      ...(phase === "start" ? { gestureId: "gesture-1" } : {}), ...fields };
  }
  function dispatch(message, sender = defaultSender) {
    let respond;
    const response = new Promise(resolve => { respond = value => resolve(plain(value)); });
    const accepted = onMessage(message, sender, respond);
    if (accepted !== true) respond(undefined);
    return { accepted, response };
  }
  return {
    actions, notifications, defaultSender, failedActions,
    get timerCount() { return timers.size; },
    set failNotifications(value) { failNotifications = value; },
    sender(fields = {}) { return { ...defaultSender, ...fields }; },
    packet, dispatch,
    request(phase, fields, sender) { return dispatch(packet(phase, fields), sender).response; },
    removeTab(tabId) { onRemoved(tabId); },
    skipTime(ms) { now += ms; },
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = until;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

async function finish(h, fields, sender) {
  const response = h.request("end", fields, sender);
  await h.advance(10);
  return response;
}

test("rejects malformed messages and senders before creating sessions", async () => {
  const h = worker();
  const good = h.packet("start");
  const badMessages = [
    null, [], "gesture", {},
    { ...good, type: "closeTab" }, { ...good, phase: "unknown" },
    { ...good, pointerId: -1 }, { ...good, pointerId: 1.5 },
    { ...good, x: NaN }, { ...good, y: Infinity }, { ...good, time: "10000" },
    { ...good, x: 10000001 }, { ...good, y: -10000001 },
    { ...good, gestureId: "" }, { ...good, gestureId: "x".repeat(101) },
    { ...good, gestureId: 42 }, { ...good, phase: "cancel", gestureId: null },
  ];
  for (const message of badMessages) {
    const result = h.dispatch(message);
    assert.equal(result.accepted, false);
    assert.equal(await result.response, undefined);
  }
  for (const sender of [
    {}, h.sender({ id: "external-extension" }), h.sender({ tab: undefined }),
    h.sender({ tab: { id: -1 } }), h.sender({ tab: { id: 7.5 } }),
    h.sender({ frameId: -1 }), h.sender({ frameId: "0" }),
  ]) assert.equal(h.dispatch(good, sender).accepted, false);
  assert.equal(h.timerCount, 0);
  assert.deepEqual(h.actions, []);
  assert.deepEqual(h.notifications, []);
});

test("actions use the sender's tab and ignore a supplied arbitrary tab ID", async () => {
  const h = worker();
  await h.request("start", { tabId: 999 });
  await h.request("move", { x: 60, tabId: 999 });
  assert.deepEqual(await finish(h, { x: 60, tabId: 999 }), { ok: true, action: "back" });
  assert.deepEqual(h.actions, [{ method: "goBack", tabId: 7 }]);
  assert.equal(h.notifications.every(notification => notification.tabId === 7), true);
  assert.equal(h.timerCount, 0);
});

test("isolates sessions by tab and rejects another pointer's packets", async () => {
  const h = worker();
  const otherTab = h.sender({ tab: { id: 8 } });
  await h.request("start");
  await h.request("start", { gestureId: "other-gesture", pointerId: 2 }, otherTab);
  assert.equal(h.timerCount, 2);
  assert.deepEqual(await h.request("move", { pointerId: 2, x: 60 }), { ok: false });
  assert.deepEqual(await h.request("end", { pointerId: 2, x: 60 }), { ok: false });
  assert.equal(h.timerCount, 2);
  assert.deepEqual(await finish(h, { x: 60 }), { ok: true, action: "back" });
  assert.deepEqual(await finish(h, { pointerId: 2, x: 140 }, otherTab), { ok: true, action: "forward" });
  assert.deepEqual(h.actions, [{ method: "goBack", tabId: 7 }, { method: "goForward", tabId: 8 }]);
  assert.equal(h.timerCount, 0);
});

test("a gesture can move and finish in other frames while closing the containing tab", async () => {
  const h = worker();
  const firstFrame = h.sender({ frameId: 2, documentId: "child-document" });
  const secondFrame = h.sender({ frameId: 9, documentId: "other-child-document" });
  await h.request("start", { gestureId: "cross-frame" });
  assert.deepEqual(await h.request("move", { y: 144, time: 10001 }, firstFrame), {
    ok: true, gestureId: "cross-frame", action: null,
  });
  assert.deepEqual(await finish(h, { x: 122, y: 144, time: 10002 }, secondFrame), { ok: true, action: "close" });
  assert.deepEqual(h.actions, [{ method: "remove", tabId: 7 }]);
  assert.equal(h.timerCount, 0);
});

test("only the owning gesture, pointer, frame, and document can cancel", async () => {
  const h = worker();
  await h.request("start", { gestureId: "owned-gesture" });
  for (const [fields, sender] of [
    [{ gestureId: "wrong-gesture" }, h.defaultSender],
    [{ gestureId: "owned-gesture", pointerId: 2 }, h.defaultSender],
    [{ gestureId: "owned-gesture" }, h.sender({ frameId: 1 })],
    [{ gestureId: "owned-gesture" }, h.sender({ documentId: "replacement-document" })],
  ]) {
    await h.request("cancel", fields, sender);
    assert.equal(h.timerCount, 1);
    assert.equal((await h.request("move", { x: 80 })).ok, true);
  }
  assert.equal(h.notifications.filter(({ message }) => message.phase === "end").length, 0);
  await h.request("cancel", { gestureId: "owned-gesture" });
  assert.equal(h.timerCount, 0);
  assert.deepEqual(await h.request("end", { x: 60 }), { ok: false });
  assert.deepEqual(h.actions, []);
  assert.equal(h.notifications.filter(({ message }) => message.phase === "end").length, 1);
});

test("ignores delayed move and end packets without corrupting the current gesture", async () => {
  const h = worker();
  await h.request("start", { time: 100 });
  await h.request("move", { x: 60, time: 110 });
  assert.deepEqual(await h.request("move", { x: 140, time: 109 }), { ok: false });
  assert.deepEqual(await h.request("end", { x: 140, time: 109 }), { ok: false });
  assert.equal(h.timerCount, 1);
  assert.deepEqual(h.actions, []);
  assert.deepEqual(await finish(h, { x: 60, time: 111 }), { ok: true, action: "back" });
  assert.deepEqual(h.actions, [{ method: "goBack", tabId: 7 }]);
});

test("packets from an earlier gesture cannot finish its replacement", async () => {
  const h = worker();
  await h.request("start", { gestureId: "old", time: 100 });
  await h.request("start", { gestureId: "new", time: 200 });
  assert.deepEqual(await h.request("move", { x: 60, time: 150 }), { ok: false });
  assert.deepEqual(await h.request("end", { x: 60, time: 150 }), { ok: false });
  assert.deepEqual(await finish(h, { x: 140, time: 201 }), { ok: true, action: "forward" });
  assert.deepEqual(h.actions, [{ method: "goForward", tabId: 7 }]);
});

test("a delayed start cannot replace a newer active gesture or its owner", async () => {
  const h = worker();
  await h.request("start", { gestureId: "new", time: 200 });
  await h.request("move", { x: 60, time: 210 });
  assert.deepEqual(await h.request("start", { gestureId: "old", time: 199 },
    h.sender({ frameId: 9, documentId: "old-frame-document" })), { ok: false });
  assert.equal(h.timerCount, 1);
  assert.equal(h.notifications.length, 1);
  assert.deepEqual(await h.request("move", { x: 40, time: 211 }), {
    ok: true, gestureId: "new", action: "back",
  });
  assert.deepEqual(await finish(h, { x: 40, time: 212 }), { ok: true, action: "back" });
  assert.deepEqual(h.actions, [{ method: "goBack", tabId: 7 }]);
  assert.equal(h.timerCount, 0);
});

test("Escape from another authenticated frame cancels only the current gesture", async () => {
  const h = worker();
  const focusedFrame = h.sender({ frameId: 9, documentId: "focused-child-document" });
  await h.request("start", { gestureId: "current-gesture" });
  await h.request("move", { x: 60 });
  await h.request("cancel", { gestureId: "current-gesture" }, focusedFrame);
  assert.equal(h.timerCount, 1, "an ordinary foreign-frame cancel must retain ownership checks");
  const external = h.dispatch(h.packet("cancel", { gestureId: "current-gesture", reason: "escape" }),
    { ...focusedFrame, id: "external-extension" });
  assert.equal(external.accepted, false);
  await h.request("cancel", { gestureId: "stale-gesture", reason: "escape" }, focusedFrame);
  await h.request("cancel", { gestureId: "current-gesture", pointerId: 2, reason: "escape" }, focusedFrame);
  assert.equal(h.timerCount, 1);
  await h.request("cancel", { gestureId: "current-gesture", reason: "escape" }, focusedFrame);
  assert.equal(h.timerCount, 0);
  assert.deepEqual(await h.request("end", { x: 60 }), { ok: false });
  assert.deepEqual(h.actions, []);
  assert.equal(h.notifications.filter(({ message }) => message.phase === "end").length, 1);
});

test("recent movement refreshes inactivity timeout and end clears its timer", async () => {
  const h = worker();
  await h.request("start");
  await h.advance(2900);
  await h.request("move", { x: 80 });
  await h.advance(2999);
  assert.equal(h.timerCount, 1);
  assert.deepEqual(await finish(h, { x: 60 }), { ok: true, action: "back" });
  assert.equal(h.timerCount, 0);
  await h.advance(30000);
  assert.equal(h.notifications.filter(({ message }) => message.phase === "end").length, 1);
});

test("idle expiration discards a recognized gesture without executing it", async () => {
  const h = worker();
  await h.request("start");
  await h.request("move", { x: 60 });
  await h.advance(3000);
  assert.equal(h.timerCount, 0);
  assert.deepEqual(await h.request("end", { x: 60 }), { ok: false });
  assert.deepEqual(h.actions, []);
  assert.equal(h.notifications.filter(({ message }) => message.phase === "end").length, 1);
});

test("ongoing movement cannot extend a gesture beyond the overall duration limit", async () => {
  const h = worker();
  await h.request("start");
  for (let second = 1; second <= 29; second++) {
    await h.advance(1000);
    assert.equal((await h.request("move", { x: 100 + second * 20 })).ok, true);
    assert.equal(h.timerCount, 1);
  }
  await h.advance(1000);
  assert.equal(h.timerCount, 0);
  assert.deepEqual(await h.request("end", { x: 700 }), { ok: false });
  assert.deepEqual(h.actions, []);
});

test("wall-clock expiration is checked even if the timer callback was delayed", async () => {
  const h = worker();
  await h.request("start");
  h.skipTime(3000);
  assert.deepEqual(await h.request("end", { x: 60 }), { ok: false });
  assert.equal(h.timerCount, 0);
  assert.deepEqual(h.actions, []);
});

test("replacing a session removes its old deadline and emits one final state", async () => {
  const h = worker();
  await h.request("start", { gestureId: "old" });
  await h.advance(2000);
  await h.request("start", { gestureId: "new" });
  assert.equal(h.timerCount, 1);
  await h.advance(1000);
  assert.equal((await h.request("move", { x: 80 })).gestureId, "new");
  assert.deepEqual(h.notifications.filter(({ message }) => message.phase === "end"), [
    { tabId: 7, message: { type: "gestureState", phase: "end", gestureId: "old" } },
  ]);
  await h.request("cancel", { gestureId: "new" });
  assert.equal(h.timerCount, 0);
});

test("tab removal clears only that tab's session and timeout", async () => {
  const h = worker();
  const otherTab = h.sender({ tab: { id: 8 } });
  await h.request("start");
  await h.request("start", { gestureId: "other" }, otherTab);
  h.removeTab(7);
  assert.equal(h.timerCount, 1);
  assert.deepEqual(await h.request("end", { x: 60 }), { ok: false });
  assert.deepEqual(await finish(h, { x: 140 }, otherTab), { ok: true, action: "forward" });
  assert.equal(h.timerCount, 0);
  assert.deepEqual(h.actions, [{ method: "goForward", tabId: 8 }]);
});

test("unavailable notifications and failed tab APIs do not leave timers or reject responses", async () => {
  for (const [method, action, points] of [
    ["goBack", "back", [{ x: 60 }]],
    ["goForward", "forward", [{ x: 140 }]],
    ["remove", "close", [{ y: 144 }, { x: 122, y: 144 }]],
  ]) {
    const h = worker();
    h.failNotifications = true;
    h.failedActions.add(method);
    await h.request("start");
    for (const point of points) await h.request("move", point);
    assert.deepEqual(await finish(h, points[points.length - 1]), { ok: false, action });
    assert.equal(h.timerCount, 0);
    assert.deepEqual(h.actions, [{ method, tabId: 7 }]);
    assert.deepEqual(await h.request("end", points[points.length - 1]), { ok: false });
  }
});
