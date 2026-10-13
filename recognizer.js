(function (root) {
  "use strict";

  function create(options = {}) {
    const minDistance = options.minDistance ?? 20;
    const directionThreshold = options.directionThreshold ?? 0.7;
    if (!Number.isFinite(minDistance) || minDistance <= 0) {
      throw new RangeError("minDistance must be a positive finite number");
    }
    if (!Number.isFinite(directionThreshold) || directionThreshold < 0 || directionThreshold >= 1) {
      throw new RangeError("directionThreshold must be between 0 (inclusive) and 1 (exclusive)");
    }

    let committed;
    let preview;
    let segmentStart;
    let lastInput;

    function point(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError("Gesture coordinates must be finite numbers");
      }
      return { x, y };
    }

    function direction(dx, dy, requireDistance = true) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const major = Math.max(absDx, absDy);
      if (major === 0 || (requireDistance && major < minDistance)) return null;
      if (Math.min(absDx, absDy) / major > directionThreshold) return null;
      return absDx > absDy ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
    }

    function farther(next, reference, dir) {
      switch (dir) {
        case "L": return next.x < reference.x;
        case "R": return next.x > reference.x;
        case "U": return next.y < reference.y;
        case "D": return next.y > reference.y;
        default: return false;
      }
    }

    function getAction() {
      switch (preview.segments.join("")) {
        case "L": return "back";
        case "R": return "forward";
        case "DR": return "close";
        default: return null;
      }
    }

    function reset(x, y) {
      const start = arguments.length === 0 ? null : point(x, y);
      committed = { origin: start, previous: start, extremum: start, pendingDirection: null, segments: [] };
      preview = copyState(committed);
      segmentStart = lastInput = start;
    }

    function copyState(state) {
      return { ...state, segments: state.segments.slice() };
    }

    function processPoint(state, next) {
      const currentDirection = state.segments[state.segments.length - 1];
      if (!currentDirection) {
        const firstDirection = direction(next.x - state.origin.x, next.y - state.origin.y);
        if (firstDirection) {
          state.segments.push(firstDirection);
          state.extremum = next;
        }
      } else {
        const nextDirection = direction(next.x - state.extremum.x, next.y - state.extremum.y);
        const localDirection = direction(next.x - state.previous.x, next.y - state.previous.y, false);

        if (nextDirection && nextDirection !== currentDirection) {
          state.segments.push(nextDirection);
          state.extremum = next;
          state.pendingDirection = null;
        } else if (localDirection === currentDirection && farther(next, state.extremum, currentDirection)) {
          // Follow the actual furthest point, including the final few pixels of
          // a stroke. A 20px checkpoint would lose short turns and reversals.
          state.extremum = next;
          state.pendingDirection = null;
        } else {
          if (!state.pendingDirection && localDirection && localDirection !== currentDirection) {
            state.pendingDirection = localDirection;
          }
          if (nextDirection === currentDirection) {
            state.pendingDirection = null;
          }
          // Keep a possible turn's origin while its smaller samples accumulate.
          // Otherwise a shallow R stroke following D could keep advancing D's
          // extremum, and never reach the same result as one large R sample.
          if (!state.pendingDirection && farther(next, state.extremum, currentDirection)) {
            state.extremum = next;
          }
        }
      }

      state.previous = next;
    }

    function continuesStraight(next) {
      const dx = lastInput.x - segmentStart.x;
      const dy = lastInput.y - segmentStart.y;
      const nextDx = next.x - lastInput.x;
      const nextDy = next.y - lastInput.y;
      if (dx === 0 && dy === 0) return true;
      const scale = Math.hypot(dx, dy) * Math.hypot(nextDx, nextDy);
      return dx * nextDx + dy * nextDy > 0 && Math.abs(dx * nextDy - dy * nextDx) <= scale * 1e-10;
    }

    function update(x, y) {
      const next = point(x, y);
      if (!lastInput) {
        reset(x, y);
        return null;
      }
      if (next.x === lastInput.x && next.y === lastInput.y) return getAction();

      // Extra mousemove samples on the same line must not change recognition.
      // Commit a point only once it is a real bend, and evaluate the current
      // line's endpoint on a copy. This also keeps short reversals cancellable.
      if (!continuesStraight(next)) {
        processPoint(committed, lastInput);
        segmentStart = lastInput;
      }
      lastInput = next;
      preview = copyState(committed);
      processPoint(preview, next);
      return getAction();
    }

    reset();
    return Object.freeze({ update, reset, getAction, getSegments: () => preview.segments.slice() });
  }

  const api = Object.freeze({ create });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.SimpleMouseGestureRecognizer = api;
  }
})(globalThis);
