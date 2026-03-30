(() => {
  "use strict";

  const MIN_DISTANCE = 20;
  const DIRECTION_THRESHOLD = 0.7;
  const DOUBLE_CLICK_TIME = 300;
  const DOUBLE_CLICK_DIST = 10;
  const GESTURE_TIMEOUT = 3000;

  let active = false;
  let moved = false;
  let segments = [];
  let startX = 0;
  let startY = 0;
  let lastSegX = 0;
  let lastSegY = 0;
  let trail = null;
  let trailCtx = null;
  let lastTrailX = 0;
  let lastTrailY = 0;
  let timeoutId = null;

  let lastContextTime = 0;
  let lastContextX = 0;
  let lastContextY = 0;

  function createTrailCanvas() {
    removeTrailCanvas();
    trail = document.createElement("canvas");
    trail.id = "__mouse_gesture_trail";
    trail.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;";
    trail.width = window.innerWidth;
    trail.height = window.innerHeight;
    document.documentElement.appendChild(trail);
    trailCtx = trail.getContext("2d");
    trailCtx.strokeStyle = "rgba(255, 40, 40, 1)";
    trailCtx.lineWidth = 6;
    trailCtx.lineCap = "butt";
    trailCtx.lineJoin = "miter";
  }

  function removeTrailCanvas() {
    if (trail && trail.parentNode) {
      trail.parentNode.removeChild(trail);
    }
    trail = null;
    trailCtx = null;
  }

  function reset() {
    active = false;
    moved = false;
    segments = [];
    removeTrailCanvas();
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function getDirection(dx, dy) {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < MIN_DISTANCE && absDy < MIN_DISTANCE) return null;
    if (absDx > absDy) {
      if (absDy / absDx > DIRECTION_THRESHOLD) return null;
      return dx > 0 ? "R" : "L";
    } else {
      if (absDx / absDy > DIRECTION_THRESHOLD) return null;
      return dy > 0 ? "D" : "U";
    }
  }

  function matchGesture(segs) {
    const g = segs.join("");
    if (g === "L") return "back";
    if (g === "R") return "forward";
    if (g === "DR") return "close";
    return null;
  }

  function getGestureLabel(action) {
    switch (action) {
      case "back":
        return chrome.i18n.getMessage("gestureBack") || "← Back";
      case "forward":
        return chrome.i18n.getMessage("gestureForward") || "Forward →";
      case "close":
        return chrome.i18n.getMessage("gestureClose") || "✕ Close Tab";
      default:
        return null;
    }
  }

  function showHint(action) {
    const label = getGestureLabel(action);
    if (!label) return;
    const hint = document.createElement("div");
    hint.id = "__mouse_gesture_hint";
    hint.textContent = label;
    hint.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
      "background:rgba(0,0,0,0.75);color:#fff;font-size:20px;font-weight:bold;" +
      "padding:12px 28px;border-radius:10px;z-index:2147483647;pointer-events:none;" +
      "font-family:-apple-system,BlinkMacSystemFont,sans-serif;" +
      "transition:opacity 0.3s ease;opacity:1;";
    document.documentElement.appendChild(hint);
    setTimeout(() => {
      hint.style.opacity = "0";
      setTimeout(() => hint.remove(), 300);
    }, 400);
  }

  function executeGesture() {
    const action = matchGesture(segments);
    if (!action) return;
    showHint(action);
    if (action === "back") {
      history.back();
    } else if (action === "forward") {
      history.forward();
    } else if (action === "close") {
      try {
        chrome.runtime.sendMessage({ action: "closeTab" });
      } catch (err) {
        window.close();
      }
    }
  }

  // --- Event listeners (all capture phase) ---

  document.addEventListener(
    "contextmenu",
    (e) => {
      const now = Date.now();
      const dx = e.clientX - lastContextX;
      const dy = e.clientY - lastContextY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (now - lastContextTime < DOUBLE_CLICK_TIME && dist < DOUBLE_CLICK_DIST) {
        lastContextTime = 0;
        reset();
        return; // Allow native context menu
      }

      lastContextTime = now;
      lastContextX = e.clientX;
      lastContextY = e.clientY;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 2) return;
      reset();
      active = true;
      startX = lastSegX = lastTrailX = e.clientX;
      startY = lastSegY = lastTrailY = e.clientY;
      segments = [];

      // Safety timeout: auto-reset after 3s
      timeoutId = setTimeout(() => reset(), GESTURE_TIMEOUT);
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!active) return;
      if (!(e.buttons & 2)) {
        reset();
        return;
      }

      const dx0 = e.clientX - startX;
      const dy0 = e.clientY - startY;

      if (!moved) {
        if (dx0 * dx0 + dy0 * dy0 >= MIN_DISTANCE * MIN_DISTANCE) {
          moved = true;
          createTrailCanvas();
        } else {
          return;
        }
      }

      if (trailCtx) {
        trailCtx.beginPath();
        trailCtx.moveTo(lastTrailX, lastTrailY);
        trailCtx.lineTo(e.clientX, e.clientY);
        trailCtx.stroke();
        lastTrailX = e.clientX;
        lastTrailY = e.clientY;
      }

      const dx = e.clientX - lastSegX;
      const dy = e.clientY - lastSegY;
      const dir = getDirection(dx, dy);

      if (dir) {
        if (dir !== segments[segments.length - 1]) {
          segments.push(dir);
        }
        lastSegX = e.clientX;
        lastSegY = e.clientY;
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.button !== 2 || !active) return;
      if (moved) executeGesture();
      reset();
    },
    true
  );

  // Safety resets
  window.addEventListener("blur", () => reset());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
})();
