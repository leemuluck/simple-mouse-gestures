"use strict";

importScripts("recognizer.js");

const IDLE_TIMEOUT = 3000;
const MAX_DURATION = 30000;
const sessions = new Map();

function notify(tabId, message) {
  // Tabs may navigate or close before an optional visual update arrives.
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function finish(tabId, session) {
  if (sessions.get(tabId) !== session) return;
  sessions.delete(tabId);
  clearTimeout(session.timer);
  notify(tabId, { type: "gestureState", phase: "end", gestureId: session.id });
}

function armTimeout(tabId, session) {
  clearTimeout(session.timer);
  const remaining = Math.min(IDLE_TIMEOUT, MAX_DURATION - (Date.now() - session.started));
  session.timer = setTimeout(() => finish(tabId, session), Math.max(0, remaining));
}

function validMessage(message, sender) {
  if (!message || typeof message !== "object" || Array.isArray(message)
      || message.type !== "gesture" || sender.id !== chrome.runtime.id
      || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0
      || !Number.isInteger(sender.frameId) || sender.frameId < 0
      || !Number.isInteger(message.pointerId) || message.pointerId < 0
      || !["start", "move", "end", "cancel"].includes(message.phase)) return false;
  if (message.phase === "cancel") return typeof message.gestureId === "string";
  if (![message.x, message.y, message.time].every(Number.isFinite)
      || Math.abs(message.x) > 1e7 || Math.abs(message.y) > 1e7) return false;
  return message.phase !== "start"
    || (typeof message.gestureId === "string" && message.gestureId.length > 0
      && message.gestureId.length <= 100);
}

async function handleGesture(message, sender) {
  const tabId = sender.tab.id;
  let session = sessions.get(tabId);
  if (message.phase === "start") {
    if (session && message.time < session.lastTime) return { ok: false };
    if (session) finish(tabId, session);
    const recognizer = SimpleMouseGestureRecognizer.create();
    recognizer.reset(message.x, message.y);
    session = {
      id: message.gestureId, pointerId: message.pointerId, ownerFrame: sender.frameId,
      ownerDocument: sender.documentId, started: Date.now(), lastActivity: Date.now(),
      lastTime: message.time, recognizer, timer: null,
    };
    sessions.set(tabId, session);
    armTimeout(tabId, session);
    notify(tabId, {
      type: "gestureState", phase: "start", gestureId: session.id,
      pointerId: session.pointerId, x: message.x, y: message.y,
    });
    return { ok: true, gestureId: session.id, action: null };
  }
  if (!session || session.pointerId !== message.pointerId) return { ok: false };
  if (message.phase === "cancel") {
    const owner = sender.frameId === session.ownerFrame
      && sender.documentId === session.ownerDocument;
    if (message.gestureId === session.id && (owner || message.reason === "escape")) {
      finish(tabId, session);
    }
    return { ok: true };
  }
  if (Date.now() - session.lastActivity >= IDLE_TIMEOUT
      || Date.now() - session.started >= MAX_DURATION) {
    finish(tabId, session);
    return { ok: false };
  }
  // DOM timestamps share a monotonic origin after adding performance.timeOrigin.
  // Ignore delayed packets from an earlier frame or an earlier gesture.
  if (message.time < session.lastTime) return { ok: false };
  session.lastTime = message.time;
  session.lastActivity = Date.now();
  session.recognizer.update(message.x, message.y);
  const action = session.recognizer.getAction();
  if (message.phase === "move") {
    armTimeout(tabId, session);
    return { ok: true, gestureId: session.id, action };
  }

  finish(tabId, session);
  if (!action) return { ok: true, action: null };
  // Let the native contextmenu event finish before changing the tab.
  await new Promise(resolve => setTimeout(resolve, 10));
  try {
    if (action === "back") await chrome.tabs.goBack(tabId);
    else if (action === "forward") await chrome.tabs.goForward(tabId);
    else if (action === "close") await chrome.tabs.remove(tabId);
    return { ok: true, action };
  } catch {
    // No history entry, an already-closed tab, or a temporarily unavailable tab.
    return { ok: false, action };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!validMessage(message, sender)) return false;
  handleGesture(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  const session = sessions.get(tabId);
  if (session) {
    clearTimeout(session.timer);
    sessions.delete(tabId);
  }
});
