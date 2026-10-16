// Zien demo: the camera in four views. What you see, what the computer sees (edges),
// what moves (the difference with the previous frame), and the pen: the centre of
// everything that moves draws a line.
// Everything happens in this page. No frame leaves the device, nothing is stored.

const root = document.getElementById("see-demo");

const PW = 160; // the computer looks at a small grey picture: 160 x 120 points
const PH = 120;
const MIN_MOVING = 40; // fewer moving points than this: nobody is drawing
const MAX_POINTS = 100; // the line remembers its last hundred points, as in the scribble
const MODES = [
  { id: "image", name: "wat jij ziet", colour: "purple", note: "Het gewone beeld, in spiegelbeeld." },
  { id: "edges", name: "wat de computer ziet", colour: "cyan", note: "Alleen de randen: de plekken waar licht en donker naast elkaar liggen. 160 bij 120 punten, zonder kleur." },
  { id: "motion", name: "wat er beweegt", colour: "orange", note: "Alleen het verschil met het vorige beeld. Sta stil, en je verdwijnt." },
  { id: "pen", name: "de pen", colour: "green", note: "Het kruis is het midden van alles wat beweegt. Dat punt trekt de lijn." },
];

function start() {
  const stage = root.querySelector(".see-canvas");
  const ctx = stage.getContext("2d");
  const W = stage.width;
  const H = stage.height;
  const stat = (name) => root.querySelector(`[data-stat="${name}"]`);
  const control = (name) => root.querySelector(`[data-control="${name}"]`);

  // The small picture the computer works on, and the picture it gives back
  const small = document.createElement("canvas");
  small.width = PW;
  small.height = PH;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  const mask = document.createElement("canvas");
  mask.width = PW;
  mask.height = PH;
  const mctx = mask.getContext("2d");
  const maskData = mctx.createImageData(PW, PH);

  const grey = new Uint8Array(PW * PH);
  const previous = new Uint8Array(PW * PH);
  const moving = new Uint8Array(PW * PH);
  let hasPrevious = false;

  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;

  let source = null; // "camera" | "sample"
  let stream = null;
  let mode = "image";
  let frame = 0;
  let lastVideoTime = -1;
  let point = null; // smoothed centre of the movement, 0..1
  let hadPoint = false;

  // Measuring: what the visitor does with the demo (see content/goals.yaml).
  function use(action, detail) {
    if (window.hexzTrack) window.hexzTrack("demo_use", { article: "zien", action: action, detail: detail || "" });
  }
  function cssColour(name) {
    return getComputedStyle(root).getPropertyValue("--" + name).trim() || "#fff";
  }
  function rgb(name) {
    const hex = cssColour(name).replace("#", "");
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const COLOURS = { cyan: rgb("cyan"), orange: rgb("orange") };

  // ---- The line: a ring of the last hundred points ----
  const xs = new Float32Array(MAX_POINTS);
  const ys = new Float32Array(MAX_POINTS);
  const joined = new Uint8Array(MAX_POINTS);
  let head = 0;
  let count = 0;
  let waiting = []; // points that are held back by the delay
  function push(x, y, connected) {
    xs[head] = x;
    ys[head] = y;
    joined[head] = connected ? 1 : 0;
    head = (head + 1) % MAX_POINTS;
    if (count < MAX_POINTS) count++;
  }
  function clearLine() {
    head = count = 0;
    waiting = [];
  }

  // ---- Without a camera: a drawn hand that moves through a drawn room ----
  function drawSample(c, time, w, h) {
    c.fillStyle = "#2b3034";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#59666d"; // a window
    c.fillRect(w * 0.08, h * 0.1, w * 0.26, h * 0.42);
    c.fillStyle = "#2b3034";
    c.fillRect(w * 0.205, h * 0.1, w * 0.01, h * 0.42);
    c.fillStyle = "#3d454a"; // a shelf
    c.fillRect(w * 0.6, h * 0.3, w * 0.34, h * 0.03);
    c.fillStyle = "#6f7b82";
    c.fillRect(w * 0.66, h * 0.16, w * 0.05, h * 0.14);
    c.fillRect(w * 0.74, h * 0.2, w * 0.09, h * 0.1);
    c.fillStyle = "#1d2124"; // a table
    c.fillRect(0, h * 0.86, w, h * 0.14);

    const t = time / 1000;
    const x = w * (0.5 + 0.3 * Math.sin(t * 0.9));
    const y = h * (0.52 + 0.24 * Math.sin(t * 1.7 + 1));
    const r = h * 0.085;
    c.strokeStyle = c.fillStyle = "#d9d2c3";
    c.lineCap = "round";
    c.lineWidth = r * 0.42;
    [-0.9, -0.3, 0.3, 0.9].forEach((f, i) => {
      c.beginPath();
      c.moveTo(x + f * r * 0.75, y - r * 0.5);
      c.lineTo(x + f * r * 1.0, y - r * (i === 1 || i === 2 ? 2.3 : 1.9));
      c.stroke();
    });
    c.beginPath();
    c.moveTo(x - r * 0.8, y + r * 0.2);
    c.lineTo(x - r * 1.7, y - r * 0.5);
    c.stroke();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  // The source picture at any size; the camera in mirror image
  function drawSource(c, time, w, h) {
    if (source === "sample") return drawSample(c, time, w, h);
    c.save();
    c.scale(-1, 1);
    c.drawImage(video, -w, 0, w, h);
    c.restore();
  }

  // ---- What the computer does with one frame ----
  function look(time, threshold) {
    drawSource(sctx, time, PW, PH);
    const data = sctx.getImageData(0, 0, PW, PH).data;

    // 1. Grey: one number per point
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
      grey[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    }

    // 2. What moves: the difference with the previous frame
    let n = 0;
    let sumX = 0;
    let sumY = 0;
    if (hasPrevious) {
      for (let y = 0, i = 0; y < PH; y++) {
        for (let x = 0; x < PW; x++, i++) {
          const changed = Math.abs(grey[i] - previous[i]) > threshold;
          moving[i] = changed ? 1 : 0;
          if (changed) {
            n++;
            sumX += x;
            sumY += y;
          }
        }
      }
    }
    previous.set(grey);
    hasPrevious = true;

    // 3. The pen: the centre of everything that moves
    if (n >= MIN_MOVING) {
      const x = sumX / n / PW;
      const y = sumY / n / PH;
      point = point ? { x: point.x + (x - point.x) * 0.35, y: point.y + (y - point.y) * 0.35 } : { x, y };
    } else {
      point = null;
    }
    return n;
  }

  // Edges: where a point differs most from its neighbours (Sobel)
  function drawEdges() {
    const out = maskData.data;
    const [r, g, b] = COLOURS.cyan;
    for (let y = 1; y < PH - 1; y++) {
      for (let x = 1; x < PW - 1; x++) {
        const i = y * PW + x;
        const gx = grey[i - PW + 1] + 2 * grey[i + 1] + grey[i + PW + 1] - grey[i - PW - 1] - 2 * grey[i - 1] - grey[i + PW - 1];
        const gy = grey[i + PW - 1] + 2 * grey[i + PW] + grey[i + PW + 1] - grey[i - PW - 1] - 2 * grey[i - PW] - grey[i - PW + 1];
        const strength = Math.min(1, (Math.abs(gx) + Math.abs(gy)) / 300);
        const p = i * 4;
        out[p] = r * strength;
        out[p + 1] = g * strength;
        out[p + 2] = b * strength;
        out[p + 3] = 255;
      }
    }
    showMask();
  }
  function drawMotion() {
    const out = maskData.data;
    const [r, g, b] = COLOURS.orange;
    for (let i = 0, p = 0; i < moving.length; i++, p += 4) {
      out[p] = moving[i] ? r : 15;
      out[p + 1] = moving[i] ? g : 13;
      out[p + 2] = moving[i] ? b : 14;
      out[p + 3] = 255;
    }
    showMask();
  }
  function showMask() {
    mctx.putImageData(maskData, 0, 0);
    ctx.imageSmoothingEnabled = false; // show how coarse the picture is
    ctx.drawImage(mask, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  }
  function drawCross(p, colour) {
    if (!p) return;
    const x = p.x * W;
    const y = p.y * H;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
    ctx.strokeRect(x - 7, y - 7, 14, 14);
  }
  function drawLine() {
    ctx.lineCap = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = cssColour("green");
    const first = (head - count + MAX_POINTS) % MAX_POINTS;
    for (let k = 1; k < count; k++) {
      const a = (first + k - 1) % MAX_POINTS;
      const b = (first + k) % MAX_POINTS;
      if (!joined[b]) continue;
      ctx.globalAlpha = k / count; // the older, the fainter
      ctx.beginPath();
      ctx.moveTo(xs[a] * W, ys[a] * H);
      ctx.lineTo(xs[b] * W, ys[b] * H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Counters ----
  let frames = 0;
  let costSum = 0;
  let lastCount = performance.now();
  function countFrame(cost, n) {
    frames++;
    costSum += cost;
    const now = performance.now();
    if (now - lastCount < 500) return;
    stat("fps").textContent = Math.round((frames * 1000) / (now - lastCount)).toLocaleString("nl-NL");
    stat("cost").textContent = (costSum / frames).toLocaleString("nl-NL", { maximumFractionDigits: 1 }) + " ms";
    stat("moving").textContent = n.toLocaleString("nl-NL") + " punten";
    frames = 0;
    costSum = 0;
    lastCount = now;
  }

  // ---- One frame ----
  function step(time) {
    frame = requestAnimationFrame(step);
    if (source === "camera") {
      if (video.currentTime === lastVideoTime) return; // no new picture from the camera yet
      lastVideoTime = video.currentTime;
    }
    const t0 = performance.now();
    const n = look(time, Number(control("threshold").value));

    // The pen: every point waits as long as the delay says
    const delay = Number(control("delay").value);
    if (point) waiting.push({ at: time, x: point.x, y: point.y, connected: hadPoint });
    hadPoint = !!point;
    while (waiting.length && waiting[0].at <= time - delay) {
      const p = waiting.shift();
      push(p.x, p.y, p.connected);
    }
    const cost = performance.now() - t0;

    if (mode === "edges") drawEdges();
    else if (mode === "motion") {
      drawMotion();
      drawCross(point, "#fff");
    } else {
      drawSource(ctx, time, W, H);
      if (mode === "pen") {
        ctx.fillStyle = "rgba(15, 13, 14, 0.62)";
        ctx.fillRect(0, 0, W, H);
        drawLine();
        drawCross(point, "#fff");
      }
    }
    countFrame(cost, n);
  }

  // ---- Start and stop ----
  function run(kind) {
    source = kind;
    hasPrevious = false;
    point = null;
    hadPoint = false;
    clearLine();
    root.classList.add("is-running");
    root.dataset.source = kind;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(step);
  }
  function stop() {
    cancelAnimationFrame(frame);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    source = null;
    root.classList.remove("is-running");
    delete root.dataset.source;
    ctx.clearRect(0, 0, W, H);
    ["fps", "cost", "moving"].forEach((s) => (stat(s).textContent = "…"));
  }
  async function camera() {
    stat("message").textContent = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      stat("message").textContent = "Deze browser geeft geen toegang tot een camera. Probeer het zonder camera.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      run("camera");
      use("camera");
    } catch (err) {
      stat("message").textContent = "De camera gaat niet aan (geen toestemming, of geen camera). Probeer het zonder camera.";
      use("refused");
    }
  }

  // ---- Controls ----
  const modes = root.querySelector(".see-modes");
  MODES.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = m.id;
    b.textContent = m.name;
    b.style.setProperty("--mode", `var(--${m.colour})`);
    modes.appendChild(b);
  });
  function setMode(id) {
    mode = id;
    const m = MODES.find((x) => x.id === id);
    modes.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === id)));
    root.style.setProperty("--mode", `var(--${m.colour})`);
    stat("note").textContent = m.note;
  }
  modes.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setMode(b.dataset.mode);
    use("mode", b.dataset.mode);
  });
  function showControls() {
    stat("threshold").textContent = control("threshold").value;
    stat("delay").textContent = control("delay").value + " ms";
  }
  root.querySelector(".see-controls").addEventListener("input", showControls);
  root.querySelector('[data-action="camera"]').addEventListener("click", camera);
  root.querySelector('[data-action="sample"]').addEventListener("click", () => {
    run("sample");
    use("sample");
  });
  root.querySelector('[data-action="clear"]').addEventListener("click", () => {
    clearLine();
    use("clear");
  });
  root.querySelector('[data-action="stop"]').addEventListener("click", stop);
  window.addEventListener("pagehide", stop); // never leave the camera on

  setMode("image");
  showControls();
}

if (root) start();
