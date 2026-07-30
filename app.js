const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const SESSION_STORAGE_KEY = "dossier-pdf-last-session";
const MAX_CONCURRENT_THUMBNAILS = 2;
const THUMBNAIL_MAX_WIDTH = 160;
const THUMBNAIL_MAX_HEIGHT = 220;

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
  selectFeatured: document.querySelector("#select-featured"),
  selectFeaturedLabel: document.querySelector("#select-featured-label"),
  selectionPositionStatus: document.querySelector("#selection-position-status"),
  continue: document.querySelector("#continue"),
  current: document.querySelector("#current-page"),
  total: document.querySelector("#total-pages"),
  selectedCount: document.querySelector("#selected-count"),
  downloadSelected: document.querySelector("#download-selected"),
  exportProgress: document.querySelector("#export-progress"),
  exportProgressBar: document.querySelector("#export-progress-bar"),
  exportProgressText: document.querySelector("#export-progress-text"),
  prepareSend: document.querySelector("#prepare-send"),
  prepareGrid: document.querySelector("#prepare-grid"),
  prepareProgress: document.querySelector("#prepare-progress"),
  prepareProgressBar: document.querySelector("#prepare-progress-bar"),
  prepareProgressText: document.querySelector("#prepare-progress-text"),
  backToReader: document.querySelector("#back-to-reader"),
  confirmDownload: document.querySelector("#confirm-download"),
  sessionRestore: document.querySelector("#session-restore"),
  restoreSession: document.querySelector("#restore-session"),
  discardSession: document.querySelector("#discard-session"),
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
let preloadTask = null;
let renderedPageNumber = null;
const adjacentPageCache = new Map();
let touchStartX = 0;
let touchStartY = 0;
let zoomScale = 1;
let panX = 0;
let panY = 0;
let touchMode = null;
let touchStartPanX = 0;
let touchStartPanY = 0;
let pinchStartDistance = 0;
let pinchStartScale = 1;
let pinchAnchorX = 0;
let pinchAnchorY = 0;
let suppressTap = false;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
let selectedPages = new Set();
let featuredPages = [];
let fileLoadSequence = 0;
let documentBaseName = "documento";
let isExporting = false;
let currentFileIdentity = null;
let pendingSession = null;
let preparedPages = [];
let thumbnailSequence = 0;
let thumbnailObserver = null;
let thumbnailQueue = [];
let thumbnailActiveCount = 0;
const thumbnailQueuedPages = new Set();
const thumbnailProcessingPages = new Set();
const thumbnailRenderTasks = new Map();
const thumbnailUrls = new Map();

async function loadPdfJs() {
  if (pdfjsLib) {
    setOptionalText(elements.diagnosticPdfJs, "Cargado correctamente");
    return pdfjsLib;
  }

  if (!pdfJsLoadPromise) {
    setOptionalText(elements.diagnosticPdfJs, "Cargando módulo…");
    pdfJsLoadPromise = import(`${PDFJS_BASE_URL}/pdf.min.mjs`)
      .then((library) => {
        library.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}/pdf.worker.min.mjs`;
        pdfjsLib = library;
        setOptionalText(elements.diagnosticPdfJs, "Cargado correctamente");
        return library;
      })
      .catch((error) => {
        pdfJsLoadPromise = null;
        setOptionalText(elements.diagnosticPdfJs, "Erro ao cargar");
        reportDiagnosticError(error);
        throw error;
      });
  }

  return pdfJsLoadPromise;
}

async function openPdf(file) {
  if (!file) return;

  const loadSequence = ++fileLoadSequence;

  setOptionalText(elements.diagnosticName, file.name || "(sen nome)");
  setOptionalText(elements.diagnosticSize, `${file.size.toLocaleString("gl-ES")} bytes`);
  setOptionalText(elements.diagnosticType, file.type || "Non informado");
  setOptionalText(elements.diagnosticDocument, "Non iniciado");
  setOptionalText(elements.diagnosticPages, "—");
  setOptionalText(elements.diagnosticError, "Sen erros");

  showReader(file.name);
  setLoading(true);
  clearError();
  pendingSession = null;
  if (elements.sessionRestore) elements.sessionRestore.hidden = true;

  try {
    validatePdfFile(file);
    await closeDocument();
    const [library, buffer] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
    if (loadSequence !== fileLoadSequence) return;

    const bytes = new Uint8Array(buffer);
    setOptionalText(elements.diagnosticDocument, "Iniciado");
    documentTask = library.getDocument({ data: bytes });
    pdfDocument = await documentTask.promise;
    if (loadSequence !== fileLoadSequence) return;

    if (pdfDocument.numPages < 1) throw new Error("EMPTY_PDF");
    setOptionalText(elements.diagnosticDocument, "Completado");
    setOptionalText(elements.diagnosticPages, String(pdfDocument.numPages));
    currentPage = 1;
    selectedPages = new Set();
    featuredPages = [];
    currentFileIdentity = getFileIdentity(file, bytes);
    documentBaseName = getSafeFileName(file.name);
    if (elements.exportProgress) elements.exportProgress.hidden = true;
    updateSelectionCount();
    elements.total.textContent = pdfDocument.numPages;
    const savedSession = readSavedSession();
    const canOfferRestore = elements.sessionRestore && elements.restoreSession && elements.discardSession;
    if (savedSession?.fileIdentity === currentFileIdentity && canOfferRestore) {
      pendingSession = savedSession;
    } else {
      discardSavedSession();
      pendingSession = null;
    }
    await renderPage();
    if (pendingSession && elements.sessionRestore) elements.sessionRestore.hidden = false;
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
  setOptionalText(elements.diagnosticError, error?.stack || `${name}: ${message}`);
}

function setOptionalText(element, text) {
  if (element) element.textContent = text;
}

function getSafeFileName(fileName) {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");
  return withoutExtension.replace(/[\\/:*?"<>|]+/g, "-").trim() || "documento";
}

function getFileIdentity(file, bytes) {
  let fingerprint = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += step) {
    fingerprint = Math.imul(fingerprint ^ bytes[index], 16777619);
  }
  return JSON.stringify([file.name, file.size, file.lastModified, file.type, fingerprint >>> 0]);
}

function readSavedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY));
    if (!session || typeof session.fileIdentity !== "string" || !Number.isInteger(session.currentPage) || !Array.isArray(session.selectedPages)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveCurrentSession() {
  if (!pdfDocument || !currentFileIdentity || pendingSession) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      fileIdentity: currentFileIdentity,
      currentPage,
      selectedPages: [...selectedPages],
      featuredPages: [...featuredPages],
    }));
  } catch {
    // Reading the PDF must continue even when storage is unavailable.
  }
}

function discardSavedSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Reading the PDF must continue even when storage is unavailable.
  }
}

async function restoreSavedSession() {
  if (!pdfDocument || !pendingSession) return;
  resetZoom();
  currentPage = Math.min(Math.max(pendingSession.currentPage, 1), pdfDocument.numPages);
  const restoredPages = pendingSession.selectedPages.filter((page) => Number.isInteger(page) && page >= 1 && page <= pdfDocument.numPages);
  const restoredPageSet = new Set(restoredPages);
  featuredPages = (Array.isArray(pendingSession.featuredPages) ? pendingSession.featuredPages : [])
    .filter((page, index, pages) => restoredPageSet.has(page) && pages.indexOf(page) === index);
  selectedPages = new Set([...featuredPages, ...restoredPages.filter((page) => !featuredPages.includes(page))]);
  pendingSession = null;
  if (elements.sessionRestore) elements.sessionRestore.hidden = true;
  updateSelectionCount();
  await renderPage();
}

async function startFreshSession() {
  if (!pdfDocument) return;
  resetZoom();
  pendingSession = null;
  discardSavedSession();
  currentPage = 1;
  selectedPages = new Set();
  featuredPages = [];
  if (elements.sessionRestore) elements.sessionRestore.hidden = true;
  updateSelectionCount();
  await renderPage();
}

function validatePdfFile(file) {
  const hasPdfName = file.name.toLowerCase().endsWith(".pdf");
  const hasPdfType = file.type === "application/pdf";

  if (!hasPdfName && !hasPdfType) throw new Error("NOT_PDF");
  if (file.size === 0) throw new Error("EMPTY_FILE");
}

function getReadableError(error) {
  if (error?.message === "NOT_PDF") return "O arquivo seleccionado non parece ser un PDF.";
  if (error?.message === "EMPTY_FILE" || error?.message === "EMPTY_PDF") return "O arquivo está baleiro e non contén páxinas.";
  if (error?.name === "PasswordException") return "Este PDF está protexido con contrasinal e aínda non se pode abrir.";
  if (error?.name === "InvalidPDFException") return "O arquivo está danado ou non contén un PDF válido.";
  if (error instanceof TypeError && !pdfjsLib) return "Non se puido cargar PDF.js. Comproba a conexión e téntao de novo.";
  return "Comproba que o arquivo sexa un PDF válido e téntao de novo.";
}

function showReader(fileName) {
  elements.name.textContent = fileName.replace(/\.pdf$/i, "") || "Documento";
  elements.welcome.hidden = true;
  elements.reader.hidden = false;
}

function isZoomed() {
  return zoomScale > 1.001;
}

function getTouchDistance(firstTouch, secondTouch) {
  return Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
}

function getTouchMidpoint(firstTouch, secondTouch) {
  return {
    x: (firstTouch.clientX + secondTouch.clientX) / 2,
    y: (firstTouch.clientY + secondTouch.clientY) / 2,
  };
}

function clampPan() {
  if (!isZoomed()) {
    panX = 0;
    panY = 0;
    return;
  }
  const maxPanX = Math.max(0, (elements.wrap.offsetWidth * zoomScale - elements.stage.clientWidth) / 2);
  const maxPanY = Math.max(0, (elements.wrap.offsetHeight * zoomScale - elements.stage.clientHeight) / 2);
  panX = Math.min(Math.max(panX, -maxPanX), maxPanX);
  panY = Math.min(Math.max(panY, -maxPanY), maxPanY);
}

function applyZoomTransform() {
  clampPan();
  const zoomed = isZoomed();
  elements.wrap.classList.toggle("is-zoomed", zoomed);
  elements.wrap.style.transform = zoomed ? `translate3d(${panX}px, ${panY}px, 0) scale(${zoomScale})` : "";
}

function resetZoom() {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  touchMode = null;
  suppressTap = false;
  applyZoomTransform();
}

function beginPinch(firstTouch, secondTouch) {
  const midpoint = getTouchMidpoint(firstTouch, secondTouch);
  const stageRect = elements.stage.getBoundingClientRect();
  const focalX = midpoint.x - (stageRect.left + stageRect.width / 2);
  const focalY = midpoint.y - (stageRect.top + stageRect.height / 2);
  touchMode = "pinch";
  suppressTap = true;
  pinchStartDistance = getTouchDistance(firstTouch, secondTouch) || 1;
  pinchStartScale = zoomScale;
  pinchAnchorX = (focalX - panX) / zoomScale;
  pinchAnchorY = (focalY - panY) / zoomScale;
}

function zoomAroundPoint(nextScale, clientX, clientY) {
  const stageRect = elements.stage.getBoundingClientRect();
  const focalX = clientX - (stageRect.left + stageRect.width / 2);
  const focalY = clientY - (stageRect.top + stageRect.height / 2);
  const contentX = (focalX - panX) / zoomScale;
  const contentY = (focalY - panY) / zoomScale;
  zoomScale = Math.min(4, Math.max(1, nextScale));
  panX = focalX - contentX * zoomScale;
  panY = focalY - contentY * zoomScale;
  applyZoomTransform();
}

function handleTap(clientX, clientY) {
  const now = Date.now();
  const isDoubleTap = now - lastTapTime < 300 && Math.hypot(clientX - lastTapX, clientY - lastTapY) < 32;
  if (isDoubleTap) {
    zoomAroundPoint(isZoomed() ? 1 : 2, clientX, clientY);
    lastTapTime = 0;
    return;
  }
  lastTapTime = now;
  lastTapX = clientX;
  lastTapY = clientY;
}

function getPageViewport(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const stageStyles = getComputedStyle(elements.stage);
  const availableWidth = elements.stage.clientWidth - parseFloat(stageStyles.paddingLeft) - parseFloat(stageStyles.paddingRight);
  const availableHeight = elements.stage.clientHeight - parseFloat(stageStyles.paddingTop) - parseFloat(stageStyles.paddingBottom);
  const displayScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  return {
    pixelRatio,
    viewport: page.getViewport({ scale: displayScale * pixelRatio }),
  };
}

function releaseCachedPage(cachedPage) {
  cachedPage.canvas.width = 1;
  cachedPage.canvas.height = 1;
}

function clearAdjacentPageCache() {
  for (const cachedPage of adjacentPageCache.values()) releaseCachedPage(cachedPage);
  adjacentPageCache.clear();
}

function pruneAdjacentPageCache() {
  for (const [pageNumber, cachedPage] of adjacentPageCache) {
    if (Math.abs(pageNumber - currentPage) > 1) {
      releaseCachedPage(cachedPage);
      adjacentPageCache.delete(pageNumber);
    }
  }
}

function cacheVisiblePage() {
  if (renderedPageNumber !== currentPage || !elements.canvas.width || adjacentPageCache.has(currentPage)) return;
  const canvas = document.createElement("canvas");
  canvas.width = elements.canvas.width;
  canvas.height = elements.canvas.height;
  canvas.getContext("2d").drawImage(elements.canvas, 0, 0);
  adjacentPageCache.set(currentPage, {
    canvas,
    cssWidth: elements.canvas.style.width,
    cssHeight: elements.canvas.style.height,
  });
}

function showCachedPage(cachedPage) {
  elements.canvas.width = cachedPage.canvas.width;
  elements.canvas.height = cachedPage.canvas.height;
  elements.canvas.style.width = cachedPage.cssWidth;
  elements.canvas.style.height = cachedPage.cssHeight;
  elements.canvas.getContext("2d").drawImage(cachedPage.canvas, 0, 0);
  releaseCachedPage(cachedPage);
}

async function preloadAdjacentPages(sequence) {
  for (const pageNumber of [currentPage - 1, currentPage + 1]) {
    if (sequence !== renderSequence || !pdfDocument || pageNumber < 1 || pageNumber > pdfDocument.numPages || adjacentPageCache.has(pageNumber)) continue;

    let page = null;
    let task = null;
    const canvas = document.createElement("canvas");
    try {
      page = await pdfDocument.getPage(pageNumber);
      if (sequence !== renderSequence) return;
      const { pixelRatio, viewport } = getPageViewport(page);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      preloadTask = task;
      await task.promise;
      if (preloadTask === task) preloadTask = null;
      if (sequence !== renderSequence) return;
      adjacentPageCache.set(pageNumber, {
        canvas,
        cssWidth: `${Math.floor(viewport.width / pixelRatio)}px`,
        cssHeight: `${Math.floor(viewport.height / pixelRatio)}px`,
      });
      pruneAdjacentPageCache();
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") console.warn("Non se puido precargar unha páxina adxacente.", error);
    } finally {
      if (preloadTask === task) preloadTask = null;
      page?.cleanup();
      if (!adjacentPageCache.has(pageNumber)) releaseCachedPage({ canvas });
    }
  }
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
  if (preloadTask) {
    preloadTask.cancel();
    preloadTask = null;
  }

  let page = null;
  try {
    const cachedPage = adjacentPageCache.get(currentPage);
    if (cachedPage) {
      adjacentPageCache.delete(currentPage);
      showCachedPage(cachedPage);
    } else {
      page = await pdfDocument.getPage(currentPage);
      if (sequence !== renderSequence) return;
      const { pixelRatio, viewport } = getPageViewport(page);
      elements.canvas.width = Math.floor(viewport.width);
      elements.canvas.height = Math.floor(viewport.height);
      elements.canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
      elements.canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
      renderTask = page.render({ canvasContext: elements.canvas.getContext("2d"), viewport });
      await renderTask.promise;
      renderTask = null;
    }
    renderedPageNumber = currentPage;
    if (isZoomed()) applyZoomTransform();
    pruneAdjacentPageCache();
    elements.current.textContent = currentPage;
    updateControls();
    updateSelectedState();
    animatePage(direction);
    preloadAdjacentPages(sequence);
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      reportDiagnosticError(error);
      showError("Produciuse un erro ao debuxar esta páxina.");
    }
  } finally {
    page?.cleanup();
    if (sequence === renderSequence) setLoading(false);
  }
}

function changePage(offset) {
  if (!pdfDocument || pendingSession) return;
  const nextPage = currentPage + offset;
  if (nextPage < 1 || nextPage > pdfDocument.numPages) return;
  cacheVisiblePage();
  resetZoom();
  currentPage = nextPage;
  pruneAdjacentPageCache();
  saveCurrentSession();
  renderPage(offset);
}

function selectAndContinue() {
  if (!pdfDocument || pendingSession) return;
  if (selectedPages.has(currentPage)) {
    selectedPages.delete(currentPage);
    featuredPages = featuredPages.filter((pageNumber) => pageNumber !== currentPage);
  } else {
    selectedPages.add(currentPage);
  }
  updateSelectionCount();
  updateSelectedState();
  saveCurrentSession();
  if (currentPage < pdfDocument.numPages) changePage(1);
}

function getFeaturedOrdinal(position) {
  const ordinals = ["primeira", "segunda", "terceira", "cuarta"];
  return ordinals[position - 1] || `${position}ª`;
}

function selectFeaturedAndContinue() {
  if (!pdfDocument || pendingSession || isExporting) return;
  if (selectedPages.has(currentPage)) return;
  featuredPages.push(currentPage);
  selectedPages = new Set([...featuredPages, ...selectedPages]);
  updateSelectionCount();
  updateSelectedState();
  saveCurrentSession();
  if (currentPage < pdfDocument.numPages) changePage(1);
}

function updateSelectionCount() {
  elements.selectedCount.textContent = selectedPages.size;
  const count = selectedPages.size;
  if (elements.downloadSelected) {
    elements.downloadSelected.textContent = count === 0 ? "Non hai páxinas seleccionadas." : "Descargar imaxes";
    elements.downloadSelected.disabled = isExporting || !pdfDocument || count === 0;
  }
}

function updateSelectedState() {
  const isSelected = selectedPages.has(currentPage);
  const selectedPosition = [...selectedPages].indexOf(currentPage) + 1;
  elements.wrap.classList.toggle("is-selected", isSelected);
  elements.selectAndContinue.classList.toggle("is-selected", isSelected);
  elements.selectAndContinue.setAttribute("aria-pressed", String(isSelected));
  elements.selectionActionLabel.textContent = isSelected ? "Deseleccionar e continuar" : "Seleccionar e continuar";
  elements.selectFeatured.hidden = isSelected;
  elements.selectFeatured.setAttribute("aria-pressed", "false");
  elements.selectFeaturedLabel.textContent = `Seleccionar como ${getFeaturedOrdinal(featuredPages.length + 1)}`;
  elements.selectionPositionStatus.textContent = isSelected ? `Seleccionada como ${selectedPosition}ª` : "";
  elements.selectionPositionStatus.hidden = !isSelected;
}

function animatePage(direction) {
  if (!direction) return;
  const className = direction > 0 ? "turn-right" : "turn-left";
  elements.wrap.classList.add(className);
  requestAnimationFrame(() => requestAnimationFrame(() => elements.wrap.classList.remove(className)));
}

function updateControls() {
  elements.continue.disabled = isExporting || Boolean(pendingSession) || !pdfDocument || currentPage >= pdfDocument.numPages;
  elements.selectAndContinue.disabled = isExporting || Boolean(pendingSession) || !pdfDocument;
  elements.selectFeatured.disabled = isExporting || Boolean(pendingSession) || !pdfDocument;
  if (elements.downloadSelected) {
    elements.downloadSelected.disabled = isExporting || !pdfDocument || selectedPages.size === 0;
  }
  elements.close.disabled = isExporting;
  elements.fileInput.disabled = isExporting;
}

function canvasToJpeg(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Non se puido crear a imaxe JPG."));
    }, "image/jpeg", quality);
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

function disposeThumbnails() {
  thumbnailSequence++;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  for (const task of thumbnailRenderTasks.values()) task.cancel();
  thumbnailRenderTasks.clear();
  thumbnailQueue = [];
  thumbnailQueuedPages.clear();
  thumbnailProcessingPages.clear();
  thumbnailActiveCount = 0;
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url);
  thumbnailUrls.clear();
}

function cancelThumbnail(pageNumber) {
  const item = elements.prepareGrid.querySelector(`[data-page="${pageNumber}"]`);
  if (item) thumbnailObserver?.unobserve(item);
  thumbnailQueue = thumbnailQueue.filter((queuedPage) => queuedPage !== pageNumber);
  thumbnailQueuedPages.delete(pageNumber);
  thumbnailRenderTasks.get(pageNumber)?.cancel();
  thumbnailRenderTasks.delete(pageNumber);
  const url = thumbnailUrls.get(pageNumber);
  if (url) URL.revokeObjectURL(url);
  thumbnailUrls.delete(pageNumber);
  updateThumbnailProgress();
}

function yieldToMainThread() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function updatePreparedNumbers(fromIndex = 0, toIndex = Infinity) {
  const items = [...elements.prepareGrid.querySelectorAll(".prepare-item")];
  items.forEach((item, index) => {
    if (index < fromIndex || index > toIndex) return;
    const position = item.querySelector(".prepare-number");
    position.textContent = index + 1;
    position.setAttribute("aria-label", `Posición de envío ${index + 1}`);
    item.querySelector('[data-action="up"]').disabled = isExporting || index === 0;
    item.querySelector('[data-action="down"]').disabled = isExporting || index === items.length - 1;
    item.querySelector('[data-action="first"]').disabled = isExporting || index === 0;
    item.querySelector('[data-action="remove"]').disabled = isExporting;
  });
}

function syncPreparedOrder(fromIndex = 0, toIndex = Infinity) {
  const items = [...elements.prepareGrid.querySelectorAll(".prepare-item")];
  preparedPages = items.map((item) => Number(item.dataset.page));
  const featuredSet = new Set(featuredPages);
  featuredPages = preparedPages.filter((pageNumber) => featuredSet.has(pageNumber));
  selectedPages = new Set(preparedPages);
  updatePreparedNumbers(fromIndex, toIndex);
  updateSelectionCount();
  saveCurrentSession();
  elements.confirmDownload.disabled = preparedPages.length === 0 || isExporting;
}

function movePreparedItem(item, action) {
  if (isExporting) return;
  const items = [...elements.prepareGrid.querySelectorAll(".prepare-item")];
  const index = items.indexOf(item);
  let nextIndex = index;
  if (action === "up" && index > 0) {
    elements.prepareGrid.insertBefore(item, items[index - 1]);
    nextIndex = index - 1;
  }
  if (action === "down" && index < items.length - 1) {
    items[index + 1].after(item);
    nextIndex = index + 1;
  }
  if (action === "first" && index > 0) {
    elements.prepareGrid.prepend(item);
    nextIndex = 0;
  }
  syncPreparedOrder(Math.min(index, nextIndex), Math.max(index, nextIndex));
}

function togglePreparedItem(item) {
  const controls = item.querySelector(".prepare-item-controls");
  const toggle = item.querySelector(".prepare-card-toggle");
  const willExpand = controls.hidden;

  for (const expandedItem of elements.prepareGrid.querySelectorAll(".prepare-item.is-expanded")) {
    expandedItem.classList.remove("is-expanded");
    expandedItem.querySelector(".prepare-item-controls").hidden = true;
    expandedItem.querySelector(".prepare-card-toggle").setAttribute("aria-expanded", "false");
  }

  controls.hidden = !willExpand;
  item.classList.toggle("is-expanded", willExpand);
  toggle.setAttribute("aria-expanded", String(willExpand));
}

function createPreparedItem(pageNumber, index) {
  const item = document.createElement("article");
  item.className = "prepare-item";
  item.dataset.page = pageNumber;
  item.innerHTML = `
    <button class="prepare-card-toggle" type="button" aria-label="Mostrar controis da páxina ${pageNumber}" aria-expanded="false">
      <span class="prepare-meta">
        <span class="prepare-number" aria-label="Posición de envío ${index + 1}">${index + 1}</span>
        <span class="prepare-page-label">Páxina ${pageNumber}</span>
      </span>
      <span class="prepare-preview">
        <span class="prepare-placeholder" role="status">Cargando miniatura…</span>
      </span>
    </button>
    <div class="prepare-item-controls" hidden>
      <button type="button" data-action="up" aria-label="Subir páxina ${pageNumber}">Subir</button>
      <button type="button" data-action="first" aria-label="Mover páxina ${pageNumber} ao primeiro posto">Primeira</button>
      <button type="button" data-action="down" aria-label="Baixar páxina ${pageNumber}">Baixar</button>
      <button type="button" data-action="remove" aria-label="Eliminar páxina ${pageNumber}">Eliminar</button>
    </div>
  `;
  item.querySelector(".prepare-card-toggle").addEventListener("click", () => togglePreparedItem(item));
  item.querySelector(".prepare-item-controls").addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (!action || isExporting) return;
    if (action !== "remove") {
      movePreparedItem(item, action);
      return;
    }
    const removedIndex = [...elements.prepareGrid.querySelectorAll(".prepare-item")].indexOf(item);
    cancelThumbnail(pageNumber);
    item.remove();
    syncPreparedOrder(Math.max(0, removedIndex - 1));
    if (preparedPages.length === 0) elements.prepareGrid.innerHTML = '<p class="prepare-empty">Non hai páxinas seleccionadas.</p>';
  });
  return item;
}

function updateThumbnailProgress() {
  const isBusy = thumbnailActiveCount > 0 || thumbnailQueue.length > 0;
  elements.prepareProgress.hidden = !isBusy;
  elements.prepareProgressBar.max = Math.max(1, preparedPages.length);
  elements.prepareProgressBar.value = thumbnailUrls.size;
  if (isBusy) setOptionalText(elements.prepareProgressText, "Cargando miniaturas visibles…");
}

async function renderPreparedThumbnail(pageNumber, sequence) {
  let page = null;
  let task = null;
  const canvas = document.createElement("canvas");
  try {
    await yieldToMainThread();
    if (sequence !== thumbnailSequence || !preparedPages.includes(pageNumber)) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (pageNumber === renderedPageNumber && elements.canvas.width > 1) {
      const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / elements.canvas.width, THUMBNAIL_MAX_HEIGHT / elements.canvas.height);
      canvas.width = Math.max(1, Math.floor(elements.canvas.width * scale));
      canvas.height = Math.max(1, Math.floor(elements.canvas.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(elements.canvas, 0, 0, canvas.width, canvas.height);
    } else {
      page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / baseViewport.width, THUMBNAIL_MAX_HEIGHT / baseViewport.height);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      task = page.render({ canvasContext: context, viewport });
      thumbnailRenderTasks.set(pageNumber, task);
      await task.promise;
    }
    const blob = await canvasToJpeg(canvas, 0.7);
    if (sequence !== thumbnailSequence || !preparedPages.includes(pageNumber)) return;
    const url = URL.createObjectURL(blob);
    thumbnailUrls.set(pageNumber, url);
    const item = elements.prepareGrid.querySelector(`[data-page="${pageNumber}"]`);
    if (item) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Páxina ${pageNumber}`;
      item.querySelector(".prepare-placeholder")?.replaceWith(image);
      item.classList.add("is-thumbnail-loaded");
      thumbnailObserver?.unobserve(item);
    }
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      reportDiagnosticError(error);
      setOptionalText(elements.prepareProgressText, "Non se puido cargar unha miniatura.");
      const item = elements.prepareGrid.querySelector(`[data-page="${pageNumber}"]`);
      const placeholder = item?.querySelector(".prepare-placeholder");
      if (placeholder) {
        placeholder.textContent = "Non se puido cargar a miniatura.";
        placeholder.classList.add("is-error");
      }
      if (item) thumbnailObserver?.unobserve(item);
    }
  } finally {
    if (thumbnailRenderTasks.get(pageNumber) === task) thumbnailRenderTasks.delete(pageNumber);
    page?.cleanup();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function processThumbnailQueue(sequence) {
  while (sequence === thumbnailSequence && thumbnailActiveCount < MAX_CONCURRENT_THUMBNAILS && thumbnailQueue.length > 0) {
    const pageNumber = thumbnailQueue.shift();
    if (thumbnailUrls.has(pageNumber) || !preparedPages.includes(pageNumber)) {
      thumbnailQueuedPages.delete(pageNumber);
      continue;
    }
    thumbnailProcessingPages.add(pageNumber);
    thumbnailActiveCount++;
    renderPreparedThumbnail(pageNumber, sequence).finally(() => {
      if (sequence !== thumbnailSequence) return;
      thumbnailProcessingPages.delete(pageNumber);
      thumbnailQueuedPages.delete(pageNumber);
      thumbnailActiveCount--;
      updateThumbnailProgress();
      processThumbnailQueue(sequence);
    });
  }
  updateThumbnailProgress();
}

function enqueueThumbnail(pageNumber, sequence) {
  if (sequence !== thumbnailSequence || thumbnailUrls.has(pageNumber) || thumbnailQueuedPages.has(pageNumber) || thumbnailProcessingPages.has(pageNumber)) return;
  thumbnailQueuedPages.add(pageNumber);
  thumbnailQueue.push(pageNumber);
  processThumbnailQueue(sequence);
}

function observePreparedThumbnails() {
  const sequence = ++thumbnailSequence;
  const items = [...elements.prepareGrid.querySelectorAll(".prepare-item")];
  if (!("IntersectionObserver" in window)) {
    items.slice(0, 8).forEach((item) => enqueueThumbnail(Number(item.dataset.page), sequence));
    return;
  }
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) enqueueThumbnail(Number(entry.target.dataset.page), sequence);
    }
  }, { root: elements.prepareGrid, rootMargin: "300px 0px", threshold: 0.01 });
  items.forEach((item) => thumbnailObserver.observe(item));
}

function openPrepareSend() {
  if (!pdfDocument || selectedPages.size === 0 || isExporting) return;
  disposeThumbnails();
  if (preloadTask) {
    preloadTask.cancel();
    preloadTask = null;
  }
  clearAdjacentPageCache();
  preparedPages = [...selectedPages];
  elements.prepareGrid.replaceChildren(...preparedPages.map(createPreparedItem));
  updatePreparedNumbers();
  elements.prepareProgress.hidden = true;
  elements.confirmDownload.disabled = false;
  elements.reader.hidden = true;
  elements.prepareSend.hidden = false;
  observePreparedThumbnails();
}

function closePrepareSend() {
  if (isExporting) return;
  disposeThumbnails();
  elements.prepareSend.hidden = true;
  elements.reader.hidden = false;
  elements.prepareProgress.hidden = true;
  updateSelectionCount();
  updateSelectedState();
}

async function downloadSelectedPages() {
  if (!pdfDocument || preparedPages.length === 0 || isExporting) return;

  const pages = [...preparedPages];
  const orderWidth = Math.max(2, String(pages.length).length);
  const exportCanvas = document.createElement("canvas");
  const context = exportCanvas.getContext("2d", { alpha: false });
  if (!context) {
    reportDiagnosticError(new Error("Non se puido crear o lenzo para exportar."));
    return;
  }
  isExporting = true;
  elements.prepareProgress.hidden = false;
  elements.prepareProgressBar.max = pages.length;
  elements.prepareProgressBar.value = 0;
  elements.backToReader.disabled = true;
  elements.confirmDownload.disabled = true;
  updatePreparedNumbers();
  updateControls();

  try {
    for (let index = 0; index < pages.length; index++) {
      const pageNumber = pages[index];
      setOptionalText(elements.prepareProgressText, `Xerando páxina ${index + 1} de ${pages.length}…`);
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
        const orderPrefix = String(index + 1).padStart(orderWidth, "0");
        objectUrl = downloadBlob(blob, `${orderPrefix}_paxina-${pageNumber}.jpg`);
        elements.prepareProgressBar.value = index + 1;
        setOptionalText(elements.prepareProgressText, `Gardada ${index + 1} de ${pages.length}`);
        await waitForDownload();
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        page?.cleanup();
        exportCanvas.width = 1;
        exportCanvas.height = 1;
      }
    }
    setOptionalText(elements.prepareProgressText, "Imaxes gardadas correctamente.");
  } catch (error) {
    console.error(error);
    reportDiagnosticError(error);
    setOptionalText(elements.prepareProgressText, `Error: ${error?.message || String(error)}`);
  } finally {
    exportCanvas.width = 1;
    exportCanvas.height = 1;
    isExporting = false;
    elements.backToReader.disabled = false;
    elements.confirmDownload.disabled = preparedPages.length === 0;
    updatePreparedNumbers();
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
  resetZoom();
  disposeThumbnails();
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  if (preloadTask) {
    preloadTask.cancel();
    preloadTask = null;
  }
  clearAdjacentPageCache();
  renderedPageNumber = null;
  elements.canvas.width = 1;
  elements.canvas.height = 1;
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
  pendingSession = null;
  currentFileIdentity = null;
  if (elements.sessionRestore) elements.sessionRestore.hidden = true;
  elements.fileInput.value = "";
  elements.reader.hidden = true;
  elements.prepareSend.hidden = true;
  elements.welcome.hidden = false;
}

elements.fileInput.addEventListener("change", (event) => {
  setOptionalText(elements.diagnosticChange, `Disparado (${new Date().toLocaleTimeString("gl-ES")})`);
  const [file] = event.target.files;
  event.target.value = "";
  openPdf(file);
});
elements.close.addEventListener("click", returnHome);
elements.selectAndContinue.addEventListener("click", selectAndContinue);
elements.selectFeatured.addEventListener("click", selectFeaturedAndContinue);
elements.continue.addEventListener("click", () => changePage(1));
elements.downloadSelected?.addEventListener("click", openPrepareSend);
elements.backToReader.addEventListener("click", closePrepareSend);
elements.confirmDownload.addEventListener("click", downloadSelectedPages);
elements.restoreSession?.addEventListener("click", restoreSavedSession);
elements.discardSession?.addEventListener("click", startFreshSession);
elements.diagnosticsToggle?.addEventListener("click", () => {
  if (!elements.diagnostics) return;
  const willShow = elements.diagnostics.hidden;
  elements.diagnostics.hidden = !willShow;
  elements.diagnosticsToggle.setAttribute("aria-expanded", String(willShow));
});
elements.clearCache?.addEventListener("click", async () => {
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
  if (pendingSession) return;
  if (event.touches.length >= 2) {
    beginPinch(event.touches[0], event.touches[1]);
    event.preventDefault();
    return;
  }
  const [touch] = event.touches;
  touchMode = "single";
  suppressTap = false;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchStartPanX = panX;
  touchStartPanY = panY;
}, { passive: false });

elements.stage.addEventListener("touchmove", (event) => {
  if (event.touches.length >= 2) {
    if (touchMode !== "pinch") beginPinch(event.touches[0], event.touches[1]);
    const midpoint = getTouchMidpoint(event.touches[0], event.touches[1]);
    const stageRect = elements.stage.getBoundingClientRect();
    const focalX = midpoint.x - (stageRect.left + stageRect.width / 2);
    const focalY = midpoint.y - (stageRect.top + stageRect.height / 2);
    zoomScale = Math.min(4, Math.max(1, pinchStartScale * getTouchDistance(event.touches[0], event.touches[1]) / pinchStartDistance));
    panX = focalX - pinchAnchorX * zoomScale;
    panY = focalY - pinchAnchorY * zoomScale;
    applyZoomTransform();
    event.preventDefault();
    return;
  }
  if (event.touches.length === 1 && touchMode === "single" && isZoomed()) {
    const [touch] = event.touches;
    panX = touchStartPanX + touch.clientX - touchStartX;
    panY = touchStartPanY + touch.clientY - touchStartY;
    applyZoomTransform();
    event.preventDefault();
  }
}, { passive: false });

elements.stage.addEventListener("touchend", (event) => {
  if (event.touches.length === 1) {
    const [touch] = event.touches;
    touchMode = "single";
    suppressTap = true;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartPanX = panX;
    touchStartPanY = panY;
    return;
  }

  const [touch] = event.changedTouches;
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;
  const wasSingleTouch = touchMode === "single";
  if (wasSingleTouch && !suppressTap && Math.hypot(deltaX, deltaY) < 12) {
    handleTap(touch.clientX, touch.clientY);
  } else if (wasSingleTouch && !isZoomed() && Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
    changePage(deltaX < 0 ? 1 : -1);
  }
  touchMode = null;
  suppressTap = false;
}, { passive: false });

elements.stage.addEventListener("touchcancel", () => {
  touchMode = null;
  suppressTap = false;
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.thumbnailViewer.hidden) {
    closeThumbnailViewer();
    return;
  }
  if (elements.reader.hidden) return;
  if (event.key === "ArrowLeft") changePage(-1);
  if (event.key === "ArrowRight") changePage(1);
  if (event.key === "Escape") returnHome();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    clearAdjacentPageCache();
    renderedPageNumber = null;
    renderPage();
  }, 150);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }));
}

updateControls();
