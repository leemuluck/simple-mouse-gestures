(() => {
  "use strict";

  const MIN_DISTANCE = 20;
  const DOUBLE_CLICK_TIME = 300;
  const DOUBLE_CLICK_DIST = 10;
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  let session = null;
  let lastClick = null;
  let menuPending = null;
  let suppressContextUntil = 0;
  let visual = null;
  let lastSent = null;

  function removeVisual() {
    visual?.host.remove();
    visual = null;
  }

  function clearLocal() {
    session = null;
    lastSent = null;
    removeVisual();
  }

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      // Old content scripts can remain open after an extension update.
      clearLocal();
      return Promise.resolve(null);
    }
  }

  function packet(phase, event, extra = {}) {
    return {
      type: "gesture", phase, pointerId: event.pointerId,
      x: event.screenX, y: event.screenY,
      time: performance.timeOrigin + event.timeStamp, ...extra,
    };
  }

  function cancel(reason) {
    if (session && (session.startedHere || reason === "escape")) {
      send({ type: "gesture", phase: "cancel", pointerId: session.pointerId,
        gestureId: session.id, reason });
    }
    clearLocal();
    lastClick = null;
    menuPending = null;
  }

  function ensureVisual() {
    if (visual) return visual;
    // SVG/XML documents support the core gestures without an HTML overlay.
    if (document.documentElement?.namespaceURI !== HTML_NS) return null;
    try {
      const host = document.createElementNS(HTML_NS, "simple-mouse-gesture-overlay");
      host.id = "__mouse_gesture_overlay";
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;";
      const shadow = host.attachShadow({ mode: "closed" });
      const canvas = document.createElementNS(HTML_NS, "canvas");
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.ceil(window.innerWidth * ratio);
      canvas.height = Math.ceil(window.innerHeight * ratio);
      canvas.style.cssText = "position:absolute;top:0;left:0;width:100vw;height:100vh;pointer-events:none;";
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = "#ff655d";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const hint = document.createElementNS(HTML_NS, "div");
      hint.style.cssText = "position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(20,23,29,.9);color:white;font:600 16px -apple-system,BlinkMacSystemFont,sans-serif;padding:10px 20px;border-radius:12px;white-space:nowrap;display:none;pointer-events:none;";
      shadow.append(canvas, hint);
      document.documentElement.appendChild(host);
      visual = { host, ctx, hint };
      return visual;
    } catch {
      // Rendering must never prevent navigation or tab closing.
      removeVisual();
      return null;
    }
  }

  function draw(event) {
    if (!session) return;
    const dx = event.screenX - session.startX;
    const dy = event.screenY - session.startY;
    if (!session.moved && dx * dx + dy * dy < MIN_DISTANCE * MIN_DISTANCE) return;
    session.moved = true;
    lastClick = null;
    const layer = ensureVisual();
    if (!layer) return;
    const previousX = session.lastX ?? session.startX - (event.screenX - event.clientX);
    const previousY = session.lastY ?? session.startY - (event.screenY - event.clientY);
    layer.ctx.beginPath();
    layer.ctx.moveTo(previousX, previousY);
    layer.ctx.lineTo(event.clientX, event.clientY);
    layer.ctx.stroke();
    session.lastX = event.clientX;
    session.lastY = event.clientY;
  }

  function showAction(action) {
    const layer = visual;
    if (!layer) return;
    const key = { back: "gestureBack", forward: "gestureForward", close: "gestureClose" }[action];
    try {
      layer.hint.textContent = key ? chrome.i18n.getMessage(key) : "";
      layer.hint.style.display = key ? "block" : "none";
    } catch {
      // A response can arrive while the extension is being updated.
      removeVisual();
    }
  }

  function isMouse(event) {
    return event.isTrusted && event.pointerType === "mouse";
  }

  document.addEventListener("pointerdown", event => {
    if (!isMouse(event) || event.button !== 2) return;
    const previous = lastClick;
    cancel();
    const allow = previous && Date.now() - previous.time < DOUBLE_CLICK_TIME
      && Math.hypot(event.screenX - previous.x, event.screenY - previous.y) < DOUBLE_CLICK_DIST;
    menuPending = { allow: Boolean(allow), until: Date.now() + 1000 };
    if (allow) return;
    const id = crypto.getRandomValues(new Uint32Array(4)).join("-");
    session = { id, pointerId: event.pointerId, startX: event.screenX,
      startY: event.screenY, moved: false, startedHere: true };
    send(packet("start", event, { gestureId: id })).then(result => {
      if (!result?.ok && session?.id === id) clearLocal();
    });
  }, true);

  document.addEventListener("contextmenu", event => {
    if (!event.isTrusted || event.button !== 2 || event.pointerType === "touch"
        || event.pointerType === "pen") return;
    const pending = menuPending && Date.now() <= menuPending.until ? menuPending : null;
    if (pending?.allow) return;
    if (!pending && !session && Date.now() > suppressContextUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("pointermove", event => {
    if (!isMouse(event)) return;
    if (!(event.buttons & 2)) {
      if (session?.startedHere && session.pointerId === event.pointerId) cancel();
      return;
    }
    if (lastSent?.x === event.screenX && lastSent?.y === event.screenY) return;
    lastSent = { x: event.screenX, y: event.screenY };
    if (session?.pointerId === event.pointerId) draw(event);
    send(packet("move", event)).then(result => {
      if (result?.ok && session?.id === result.gestureId) showAction(result.action);
    });
  }, true);

  document.addEventListener("pointerup", event => {
    if (!isMouse(event) || event.button !== 2) return;
    if (session?.startedHere && session.pointerId === event.pointerId && !session.moved) {
      const dx = event.screenX - session.startX;
      const dy = event.screenY - session.startY;
      if (dx * dx + dy * dy < MIN_DISTANCE * MIN_DISTANCE) {
        lastClick = { time: Date.now(), x: event.screenX, y: event.screenY };
      }
    }
    if (menuPending) menuPending.until = Date.now() + 1000;
    if (session) suppressContextUntil = Date.now() + 1000;
    send(packet("end", event));
    clearLocal();
  }, true);

  document.addEventListener("pointercancel", event => {
    if (isMouse(event) && session?.pointerId === event.pointerId) cancel();
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (!message || message.type !== "gestureState") return;
    if (message.phase === "end") {
      if (session?.id === message.gestureId) {
        suppressContextUntil = Date.now() + 1000;
        clearLocal();
      }
    } else if (message.phase === "start" && session?.id !== message.gestureId) {
      clearLocal();
      session = { id: message.gestureId, pointerId: message.pointerId,
        startX: message.x, startY: message.y, moved: false, startedHere: false };
    }
  });

  document.addEventListener("keydown", event => {
    if (event.isTrusted && event.key === "Escape") cancel("escape");
  }, true);
  window.addEventListener("blur", event => {
    if (event.isTrusted && session?.startedHere) cancel();
  });
  document.addEventListener("visibilitychange", event => {
    if (event.isTrusted && document.hidden) cancel();
  });
})();
