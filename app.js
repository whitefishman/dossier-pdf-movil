import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

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
  selectAndContinue: document.querySelector("#select-and-continue"),
  continue: document.querySelector("#continue"),
  current: document.querySelector("#current-page"),
  total: document.querySelector("#total-pages"),
  selectedCount: document.querySelector("#selected-count"),
};

let documentTask = null;
let pdfDocument = null;
let currentPage = 1;
let renderTask = null;
let renderSequence = 0;
let touchStartX = 0;
let touchStartY = 0;
let selectedPages = new Set();

async function openPdf(file) {
  if (!file) return;

  showReader(file.name);
  setLoading(true);
  clearError();

  try {
    await closeDocument();
    const bytes = new Uint8Array(await file.arrayBuffer());
    documentTask = pdfjsLib.getDocument({ data: bytes });
    pdfDocument = await documentTask.promise;
    currentPage = 1;
    selectedPages = new Set();
    updateSelectionCount();
    elements.total.textContent = pdfDocument.numPages;
    await renderPage();
  } catch (error) {
    console.error(error);
    showError("No pudimos abrir este PDF. Comprueba que el archivo sea válido e inténtalo de nuevo.");
  } finally {
    setLoading(false);
  }
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
  selectedPages.add(currentPage);
  updateSelectionCount();
  updateSelectedState();
  if (currentPage < pdfDocument.numPages) changePage(1);
}

function updateSelectionCount() {
  elements.selectedCount.textContent = selectedPages.size;
}

function updateSelectedState() {
  const isSelected = selectedPages.has(currentPage);
  elements.wrap.classList.toggle("is-selected", isSelected);
  elements.selectAndContinue.classList.toggle("is-selected", isSelected);
}

function animatePage(direction) {
  if (!direction) return;
  const className = direction > 0 ? "turn-right" : "turn-left";
  elements.wrap.classList.add(className);
  requestAnimationFrame(() => requestAnimationFrame(() => elements.wrap.classList.remove(className)));
}

function updateControls() {
  elements.continue.disabled = !pdfDocument || currentPage >= pdfDocument.numPages;
  elements.selectAndContinue.disabled = !pdfDocument;
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading;
  elements.wrap.style.visibility = isLoading && !pdfDocument ? "hidden" : "visible";
}

function showError(message) {
  elements.error.textContent = message;
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
  await closeDocument();
  elements.fileInput.value = "";
  elements.reader.hidden = true;
  elements.welcome.hidden = false;
}

elements.fileInput.addEventListener("change", (event) => openPdf(event.target.files[0]));
elements.close.addEventListener("click", returnHome);
elements.selectAndContinue.addEventListener("click", selectAndContinue);
elements.continue.addEventListener("click", () => changePage(1));

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
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}

updateControls();
