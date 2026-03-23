(() => {
  "use strict";

  const MIN_DISTANCE = 20;
  const DIRECTION_THRESHOLD = 0.7;
  const DOUBLE_CLICK_TIME = 300; // ms
  const DOUBLE_CLICK_DIST = 10; // px

  let state = "PASSIVE"; // PASSIVE -> PENDING -> ACTIVE
  let segments = [];
  let startX = 0;
  let startY = 0;
  let lastSegX = 0;
  let lastSegY = 0;
  let trail = null;
  let trailCtx = null;
  let lastTrailX = 0;
  let lastTrailY = 0;

  // Double-right-click tracking
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

  function matchGesture(segments) {
    const gesture = segments.join("");
    switch (gesture) {
      case "L":
        return "back";
      case "R":
        return "forward";
      case "DR":
        return "close";
      default:
        return null;
    }
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

  function reset() {
    state = "PASSIVE";
    removeTrailCanvas();
    segments = [];
  }

  // Context menu: block by default, allow on double-right-click
  document.addEventListener(
    "contextmenu",
    (e) => {
      const now = Date.now();
      const dx = e.clientX - lastContextX;
      const dy = e.clientY - lastContextY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = now - lastContextTime;

      // Double-right-click: allow native context menu
      if (elapsed < DOUBLE_CLICK_TIME && dist < DOUBLE_CLICK_DIST) {
        lastContextTime = 0;
        reset();
        return; // Allow native menu
      }

      // Record this click for double-click detection
      lastContextTime = now;
      lastContextX = e.clientX;
      lastContextY = e.clientY;

      // Block context menu
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 2) return;
      state = "PENDING";
      startX = lastSegX = lastTrailX = e.clientX;
      startY = lastSegY = lastTrailY = e.clientY;
      segments = [];

      // Capture pointer so we get events even outside the element
      e.target.setPointerCapture(e.pointerId);
    },
    true
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (state === "PASSIVE") return;

      const dx0 = e.clientX - startX;
      const dy0 = e.clientY - startY;

      if (state === "PENDING") {
        if (Math.sqrt(dx0 * dx0 + dy0 * dy0) >= MIN_DISTANCE) {
          state = "ACTIVE";
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
    "pointerup",
    (e) => {
      if (e.button !== 2) return;

      if (state === "ACTIVE") {
        const action = matchGesture(segments);
        if (action) {
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
      }

      reset();
    },
    true
  );
})();
