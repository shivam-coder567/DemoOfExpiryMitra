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

  try {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    // ------------------------------------------------------------
    // FAST PATH: full frame, 1.5x.
    // This runs every cycle and is intentionally cheap.
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

    if (finishDetection(detected)) {
      return;
    }

    fastMisses += 1;

    // ------------------------------------------------------------
    // FAST SECOND CHANCE:
    // A 2x full frame is used frequently, but not on every pass.
    // This helps small barcodes without making normal scans slow.
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

      if (finishDetection(detected)) {
        return;
      }
    }

    // ------------------------------------------------------------
    // FALLBACK A:
    // Center 70% crop at 2.5x.
    // This catches small/curved barcodes near the center.
    // ------------------------------------------------------------
    if (fastMisses >= 2) {
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

      if (finishDetection(detected)) {
        return;
      }
    }

    // ------------------------------------------------------------
    // FALLBACK B:
    // Every 3rd miss, scan a tighter 45% crop at 3.5x.
    // ------------------------------------------------------------
    if (fastMisses >= 3 && fastMisses % 3 === 0) {
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

      if (finishDetection(detected)) {
        return;
      }
    }

    // ------------------------------------------------------------
    // ORIENTATION FALLBACK:
    // Explicitly test 90°, 270° and 180°.
    //
    // This is intentionally NOT done on every scan.
    // Normal horizontal barcodes stay on the fast path.
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

        if (finishDetection(detected)) {
          return;
        }
      }
    }

    // ------------------------------------------------------------
    // CURVED / LOW-CONTRAST FALLBACK:
    // Grayscale is expensive, so run it rarely.
    // ------------------------------------------------------------
    if (fastMisses >= 6 && fastMisses % 6 === 0 && cropCanvas) {
      const imageData = cropContext.getImageData(
        0,
        0,
        cropCanvas.width,
        cropCanvas.height,
      );

      const pixels = imageData.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const gray =
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];

        // Moderate contrast boost.
        const value = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));

        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
      }

      cropContext.putImageData(imageData, 0, 0);

      detected = tryDecode(cropCanvas);

      if (finishDetection(detected)) {
        return;
      }
    }

    // ------------------------------------------------------------
    // RECOVERY:
    // Prevent an endlessly increasing miss counter.
    // ------------------------------------------------------------
    if (fastMisses >= 12) {
      fastMisses = 2;
    }

    if (fastMisses % 5 === 0) {
      $("scanStatus").textContent =
        "Scanning... move closer or keep the barcode steady.";
    }
  } catch (error) {
    console.error("Scanner error:", error);
  } finally {
    scanBusy = false;
  }

  if (scanLoopActive) {
    // About 10 scan cycles/sec.
    // Expensive fallback passes are gated above.
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
