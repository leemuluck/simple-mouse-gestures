"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { create } = require("../recognizer.js");

function recognize(points, options) {
  const recognizer = create(options);
  recognizer.reset(...points[0]);
  for (const point of points.slice(1)) recognizer.update(...point);
  return { segments: recognizer.getSegments(), action: recognizer.getAction() };
}

function subdivide(vertices, steps) {
  const points = [vertices[0]];
  for (let i = 1; i < vertices.length; i++) {
    const [x0, y0] = vertices[i - 1];
    const [x1, y1] = vertices[i];
    for (let step = 1; step <= steps; step++) {
      points.push([x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps]);
    }
  }
  return points;
}

test("recognizes only the three supported gesture sequences", () => {
  for (const [points, expected] of [
    [[[100, 100], [60, 100]], { segments: ["L"], action: "back" }],
    [[[100, 100], [140, 100]], { segments: ["R"], action: "forward" }],
    [[[100, 100], [100, 140], [140, 140]], { segments: ["D", "R"], action: "close" }],
    [[[100, 100], [100, 60]], { segments: ["U"], action: null }],
    [[[100, 100], [100, 140]], { segments: ["D"], action: null }],
    [[[100, 100], [60, 100], [60, 140]], { segments: ["L", "D"], action: null }],
    [[[100, 100], [100, 140], [140, 140], [140, 100]], { segments: ["D", "R", "U"], action: null }],
  ]) assert.deepEqual(recognize(points), expected);
});

test("requires the full minimum distance, including on a second stroke", () => {
  assert.deepEqual(recognize([[0, 0], [19.999, 0]]), { segments: [], action: null });
  assert.deepEqual(recognize([[0, 0], [20, 0]]), { segments: ["R"], action: "forward" });
  assert.deepEqual(recognize([[0, 0], [0, 44], [19.999, 44]]), { segments: ["D"], action: null });
  assert.deepEqual(recognize([[0, 0], [0, 44], [20, 44]]), { segments: ["D", "R"], action: "close" });
});

test("an initial diagonal does not become an invented orthogonal gesture", () => {
  for (const steps of [1, 2, 5, 25, 100]) {
    assert.deepEqual(recognize(subdivide([[100, 100], [200, 200]], steps)), { segments: [], action: null });
  }
  assert.deepEqual(recognize([[0, 0], [20, 14]]), { segments: ["R"], action: "forward" });
  assert.deepEqual(recognize([[0, 0], [20, 14.01]]), { segments: [], action: null });
});

test("D44 R22 closes with either of the original failing sample sets", () => {
  const expected = { segments: ["D", "R"], action: "close" };
  assert.deepEqual(recognize([[100, 100], [100, 144], [122, 144]]), expected);
  assert.deepEqual(recognize([[100, 100], [100, 125], [100, 144], [122, 144]]), expected);
});

test("L44 R22 cancels with either of the original failing sample sets", () => {
  const expected = { segments: ["L", "R"], action: null };
  assert.deepEqual(recognize([[100, 100], [56, 100], [78, 100]]), expected);
  assert.deepEqual(recognize([[100, 100], [80, 100], [60, 100], [56, 100], [78, 100]]), expected);
});

test("adding collinear samples preserves straight, turn, and reversal results", () => {
  for (const [vertices, expected] of [
    [[[100, 100], [56, 100]], { segments: ["L"], action: "back" }],
    [[[100, 100], [100, 144], [122, 144]], { segments: ["D", "R"], action: "close" }],
    [[[100, 100], [56, 100], [78, 100]], { segments: ["L", "R"], action: null }],
    // A shallow turn must accumulate even while the old axis still advances.
    [[[100, 100], [100, 144], [122, 148]], { segments: ["D", "R"], action: "close" }],
    [[[100, 100], [56, 100], [78, 104]], { segments: ["L", "R"], action: null }],
  ]) {
    for (const steps of [1, 2, 3, 5, 11, 22, 100]) {
      assert.deepEqual(recognize(subdivide(vertices, steps)), expected, JSON.stringify({ vertices, steps }));
    }
  }
});

test("sampling invariance also holds when short strokes and angled strokes meet", () => {
  let seed = 12345;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }
  for (let trial = 0; trial < 1000; trial++) {
    const vertices = [[100, 100]];
    for (let stroke = 0; stroke < 3; stroke++) {
      const [x, y] = vertices[vertices.length - 1];
      const axis = Math.floor(random() * 4);
      const major = 5 + Math.floor(random() * 96);
      const minor = Math.floor(random() * major * 0.6) * (random() < 0.5 ? -1 : 1);
      const [dx, dy] = [[major, minor], [-major, minor], [minor, major], [minor, -major]][axis];
      vertices.push([x + dx, y + dy]);
    }
    assert.deepEqual(recognize(subdivide(vertices, 20)), recognize(vertices), JSON.stringify(vertices));
  }
});

test("subthreshold perpendicular jitter does not introduce turns", () => {
  assert.deepEqual(recognize([[100, 100], [80, 100], [80, 119], [60, 119], [60, 100], [40, 100]]), {
    segments: ["L"], action: "back",
  });
  assert.deepEqual(recognize([[100, 100], [56, 100], [75.999, 100]]), { segments: ["L"], action: "back" });
  assert.deepEqual(recognize([[100, 100], [56, 100], [76, 100]]), { segments: ["L", "R"], action: null });
});

test("an aborted short reversal follows the new true extremum", () => {
  assert.deepEqual(recognize([[100, 100], [56, 100], [66, 100], [46, 100], [68, 100]]), {
    segments: ["L", "R"], action: null,
  });
});

test("duplicate points and repeated same-direction samples add no segments", () => {
  assert.deepEqual(recognize([[100, 100], [100, 100], [80, 100], [80, 100], [60, 100], [40, 100]]), {
    segments: ["L"], action: "back",
  });
});

test("coordinates may be negative and translated without changing recognition", () => {
  const points = [[100, 100], [100, 144], [122, 144]];
  assert.deepEqual(recognize(points.map(([x, y]) => [x - 400, y - 300])), recognize(points));
});

test("reset clears a previous gesture and can explicitly set its next origin", () => {
  const recognizer = create();
  recognizer.reset(100, 100);
  assert.equal(recognizer.update(60, 100), "back");
  recognizer.reset(200, 200);
  assert.deepEqual(recognizer.getSegments(), []);
  assert.equal(recognizer.getAction(), null);
  assert.equal(recognizer.update(220, 200), "forward");
  recognizer.reset();
  assert.equal(recognizer.update(400, 400), null);
  assert.equal(recognizer.update(380, 400), "back");
});

test("returned segment arrays cannot mutate the recognizer", () => {
  const recognizer = create();
  recognizer.reset(0, 0);
  recognizer.update(-20, 0);
  recognizer.getSegments().push("R");
  assert.equal(recognizer.getAction(), "back");
  assert.deepEqual(recognizer.getSegments(), ["L"]);
});

test("custom minimum distance and angular tolerance are applied", () => {
  assert.deepEqual(recognize([[0, 0], [10, 0]], { minDistance: 10 }), { segments: ["R"], action: "forward" });
  assert.deepEqual(recognize([[0, 0], [20, 7]], { directionThreshold: 0.3 }), { segments: [], action: null });
  assert.deepEqual(recognize([[0, 0], [20, 6]], { directionThreshold: 0.3 }), { segments: ["R"], action: "forward" });
});

test("rejects invalid configuration and coordinates", () => {
  for (const minDistance of [0, -1, NaN, Infinity]) assert.throws(() => create({ minDistance }), RangeError);
  for (const directionThreshold of [-1, 1, NaN, Infinity]) assert.throws(() => create({ directionThreshold }), RangeError);
  const recognizer = create();
  assert.throws(() => recognizer.reset(0), TypeError);
  assert.throws(() => recognizer.update(NaN, 0), TypeError);
  assert.throws(() => recognizer.update(0, Infinity), TypeError);
});

test("browser script exposes the same API without Node globals", () => {
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../recognizer.js"), "utf8"), browser);
  const recognizer = browser.SimpleMouseGestureRecognizer.create();
  recognizer.reset(0, 0);
  recognizer.update(0, 44);
  assert.equal(recognizer.update(22, 44), "close");
});
