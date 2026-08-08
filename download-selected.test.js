import assert from "node:assert/strict";
import test from "node:test";

import { bindDownloadSelected } from "./download-selected.js";

test("download-selected opens Prepare Send with all pages in selection order", () => {
  let clickHandler;
  const button = {
    addEventListener(type, handler) {
      assert.equal(type, "click");
      clickHandler = handler;
    },
  };
  const selectedPages = new Set([8, 3, 12]);
  const openedWith = [];
  const controller = { open: (pages) => openedWith.push(pages) };
  const reader = { hidden: false };

  bindDownloadSelected(button, {
    getSelectedPages: () => selectedPages,
    canOpen: () => true,
    controller,
    reader,
  });
  clickHandler();

  assert.deepEqual(openedWith, [[8, 3, 12]]);
  assert.equal(reader.hidden, true);
  assert.deepEqual([...selectedPages], [8, 3, 12]);
});
