const MAX_PARALLEL_PREVIEWS = 2;

export function createPrepareSend(options) {
  const { screen, list, progress, progressBar, progressText, backButton, downloadButton } = options;
  let pages = [];
  let openPage = null;
  let generation = 0;
  let queue = [];
  let running = 0;
  let exporting = false;
  const queued = new Set();
  const tasks = new Map();
  const previews = new Map();
  const previewStats = { requested: 0, completed: 0, failed: 0, lastError: "Sen erros" };

  function reportStats() { options.onPreviewStats?.({ ...previewStats }); }

  function cards() { return [...list.querySelectorAll(".send-sheet")]; }

  function updateProgress() {
    const busy = running > 0 || queue.length > 0;
    progress.hidden = !busy;
    progressBar.max = Math.max(1, pages.length);
    progressBar.value = previews.size;
    if (busy) progressText.textContent = `Cargando miniaturas… ${previewStats.completed + previewStats.failed}/${previewStats.requested}`;
  }

  function refreshPositions(from = 0, to = Infinity) {
    const allCards = cards();
    allCards.forEach((card, index) => {
      if (index < from || index > to) return;
      card.querySelector(".send-sheet__position").textContent = String(index + 1);
      card.querySelector('[data-command="up"]').disabled = exporting || index === 0;
      card.querySelector('[data-command="first"]').disabled = exporting || index === 0;
      card.querySelector('[data-command="down"]').disabled = exporting || index === allCards.length - 1;
      card.querySelector('[data-command="remove"]').disabled = exporting;
    });
    downloadButton.disabled = exporting || pages.length === 0;
  }

  function syncOrder(from = 0, to = Infinity) {
    pages = cards().map((card) => Number(card.dataset.page));
    refreshPositions(from, to);
    options.onOrderChanged([...pages]);
  }

  function closeControls() {
    if (openPage === null) return;
    const card = list.querySelector(`.send-sheet[data-page="${openPage}"]`);
    card?.classList.remove("send-sheet--open");
    card?.querySelector(".send-sheet__toggle")?.setAttribute("aria-expanded", "false");
    openPage = null;
  }

  function toggleControls(card) {
    const page = Number(card.dataset.page);
    const wasOpen = openPage === page;
    closeControls();
    if (!wasOpen) {
      card.classList.add("send-sheet--open");
      card.querySelector(".send-sheet__toggle").setAttribute("aria-expanded", "true");
      openPage = page;
    }
  }

  function cancelPage(page) {
    queue = queue.filter((value) => value !== page);
    queued.delete(page);
    tasks.get(page)?.cancel?.();
    tasks.delete(page);
    const url = previews.get(page);
    if (url) URL.revokeObjectURL(url);
    previews.delete(page);
  }

  function runQueue(token) {
    while (token === generation && running < MAX_PARALLEL_PREVIEWS && queue.length) {
      const page = queue.shift();
      if (!pages.includes(page) || previews.has(page)) { queued.delete(page); continue; }
      running++;
      Promise.resolve().then(() => options.renderPreview(page, (task) => tasks.set(page, task), () => token !== generation || !pages.includes(page)))
        .then((blob) => {
          if (token !== generation || !pages.includes(page)) return;
          if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || blob.size === 0) {
            throw new TypeError(`renderPreview non devolveu un Blob de imaxe válido para a páxina ${page}.`);
          }
          const url = URL.createObjectURL(blob);
          previews.set(page, url);
          previewStats.completed++;
          reportStats();
          const card = list.querySelector(`.send-sheet[data-page="${page}"]`);
          const image = document.createElement("img");
          image.className = "send-sheet__image";
          image.src = url;
          image.alt = `Miniatura da páxina ${page}`;
          card?.querySelector(".send-sheet__loading")?.replaceWith(image);
        })
        .catch((error) => {
          if (error?.name === "RenderingCancelledException" || token !== generation) return;
          const message = error?.stack || `${error?.name || "Error"}: ${error?.message || String(error)}`;
          previewStats.failed++;
          previewStats.lastError = message;
          reportStats();
          const state = list.querySelector(`.send-sheet[data-page="${page}"] .send-sheet__loading`);
          if (state) { state.classList.add("send-sheet__loading--error"); state.textContent = message; }
          options.onPreviewError(error);
        })
        .finally(() => {
          if (token === generation) {
            tasks.delete(page); queued.delete(page); running--;
            updateProgress(); runQueue(token);
          }
        });
    }
    updateProgress();
  }

  function enqueue(page, token) {
    if (token !== generation || queued.has(page) || previews.has(page)) return;
    queued.add(page); queue.push(page); previewStats.requested++; reportStats(); runQueue(token);
  }

  function createCard(page, index) {
    const card = document.createElement("article");
    card.className = "send-sheet";
    card.dataset.page = page;
    card.innerHTML = `<button class="send-sheet__toggle" type="button" aria-expanded="false" aria-label="Abrir accións da páxina ${page}">
      <span class="send-sheet__preview"><span class="send-sheet__loading" role="status"><i></i>Cargando…</span></span>
      <span class="send-sheet__caption"><strong><span class="send-sheet__position">${index + 1}</span><span class="send-sheet__order-label">ª no envío</span></strong><span>Páxina ${page}</span><b aria-hidden="true">•••</b></span>
    </button><div class="send-sheet__commands">
      <button type="button" data-command="up">↑ <span>Subir</span></button><button type="button" data-command="down">↓ <span>Baixar</span></button>
      <button type="button" data-command="first">★ <span>Primeira</span></button><button type="button" data-command="remove">✕ <span>Eliminar</span></button>
    </div>`;
    card.querySelector(".send-sheet__toggle").addEventListener("click", () => toggleControls(card));
    card.querySelector(".send-sheet__commands").addEventListener("click", (event) => command(card, event.target.closest("button")?.dataset.command));
    return card;
  }

  function command(card, action) {
    if (!action || exporting) return;
    const allCards = cards();
    const index = allCards.indexOf(card);
    let next = index;
    if (action === "up" && index > 0) { list.insertBefore(card, allCards[index - 1]); next--; }
    else if (action === "down" && index < allCards.length - 1) { allCards[index + 1].after(card); next++; }
    else if (action === "first" && index > 0) { list.prepend(card); next = 0; }
    else if (action === "remove") {
      const page = Number(card.dataset.page); cancelPage(page); card.remove(); closeControls();
      syncOrder(Math.max(0, index - 1));
      if (!pages.length) list.innerHTML = '<p class="send-review__empty">Non hai páxinas seleccionadas.</p>';
      return;
    } else return;
    syncOrder(Math.min(index, next), Math.max(index, next));
  }

  function dispose() {
    generation++; queue = [];
    tasks.forEach((task) => task.cancel?.()); tasks.clear(); queued.clear(); running = 0;
    previews.forEach((url) => URL.revokeObjectURL(url)); previews.clear(); closeControls(); updateProgress();
  }

  function open(orderedPages) {
    dispose(); pages = [...orderedPages];
    previewStats.requested = 0; previewStats.completed = 0; previewStats.failed = 0; previewStats.lastError = "Sen erros"; reportStats();
    list.replaceChildren(...pages.map(createCard));
    refreshPositions(); screen.hidden = false;
    const token = generation;
    // Enqueue every card immediately. In particular, the first four previews never
    // depend on visibility or IntersectionObserver support on Android.
    cards().forEach((card) => enqueue(Number(card.dataset.page), token));
  }

  function close() { if (exporting) return; dispose(); screen.hidden = true; options.onBack(); }
  function setExporting(value) { exporting = value; backButton.disabled = value; refreshPositions(); }
  backButton.addEventListener("click", close);
  downloadButton.addEventListener("click", () => options.onDownload([...pages]));
  return { open, close, dispose, setExporting, getPages: () => [...pages] };
}
