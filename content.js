(() => {
  "use strict";

  const MIN_DISTANCE = 20;
  const DIRECTION_THRESHOLD = 0.7;

  let isGesturing = false;
  let gesturePerformed = false;
  let segments = [];
  let lastSegX = 0;
  let lastSegY = 0;
  let trail = null;
  let trailCtx = null;
  let lastTrailX = 0;
  let lastTrailY = 0;

  function createTrailCanvas() {
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

  // Always suppress the default context menu on right-click DOWN
  // so that we can track mouse movement freely
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (isGesturing || gesturePerformed) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
      }
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      isGesturing = true;
      gesturePerformed = false;
      lastSegX = lastTrailX = e.clientX;
      lastSegY = lastTrailY = e.clientY;
      segments = [];
      createTrailCanvas();
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!isGesturing) return;

      // Draw trail
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
        // Always update the segment origin so the next direction
        // is measured from the latest position, not the original start
        lastSegX = e.clientX;
        lastSegY = e.clientY;
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.button !== 2 || !isGesturing) return;
      isGesturing = false;
      removeTrailCanvas();

      const action = matchGesture(segments);

      if (action) {
        gesturePerformed = true;
        showHint(action);

        if (action === "back") {
          history.back();
        } else if (action === "forward") {
          history.forward();
        } else if (action === "close") {
          try {
            chrome.runtime.sendMessage({ action: "closeTab" });
          } catch (e) {
            window.close();
          }
        }
      }

      // Reset gesturePerformed after a short delay to allow contextmenu event to be caught
      setTimeout(() => {
        gesturePerformed = false;
      }, 100);

      segments = [];
    },
    true
  );
})();
