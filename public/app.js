import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const $ = (id) => document.getElementById(id);

const screens = ["home", "scan", "result", "manual", "inventory"];

let reader = null;
let stream = null;
let controls = null;
let barcode = "";
let expiryImage = "";
let lastResult = null;

function show(name) {
  screens.forEach((screen) => {
    $(screen).classList.toggle("active", screen === name);
  });
}

function stopCamera() {
  if (controls) {
    try { controls.stop(); } catch (_) {}
    controls = null;
  }

  if (reader) {
    try { reader.reset(); } catch (_) {}
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  $("video").srcObject = null;
}

async function startCamera() {
  stopCamera();

  $("scanStatus").textContent = "Requesting camera...";
  $("barcodeValue").textContent = "Not detected";
  $("captureExpiry").disabled = true;
  barcode = "";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });

    $("video").srcObject = stream;
    await $("video").play();

    $("scanStatus").textContent = "Point the camera at a product barcode.";

    reader = new BrowserMultiFormatReader();

    controls = await reader.decodeFromVideoElement(
      $("video"),
      (result, error) => {
        if (!result) return;

        barcode = result.getText();
        $("barcodeValue").textContent = barcode;
        $("scanStatus").textContent = "Barcode detected. Rotate the package and capture the expiry area.";
        $("captureExpiry").disabled = false;

        if (controls) {
          controls.stop();
          controls = null;
        }
      }
    );
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode,
        image: expiryImage
      })
    });

    lastResult = await response.json();
    renderResult(lastResult);
    show("result");
  } catch (error) {
    $("scanStatus").textContent = "Backend request failed. Is the server running?";
  } finally {
    $("sendScan").disabled = false;
  }
});

function renderResult(data) {
  const container = $("resultContent");

  if (data.status === "confident") {
    container.innerHTML = `
      <div class="card safe">
        <h3>${escapeHtml(data.product.name)}</h3>
        <p><strong>Brand:</strong> ${escapeHtml(data.product.brand || "-")}</p>
        <p><strong>Barcode:</strong> ${escapeHtml(data.product.barcode)}</p>
        <p><strong>Expiry:</strong> ${escapeHtml(data.expiry.parsed_expiry_date)}</p>
        <p><strong>Manufacturing:</strong> ${escapeHtml(data.expiry.parsed_mfg_date || "-")}</p>
        <p><strong>Batch:</strong> ${escapeHtml(data.expiry.batch || "-")}</p>
        <p><strong>Confidence:</strong> ${data.expiry.confidence}</p>
        <p><strong>OCR:</strong> ${escapeHtml(data.expiry.raw_text)}</p>
      </div>
    `;
    $("confirmSave").style.display = "block";
  } else {
    container.innerHTML = `
      <div class="card expiring_soon">
        <h3>${escapeHtml(data.status)}</h3>
        <p>${escapeHtml(data.message || "Please retry or enter manually.")}</p>
        ${data.expiry?.raw_text ? `<p><strong>OCR:</strong> ${escapeHtml(data.expiry.raw_text)}</p>` : ""}
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
    quantity: Number($("manualQuantity").value || 1)
  };

  const response = await fetch("/api/inventory/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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

  $("inventoryList").innerHTML = items.map((item) => `
    <div class="card ${escapeHtml(item.status)}">
      <h3>${escapeHtml(item.product_name)}</h3>
      <p>Barcode: ${escapeHtml(item.barcode)}</p>
      <p>Expiry: ${escapeHtml(item.expiry_date)}</p>
      <p>Days left: ${item.days_left}</p>
      <p>Status: ${escapeHtml(item.status)}</p>
      <p>Source: ${escapeHtml(item.source)}</p>
    </div>
  `).join("");
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
  ["homeFromManual", "home"],
  ["homeFromInventory", "home"]
].forEach(([id, screen]) => {
  $(id).addEventListener("click", async () => {
    stopCamera();
    if (screen === "inventory") await loadInventory();
    show(screen);
  });
});

window.addEventListener("beforeunload", stopCamera);
