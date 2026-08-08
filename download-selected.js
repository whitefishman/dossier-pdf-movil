export function bindDownloadSelected(button, options) {
  button?.addEventListener("click", () => {
    const selectedPages = options.getSelectedPages();
    if (!options.canOpen() || selectedPages.size === 0) return;

    options.controller.open([...selectedPages]);
    options.reader.hidden = true;
  });
}
