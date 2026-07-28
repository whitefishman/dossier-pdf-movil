const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsLib = null;
let pdfJsLoadPromise = null;

const elements = {
  fileInput: document.querySelector("#pdf-file"),
  welcome: document.querySelector("#welcome"),
  reader: document.querySelector("#reader"),
  close: document.querySelector("#close-file"),
  name: document.querySelector("#document-name"),
  stage: document.querySelector("#page-stage"),
  wrap: document.querySelector("#page-wrap"),
  canvas: document.querySelector("#pdf-canvas"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error-message"),
  errorDetail: document.querySelector("#error-detail"),
  selectAndContinue: document.querySelector("#select-and-continue"),
  selectionActionLabel: document.querySelector("#selection-action-label"),
  continue: document.querySelector("#continue"),
  current: document.querySelector("#current-page"),
  total: document.querySelector("#total-pages"),
  selectedCount: document.querySelector("#selected-count"),
  downloadSelected: document.querySelector("#download-selected"),
  exportProgress: document.querySelector("#export-progress"),
  exportProgressBar: document.querySelector("#export-progress-bar"),
  exportProgressText: document.querySelector("#export-progress-text"),
  diagnosticName: document.querySelector("#diagnostic-name"),
  diagnosticSize: document.querySelector("#diagnostic-size"),
  diagnosticType: document.querySelector("#diagnostic-type"),
  diagnosticChange: document.querySelector("#diagnostic-change"),
  diagnosticPdfJs: document.querySelector("#diagnostic-pdfjs"),
  diagnosticDocument: document.querySelector("#diagnostic-document"),
  diagnosticPages: document.querySelector("#diagnostic-pages"),
  diagnosticError: document.querySelector("#diagnostic-error"),
  diagnostics: document.querySelector("#diagnostics"),
  diagnosticsToggle: document.querySelector("#diagnostics-toggle"),
  clearCache: document.querySelector("#clear-cache"),
};

let documentTask = null;
let pdfDocument = null;
let currentPage = 1;
let renderTask = null;
let renderSequence = 0;
let touchStartX = 0;
let touchStartY = 0;
let selectedPages = new Set();
let fileLoadSequence = 0;
let documentBaseName = "documento";
let isExporting = false;

async function loadPdfJs() {
  if (pdfjsLib) {
    elements.diagnosticPdfJs.textContent = "Cargado correctamente";
    return pdfjsLib;
  }

  if (!pdfJsLoadPromise) {
    elements.diagnosticPdfJs.textContent = "Cargando módulo…";
    pdfJsLoadPromise = import(`${PDFJS_BASE_URL}/pdf.min.mjs`)
      .then((library) => {
        library.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}/pdf.worker.min.mjs`;
        pdfjsLib = library;
        elements.diagnosticPdfJs.textContent = "Cargado correctamente";
        return library;
      })
      .catch((error) => {
        pdfJsLoadPromise = null;
        elements.diagnosticPdfJs.textContent = "Error al cargar";
        reportDiagnosticError(error);
        throw error;
      });
  }

  return pdfJsLoadPromise;
}

async function openPdf(file) {
  if (!file) return;

  const loadSequence = ++fileLoadSequence;

  elements.diagnosticName.textContent = file.name || "(sin nombre)";
  elements.diagnosticSize.textContent = `${file.size.toLocaleString("es-ES")} bytes`;
  elements.diagnosticType.textContent = file.type || "No informado";
  elements.diagnosticDocument.textContent = "No iniciado";
  elements.diagnosticPages.textContent = "—";
  elements.diagnosticError.textContent = "Sin errores";

  showReader(file.name);
  setLoading(true);
  clearError();

  try {
    validatePdfFile(file);
    await closeDocument();
    const [library, buffer] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
    if (loadSequence !== fileLoadSequence) return;

    const bytes = new Uint8Array(buffer);
    elements.diagnosticDocument.textContent = "Iniciado";
    documentTask = library.getDocument({ data: bytes });
    pdfDocument = await documentTask.promise;
    if (loadSequence !== fileLoadSequence) return;

    if (pdfDocument.numPages < 1) throw new Error("EMPTY_PDF");
    elements.diagnosticDocument.textContent = "Completado";
    elements.diagnosticPages.textContent = String(pdfDocument.numPages);
    currentPage = 1;
    selectedPages = new Set();
    documentBaseName = getSafeFileName(file.name);
    elements.exportProgress.hidden = true;
    updateSelectionCount();
    elements.total.textContent = pdfDocument.numPages;
    await renderPage();
  } catch (error) {
    console.error(error);
    reportDiagnosticError(error);
    if (loadSequence === fileLoadSequence) showError(getReadableError(error));
  } finally {
    if (loadSequence === fileLoadSequence) setLoading(false);
  }
}

function reportDiagnosticError(error) {
  const name = error?.name || "Error";
  const message = error?.message || String(error);
  elements.diagnosticError.textContent = error?.stack || `${name}: ${message}`;
}

function getSafeFileName(fileName) {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");
  return withoutExtension.replace(/[\\/:*?"<>|]+/g, "-").trim() || "documento";
}

function validatePdfFile(file) {
  const hasPdfName = file.name.toLowerCase().endsWith(".pdf");
  const hasPdfType = file.type === "application/pdf";

  if (!hasPdfName && !hasPdfType) throw new Error("NOT_PDF");
  if (file.size === 0) throw new Error("EMPTY_FILE");
}

function getReadableError(error) {
  if (error?.message === "NOT_PDF") return "El archivo seleccionado no parece ser un PDF.";
  if (error?.message === "EMPTY_FILE" || error?.message === "EMPTY_PDF") return "El archivo está vacío y no contiene páginas.";
  if (error?.name === "PasswordException") return "Este PDF está protegido con contraseña y no puede abrirse todavía.";
  if (error?.name === "InvalidPDFException") return "El archivo está dañado o no contiene un PDF válido.";
  if (error instanceof TypeError && !pdfjsLib) return "No se pudo cargar PDF.js. Comprueba tu conexión e inténtalo de nuevo.";
  return "Comprueba que el archivo sea un PDF válido e inténtalo de nuevo.";
}

function showReader(fileName) {
  elements.name.textContent = fileName.replace(/\.pdf$/i, "") || "Documento";
  elements.welcome.hidden = true;
  elements.reader.hidden = false;
}

async function renderPage(direction = 0) {
  if (!pdfDocument) return;
  const sequence = ++renderSequence;
  setLoading(true);
  clearError();

  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }

  try {
    const page = await pdfDocument.getPage(currentPage);
    if (sequence !== renderSequence) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const stageStyles = getComputedStyle(elements.stage);
    const availableWidth = elements.stage.clientWidth - parseFloat(stageStyles.paddingLeft) - parseFloat(stageStyles.paddingRight);
    const availableHeight = elements.stage.clientHeight - parseFloat(stageStyles.paddingTop) - parseFloat(stageStyles.paddingBottom);
    const displayScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: displayScale * pixelRatio });

    elements.canvas.width = Math.floor(viewport.width);
    elements.canvas.height = Math.floor(viewport.height);
    elements.canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
    elements.canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;

    renderTask = page.render({ canvasContext: elements.canvas.getContext("2d"), viewport });
    await renderTask.promise;
    renderTask = null;
    elements.current.textContent = currentPage;
    updateControls();
    updateSelectedState();
    animatePage(direction);
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      reportDiagnosticError(error);
      showError("Ha ocurrido un error al dibujar esta página.");
    }
  } finally {
    if (sequence === renderSequence) setLoading(false);
  }
}

function changePage(offset) {
  if (!pdfDocument) return;
  const nextPage = currentPage + offset;
  if (nextPage < 1 || nextPage > pdfDocument.numPages) return;
  currentPage = nextPage;
  renderPage(offset);
}

function selectAndContinue() {
  if (!pdfDocument) return;
  if (selectedPages.has(currentPage)) {
    selectedPages.delete(currentPage);
  } else {
    selectedPages.add(currentPage);
  }
  updateSelectionCount();
  updateSelectedState();
  if (currentPage < pdfDocument.numPages) changePage(1);
}

function updateSelectionCount() {
  elements.selectedCount.textContent = selectedPages.size;
  const count = selectedPages.size;
  elements.downloadSelected.textContent = `Descargar ${count} ${count === 1 ? "página" : "páginas"} como JPG`;
  elements.downloadSelected.disabled = isExporting || !pdfDocument || count === 0;
}

function updateSelectedState() {
  const isSelected = selectedPages.has(currentPage);
  elements.wrap.classList.toggle("is-selected", isSelected);
  elements.selectAndContinue.classList.toggle("is-selected", isSelected);
  elements.selectAndContinue.setAttribute("aria-pressed", String(isSelected));
  elements.selectionActionLabel.textContent = isSelected ? "Deseleccionar y continuar" : "Seleccionar y continuar";
}

function animatePage(direction) {
  if (!direction) return;
  const className = direction > 0 ? "turn-right" : "turn-left";
  elements.wrap.classList.add(className);
  requestAnimationFrame(() => requestAnimationFrame(() => elements.wrap.classList.remove(className)));
}

function updateControls() {
  elements.continue.disabled = isExporting || !pdfDocument || currentPage >= pdfDocument.numPages;
  elements.selectAndContinue.disabled = isExporting || !pdfDocument;
  elements.downloadSelected.disabled = isExporting || !pdfDocument || selectedPages.size === 0;
  elements.close.disabled = isExporting;
  elements.fileInput.disabled = isExporting;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo crear la imagen JPG."));
    }, "image/jpeg", 0.9);
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  return url;
}

function waitForDownload() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

async function downloadSelectedPages() {
  if (!pdfDocument || selectedPages.size === 0 || isExporting) return;

  const pages = [...selectedPages].sort((a, b) => a - b);
  const pageNumberWidth = String(pdfDocument.numPages).length;
  const exportCanvas = document.createElement("canvas");
  const context = exportCanvas.getContext("2d", { alpha: false });
  if (!context) {
    reportDiagnosticError(new Error("No se pudo crear el lienzo para exportar."));
    return;
  }
  isExporting = true;
  elements.exportProgress.hidden = false;
  elements.exportProgressBar.max = pages.length;
  elements.exportProgressBar.value = 0;
  updateControls();

  try {
    for (let index = 0; index < pages.length; index++) {
      const pageNumber = pages[index];
      elements.exportProgressText.textContent = `Generando página ${index + 1} de ${pages.length}…`;
      let page = null;
      let objectUrl = null;

      try {
        page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          2,
          2400 / Math.max(baseViewport.width, baseViewport.height),
          Math.sqrt(6_000_000 / (baseViewport.width * baseViewport.height)),
        );
        const viewport = page.getViewport({ scale });
        exportCanvas.width = Math.max(1, Math.floor(viewport.width));
        exportCanvas.height = Math.max(1, Math.floor(viewport.height));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        await page.render({ canvasContext: context, viewport }).promise;

        const blob = await canvasToJpeg(exportCanvas);
        const paddedPage = String(pageNumber).padStart(pageNumberWidth, "0");
        objectUrl = downloadBlob(blob, `${documentBaseName}-pagina-${paddedPage}.jpg`);
        elements.exportProgressBar.value = index + 1;
        elements.exportProgressText.textContent = `Descargada ${index + 1} de ${pages.length}`;
        await waitForDownload();
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        page?.cleanup();
        exportCanvas.width = 1;
        exportCanvas.height = 1;
      }
    }
    elements.exportProgressText.textContent = `${pages.length} ${pages.length === 1 ? "imagen descargada" : "imágenes descargadas"}`;
  } catch (error) {
    console.error(error);
    reportDiagnosticError(error);
    elements.exportProgressText.textContent = `Error: ${error?.message || String(error)}`;
  } finally {
    exportCanvas.width = 1;
    exportCanvas.height = 1;
    isExporting = false;
    updateControls();
  }
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading;
  elements.wrap.style.visibility = isLoading && !pdfDocument ? "hidden" : "visible";
}

function showError(message) {
  elements.errorDetail.textContent = message;
  elements.error.hidden = false;
  elements.wrap.hidden = true;
}

function clearError() {
  elements.error.hidden = true;
  elements.wrap.hidden = false;
}

async function closeDocument() {
  renderSequence++;
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  if (documentTask) {
    await documentTask.destroy();
    documentTask = null;
  }
  pdfDocument = null;
}

async function returnHome() {
  if (isExporting) return;
  fileLoadSequence++;
  await closeDocument();
  elements.fileInput.value = "";
  elements.reader.hidden = true;
  elements.welcome.hidden = false;
}

elements.fileInput.addEventListener("change", (event) => {
  elements.diagnosticChange.textContent = `Disparado (${new Date().toLocaleTimeString("es-ES")})`;
  const [file] = event.target.files;
  event.target.value = "";
  openPdf(file);
});
elements.close.addEventListener("click", returnHome);
elements.selectAndContinue.addEventListener("click", selectAndContinue);
elements.continue.addEventListener("click", () => changePage(1));
elements.downloadSelected.addEventListener("click", downloadSelectedPages);
elements.diagnosticsToggle.addEventListener("click", () => {
  const willShow = elements.diagnostics.hidden;
  elements.diagnostics.hidden = !willShow;
  elements.diagnosticsToggle.setAttribute("aria-expanded", String(willShow));
});
elements.clearCache.addEventListener("click", async () => {
  elements.clearCache.disabled = true;
  elements.clearCache.textContent = "Borrando…";
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  const url = new URL(window.location.href);
  url.searchParams.set("cache-bust", Date.now());
  window.location.replace(url);
});

elements.stage.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0].clientX;
  touchStartY = event.changedTouches[0].clientY;
}, { passive: true });

elements.stage.addEventListener("touchend", (event) => {
  const deltaX = event.changedTouches[0].clientX - touchStartX;
  const deltaY = event.changedTouches[0].clientY - touchStartY;
  if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
    changePage(deltaX < 0 ? 1 : -1);
  }
}, { passive: true });

window.addEventListener("keydown", (event) => {
  if (elements.reader.hidden) return;
  if (event.key === "ArrowLeft") changePage(-1);
  if (event.key === "ArrowRight") changePage(1);
  if (event.key === "Escape") returnHome();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPage(), 150);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }));
}

updateControls();
