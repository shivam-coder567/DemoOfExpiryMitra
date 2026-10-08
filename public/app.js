import { BrowserMultiFormatOneDReader } from "https\://cdn.jsdelivr.net/npm/@zxing/browser\@0.1.5/+esm";

const $ = (id) => document.getElementById(id);

const screens = ["home", "scan", "result", "manual", "inventory"];

let reader = null;

let stream = null;

let controls = null;

let scanLoopTimer = null;

let scanLoopActive = false;

let scanCanvas = null;

let scanContext = null;

let scanBusy = false;

let scanFrameCount = 0;

// Adaptive scanner state.

let fastMisses = 0;

let fallbackLevel = 0;

let lastDetectedBarcode = "";

let lastDetectedAt = 0;

let cropCanvas = null;

let cropContext = null;

let smallCanvas = null;

let smallContext = null;

let rotateCanvas = null;

let rotateContext = null;

// Low-resolution canvas used to find likely barcode regions before decoding.
let analysisCanvas = null;
let analysisContext = null;

let barcode = "";

let expiryImage = "";

let lastResult = null;

function show(name) {
  screens.forEach((screen) => {
    $(screen).classList.toggle("active", screen === name);
  });
}

function stopCamera() {
  scanLoopActive = false;

  if (scanLoopTimer) {
    clearTimeout(scanLoopTimer);

    scanLoopTimer = null;
  }

  scanBusy = false;

  scanFrameCount = 0;

  fastMisses = 0;

  fallbackLevel = 0;

  lastDetectedBarcode = "";

  lastDetectedAt = 0;

  if (controls) {
    try {
      controls.stop();
    } catch (_) {}

    controls = null;
  }

  if (reader) {
    try {
      reader.reset();
    } catch (_) {}
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());

    stream = null;
  }

  $("video").srcObject = null;
}

async function scanProcessedFrame() {
  if (!scanLoopActive) return;

  const video = $("video");

  if (
    !video.videoWidth ||
    !video.videoHeight ||
    !scanCanvas ||
    !scanContext ||
    !reader
  ) {
    scanLoopTimer = setTimeout(scanProcessedFrame, 80);
    return;
  }

  if (scanBusy) {
    scanLoopTimer = setTimeout(scanProcessedFrame, 50);
    return;
  }

  scanBusy = true;
  scanFrameCount += 1;

  const finishDetection = (value) => {
    if (!value) return false;

    barcode = String(value).trim();
    if (!barcode) return false;

    lastDetectedBarcode = barcode;
    lastDetectedAt = performance.now();

    $("barcodeValue").textContent = barcode;
    $("scanStatus").textContent =
      "Barcode detected! Rotate the package and capture the expiry area.";
    $("captureExpiry").disabled = false;

    scanLoopActive = false;

    if (scanLoopTimer) {
      clearTimeout(scanLoopTimer);
      scanLoopTimer = null;
    }

    return true;
  };

  const tryDecode = (canvas) => {
    try {
      const result = reader.decodeFromCanvas(canvas);
      return result ? result.getText() : null;
    } catch (_) {
      return null;
    }
  };

  const drawFrame = (
    context,
    source,
    sx,
    sy,
    sw,
    sh,
    dw,
    dh,
    smoothing = true,
  ) => {
    context.save();
    context.imageSmoothingEnabled = smoothing;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, dw, dh);
    context.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
    context.restore();
  };

  const ensureSize = (canvas, width, height) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  // Find regions that look "barcode dense" using cheap edge-density scoring.
  // This is deliberately low-resolution and only runs after a few misses.
  const findBarcodeCandidates = () => {
    if (!analysisCanvas || !analysisContext) return [];

    const aw = 320;
    const ah = 180;
    ensureSize(analysisCanvas, aw, ah);
    drawFrame(
      analysisContext,
      video,
      0,
      0,
      video.videoWidth,
      video.videoHeight,
      aw,
      ah,
      true,
    );

    const imageData = analysisContext.getImageData(0, 0, aw, ah).data;
    const gray = new Uint8Array(aw * ah);

    for (let y = 0; y < ah; y += 1) {
      for (let x = 0; x < aw; x += 1) {
        const i = (y * aw + x) * 4;
        gray[y * aw + x] = Math.round(
          0.299 * imageData[i] +
            0.587 * imageData[i + 1] +
            0.114 * imageData[i + 2],
        );
      }
    }

    // Overlapping windows cover the whole camera frame, unlike the old
    // center-only crops. This is important for bottles whose barcode is low,
    // high, left, or right in the frame.
    const windows = [];
    const addWindow = (x, y, w, h, kind) => {
      const x0 = Math.max(0, Math.min(aw - w, Math.round(x)));
      const y0 = Math.max(0, Math.min(ah - h, Math.round(y)));
      windows.push({ x: x0, y: y0, w, h, kind });
    };

    // Medium tiles: good for small barcodes on bottles.
    const tileW = 160;
    const tileH = 70;
    for (const y of [0, 55, 110]) {
      for (const x of [0, 80, 160]) {
        addWindow(x, y, tileW, tileH, "tile");
      }
    }

    // Wide strips: useful when the barcode is long and low on a bottle.
    for (const y of [0, 60, 120]) {
      addWindow(0, y, 240, 54, "wide");
    }

    // Tall strips: useful for rotated/vertical barcode layouts.
    for (const x of [0, 80, 160]) {
      addWindow(x, 0, 80, 135, "tall");
    }

    const scored = windows.map((candidate) => {
      let verticalEnergy = 0;
      let horizontalEnergy = 0;
      let transitions = 0;
      let samples = 0;

      // Sample every second pixel. A barcode creates many close black/white
      // transitions, so edge density is a useful candidate signal.
      for (let y = candidate.y + 2; y < candidate.y + candidate.h; y += 2) {
        for (let x = candidate.x + 2; x < candidate.x + candidate.w; x += 2) {
          const here = gray[y * aw + x];
          const left = gray[y * aw + x - 2];
          const up = gray[(y - 2) * aw + x];
          const dx = Math.abs(here - left);
          const dy = Math.abs(here - up);

          verticalEnergy += dx;
          horizontalEnergy += dy;
          if (dx > 35 || dy > 35) transitions += 1;
          samples += 1;
        }
      }

      const vertical = verticalEnergy / Math.max(1, samples);
      const horizontal = horizontalEnergy / Math.max(1, samples);
      const transitionRate = transitions / Math.max(1, samples);

      // Keep both orientations represented. Existing explicit rotation passes
      // remain the final authority for 90/270/180 degree detection.
      const score =
        Math.max(vertical, horizontal) * 0.75 + transitionRate * 120;

      return { ...candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Avoid repeatedly decoding almost identical regions.
    const selected = [];
    for (const candidate of scored) {
      const tooSimilar = selected.some((other) => {
        const cx = candidate.x + candidate.w / 2;
        const cy = candidate.y + candidate.h / 2;
        const ox = other.x + other.w / 2;
        const oy = other.y + other.h / 2;
        return Math.abs(cx - ox) < 45 && Math.abs(cy - oy) < 25;
      });

      if (!tooSimilar) selected.push(candidate);
      if (selected.length >= 5) break;
    }

    return selected;
  };

  const decodeCandidate = (candidate, scale = 3.0) => {
    const sx = (candidate.x / 320) * video.videoWidth;
    const sy = (candidate.y / 180) * video.videoHeight;
    const sw = (candidate.w / 320) * video.videoWidth;
    const sh = (candidate.h / 180) * video.videoHeight;

    const outputWidth = Math.round(sw * scale);
    const outputHeight = Math.round(sh * scale);
    ensureSize(cropCanvas, outputWidth, outputHeight);

    drawFrame(
      cropContext,
      video,
      sx,
      sy,
      sw,
      sh,
      outputWidth,
      outputHeight,
      true,
    );

    let detected = tryDecode(cropCanvas);
    if (detected) return detected;

    // One cheap preprocessing pass for low-contrast labels.
    const imageData = cropContext.getImageData(
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const grayValue =
        0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const value = Math.max(0, Math.min(255, (grayValue - 128) * 1.45 + 128));
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
    }

    cropContext.putImageData(imageData, 0, 0);
    detected = tryDecode(cropCanvas);
    return detected;
  };

  try {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    // ------------------------------------------------------------
    // FAST PATH: full frame, 1.5x.
    // Existing behavior is preserved.
    // ------------------------------------------------------------
    const fastScale = 1.5;
    const fastWidth = Math.round(videoWidth * fastScale);
    const fastHeight = Math.round(videoHeight * fastScale);

    ensureSize(scanCanvas, fastWidth, fastHeight);
    drawFrame(
      scanContext,
      video,
      0,
      0,
      videoWidth,
      videoHeight,
      fastWidth,
      fastHeight,
    );

    let detected = tryDecode(scanCanvas);
    if (finishDetection(detected)) return;

    fastMisses += 1;

    // ------------------------------------------------------------
    // FAST SECOND CHANCE: full frame at 2x.
    // ------------------------------------------------------------
    if (fastMisses % 2 === 0) {
      const fullWidth = Math.round(videoWidth * 2);
      const fullHeight = Math.round(videoHeight * 2);

      ensureSize(scanCanvas, fullWidth, fullHeight);
      drawFrame(
        scanContext,
        video,
        0,
        0,
        videoWidth,
        videoHeight,
        fullWidth,
        fullHeight,
      );

      detected = tryDecode(scanCanvas);
      if (finishDetection(detected)) return;
    }

    // ------------------------------------------------------------
    // NEW: barcode candidate localization.
    // Every 2 misses, search the whole frame for dense barcode-like regions.
    // This replaces the old assumption that the barcode must be centered.
    // ------------------------------------------------------------
    let localizedCandidates = [];

    if (fastMisses >= 2 && fastMisses % 2 === 0) {
      localizedCandidates = findBarcodeCandidates();

      for (const candidate of localizedCandidates) {
        detected = decodeCandidate(candidate, 3.0);
        if (finishDetection(detected)) return;
      }
    }

    // ------------------------------------------------------------
    // LEGACY CENTER FALLBACK.
    // Keep this because it is cheap and already worked for some products.
    // ------------------------------------------------------------
    if (fastMisses >= 3) {
      const cropWidth = Math.round(videoWidth * 0.7);
      const cropHeight = Math.round(videoHeight * 0.7);
      const cropX = Math.round((videoWidth - cropWidth) / 2);
      const cropY = Math.round((videoHeight - cropHeight) / 2);

      const cropScale = 2.5;
      const cropOutputWidth = Math.round(cropWidth * cropScale);
      const cropOutputHeight = Math.round(cropHeight * cropScale);

      ensureSize(cropCanvas, cropOutputWidth, cropOutputHeight);
      drawFrame(
        cropContext,
        video,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        cropOutputWidth,
        cropOutputHeight,
      );

      detected = tryDecode(cropCanvas);
      if (finishDetection(detected)) return;
    }

    // ------------------------------------------------------------
    // TIGHT CENTER FALLBACK.
    // ------------------------------------------------------------
    if (fastMisses >= 4 && fastMisses % 3 === 0) {
      const smallWidth = Math.round(videoWidth * 0.45);
      const smallHeight = Math.round(videoHeight * 0.45);
      const smallX = Math.round((videoWidth - smallWidth) / 2);
      const smallY = Math.round((videoHeight - smallHeight) / 2);

      const smallScale = 3.5;
      const outputWidth = Math.round(smallWidth * smallScale);
      const outputHeight = Math.round(smallHeight * smallScale);

      ensureSize(smallCanvas, outputWidth, outputHeight);
      drawFrame(
        smallContext,
        video,
        smallX,
        smallY,
        smallWidth,
        smallHeight,
        outputWidth,
        outputHeight,
      );

      detected = tryDecode(smallCanvas);
      if (finishDetection(detected)) return;
    }

    // ------------------------------------------------------------
    // ORIENTATION FALLBACK: preserve existing 90/270/180 behavior.
    // ------------------------------------------------------------
    if (fastMisses >= 4 && fastMisses % 4 === 0) {
      const baseWidth = Math.round(videoWidth * 1.5);
      const baseHeight = Math.round(videoHeight * 1.5);

      ensureSize(scanCanvas, baseWidth, baseHeight);
      drawFrame(
        scanContext,
        video,
        0,
        0,
        videoWidth,
        videoHeight,
        baseWidth,
        baseHeight,
      );

      const rotations = [90, 270, 180];

      for (const angle of rotations) {
        const radians = (angle * Math.PI) / 180;
        const quarterTurn = angle === 90 || angle === 270;
        const outputWidth = quarterTurn ? baseHeight : baseWidth;
        const outputHeight = quarterTurn ? baseWidth : baseHeight;

        ensureSize(rotateCanvas, outputWidth, outputHeight);
        rotateContext.clearRect(0, 0, outputWidth, outputHeight);
        rotateContext.save();
        rotateContext.translate(outputWidth / 2, outputHeight / 2);
        rotateContext.rotate(radians);
        rotateContext.drawImage(
          scanCanvas,
          -baseWidth / 2,
          -baseHeight / 2,
          baseWidth,
          baseHeight,
        );
        rotateContext.restore();

        detected = tryDecode(rotateCanvas);
        if (finishDetection(detected)) return;
      }

      // If the barcode is tiny, rotating the entire 1920x1080 frame can still
      // leave the bars too small. Reuse the best localized regions and rotate
      // only those crops. This preserves the old 90/270/180 support while
      // giving small rotated barcodes the same close-up treatment as normal ones.
      for (const candidate of localizedCandidates.slice(0, 2)) {
        const sx = (candidate.x / 320) * videoWidth;
        const sy = (candidate.y / 180) * videoHeight;
        const sw = (candidate.w / 320) * videoWidth;
        const sh = (candidate.h / 180) * videoHeight;
        const candidateScale = 2.75;
        const candidateWidth = Math.round(sw * candidateScale);
        const candidateHeight = Math.round(sh * candidateScale);

        ensureSize(cropCanvas, candidateWidth, candidateHeight);
        drawFrame(
          cropContext,
          video,
          sx,
          sy,
          sw,
          sh,
          candidateWidth,
          candidateHeight,
        );

        for (const angle of rotations) {
          const radians = (angle * Math.PI) / 180;
          const quarterTurn = angle === 90 || angle === 270;
          const outputWidth = quarterTurn ? candidateHeight : candidateWidth;
          const outputHeight = quarterTurn ? candidateWidth : candidateHeight;

          ensureSize(rotateCanvas, outputWidth, outputHeight);
          rotateContext.clearRect(0, 0, outputWidth, outputHeight);
          rotateContext.save();
          rotateContext.translate(outputWidth / 2, outputHeight / 2);
          rotateContext.rotate(radians);
          rotateContext.drawImage(
            cropCanvas,
            -candidateWidth / 2,
            -candidateHeight / 2,
            candidateWidth,
            candidateHeight,
          );
          rotateContext.restore();

          detected = tryDecode(rotateCanvas);
          if (finishDetection(detected)) return;
        }
      }
    }

    // ------------------------------------------------------------
    // RECOVERY: keep the counter bounded.
    // ------------------------------------------------------------
    if (fastMisses >= 12) fastMisses = 2;

    if (fastMisses % 5 === 0) {
      $("scanStatus").textContent =
        "Scanning... move closer and keep the barcode steady.";
    }
  } catch (error) {
    console.error("Scanner error:", error);
  } finally {
    scanBusy = false;
  }

  if (scanLoopActive) {
    scanLoopTimer = setTimeout(scanProcessedFrame, 100);
  }
}

async function startCamera() {
  stopCamera();

  $("scanStatus").textContent = "Requesting camera...";

  $("barcodeValue").textContent = "Not detected";

  $("captureExpiry").disabled = true;

  barcode = "";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: "environment",
        },

        width: {
          ideal: 1280,
        },

        height: {
          ideal: 720,
        },
      },

      audio: false,
    });

    const track = stream.getVideoTracks()[0];

    const settings = track.getSettings();

    $("scanStatus").textContent =
      `Camera: ${settings.width}×${settings.height} | ` +
      `FPS: ${settings.frameRate || "?"} | ` +
      `Facing: ${settings.facingMode || "?"}`;

    try {
      await track.applyConstraints({
        advanced: [
          {
            focusMode: "continuous",
          },
        ],
      });
    } catch (error) {
      console.log("Continuous autofocus not supported:", error);
    }

    $("video").srcObject = stream;

    await $("video").play();

    $("scanStatus").textContent = "Point the camera at a product barcode.";

    reader = new BrowserMultiFormatOneDReader();

    // Create reusable off-screen canvases.

    scanCanvas = document.createElement("canvas");

    scanContext = scanCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    cropCanvas = document.createElement("canvas");

    cropContext = cropCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    smallCanvas = document.createElement("canvas");

    smallContext = smallCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    rotateCanvas = document.createElement("canvas");

    rotateContext = rotateCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    analysisCanvas = document.createElement("canvas");

    analysisContext = analysisCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    scanLoopActive = true;

    scanLoopTimer = null;

    scanBusy = false;

    scanFrameCount = 0;

    fastMisses = 0;

    fallbackLevel = 0;

    lastDetectedBarcode = "";

    lastDetectedAt = 0;

    $("scanStatus").textContent =
      "Fast adaptive scanner started. Point at a barcode.";

    scanProcessedFrame();
  } catch (error) {
    console.error(error);

    $("scanStatus").textContent =
      "Camera could not start. Check permission and press Retry Camera.";
  }
}

$("startButton").addEventListener("click", async () => {
  show("scan");

  await startCamera();
});

$("retryCamera").addEventListener("click", startCamera);

$("captureExpiry").addEventListener("click", () => {
  if (!barcode) return;

  const video = $("video");

  const canvas = $("canvas");

  canvas.width = video.videoWidth;

  canvas.height = video.videoHeight;

  const context = canvas.getContext("2d");

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  expiryImage = canvas.toDataURL("image/jpeg", 0.85);

  $("expiryPreview").src = expiryImage;

  $("expiryPreviewWrap").classList.remove("hidden");

  $("scanStatus").textContent = "Expiry image captured.";
});

$("sendScan").addEventListener("click", async () => {
  if (!barcode || !expiryImage) return;

  $("sendScan").disabled = true;

  $("scanStatus").textContent = "Sending to backend...";

  try {
    const response = await fetch("/api/scan", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        barcode,

        image: expiryImage,
      }),
    });

    lastResult = await response.json();

    renderResult(lastResult);

    show("result");
  } catch (error) {
    $("scanStatus").textContent =
      "Backend request failed. Is the server running?";
  } finally {
    $("sendScan").disabled = false;
  }
});

function renderResult(data) {
  const container = $("resultContent");

  if (data.status === "confident") {
    container.innerHTML = `



      <div class="card safe">



        <h3>

          ${escapeHtml(data.product.name)}

        </h3>







        <p>



          <strong>Brand:</strong>



          ${escapeHtml(data.product.brand || "-")}



        </p>







        <p>



          <strong>Barcode:</strong>



          ${escapeHtml(data.product.barcode)}



        </p>







        <p>



          <strong>Expiry:</strong>



          ${escapeHtml(data.expiry.parsed_expiry_date)}



        </p>







        <p>



          <strong>

            Manufacturing:

          </strong>



          ${escapeHtml(data.expiry.parsed_mfg_date || "-")}



        </p>







        <p>



          <strong>Batch:</strong>



          ${escapeHtml(data.expiry.batch || "-")}



        </p>







        <p>



          <strong>Confidence:</strong>



          ${data.expiry.confidence}



        </p>







        <p>



          <strong>OCR:</strong>



          ${escapeHtml(data.expiry.raw_text)}



        </p>



      </div>



    `;

    $("confirmSave").style.display = "block";
  } else {
    container.innerHTML = `



      <div class="card expiring_soon">



        <h3>

          ${escapeHtml(data.status)}

        </h3>







        <p>



          ${escapeHtml(data.message || "Please retry or enter manually.")}



        </p>







        ${
          data.expiry?.raw_text
            ? `

              <p>



                <strong>OCR:</strong>



                ${escapeHtml(data.expiry.raw_text)}



              </p>

            `
            : ""
        }



      </div>



    `;

    $("confirmSave").style.display = "none";
  }
}

$("confirmSave").addEventListener("click", () => {
  alert("Practice backend already saved the validated inventory record.");

  loadInventory();

  show("inventory");
});

$("retryScan").addEventListener("click", async () => {
  show("scan");

  await startCamera();
});

$("manualEntry").addEventListener("click", () => {
  $("manualBarcode").value = barcode;

  show("manual");
});

$("saveManual").addEventListener("click", async () => {
  const body = {
    barcode: $("manualBarcode").value.trim(),

    product_name: $("manualProduct").value.trim(),

    expiry_date: $("manualExpiry").value,

    batch: $("manualBatch").value.trim(),

    quantity: Number($("manualQuantity").value || 1),
  };

  const response = await fetch("/api/inventory/manual", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!response.ok) {
    alert(result.message || "Manual save failed.");

    return;
  }

  await loadInventory();

  show("inventory");
});

async function loadInventory() {
  const response = await fetch("/api/inventory");

  const items = await response.json();

  if (!items.length) {
    $("inventoryList").innerHTML = "<p>No inventory items yet.</p>";

    return;
  }

  $("inventoryList").innerHTML = items

    .map(
      (item) => `



        <div

          class="card ${escapeHtml(item.status)}"

        >



          <h3>



            ${escapeHtml(item.product_name)}



          </h3>







          <p>



            Barcode:



            ${escapeHtml(item.barcode)}



          </p>







          <p>



            Expiry:



            ${escapeHtml(item.expiry_date)}



          </p>







          <p>



            Days left:



            ${item.days_left}



          </p>







          <p>



            Status:



            ${escapeHtml(item.status)}



          </p>







          <p>



            Source:



            ${escapeHtml(item.source)}



          </p>







        </div>



      `,
    )

    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");
}

[
  ["inventoryButton", "inventory"],

  ["refreshInventory", "inventory"],

  ["homeFromScan", "home"],

  ["homeFromResult", "home"],

  ["homeFromManual", "manual"],

  ["homeFromInventory", "home"],
].forEach(([id, screen]) => {
  $(id).addEventListener("click", async () => {
    stopCamera();

    if (screen === "inventory") {
      await loadInventory();
    }

    show(screen);
  });
});

window.addEventListener("beforeunload", stopCamera);
