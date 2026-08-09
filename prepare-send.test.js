import assert from "node:assert/strict";
import test from "node:test";

import { reorderPages } from "./prepare-send.js";

test("Subir moves a selected page one position up", () => {
  assert.deepEqual(reorderPages([8, 3, 12], 12, "up"), [8, 12, 3]);
});

test("Baixar moves a selected page one position down", () => {
  assert.deepEqual(reorderPages([8, 3, 12], 8, "down"), [3, 8, 12]);
});

test("Primeira moves a selected page to the beginning", () => {
  assert.deepEqual(reorderPages([8, 3, 12], 12, "first"), [12, 8, 3]);
});

test("Eliminar removes a selected page from the batch", () => {
  assert.deepEqual(reorderPages([8, 3, 12], 3, "remove"), [8, 12]);
});

test("the resulting page order is preserved for download", () => {
  const afterUp = reorderPages([8, 3, 12], 12, "up");
  const afterFirst = reorderPages(afterUp, 3, "first");
  const downloaded = [];

  downloaded.push(...afterFirst);

  assert.deepEqual(downloaded, [3, 8, 12]);
});

test("reordering does not mutate page or preview collections", () => {
  const pages = [8, 3, 12];
  const previews = new Map(pages.map((page) => [page, { page }]));
  const originalPreviews = new Map(previews);

  assert.deepEqual(reorderPages(pages, 12, "first"), [12, 8, 3]);
  assert.deepEqual(pages, [8, 3, 12]);
  assert.deepEqual(previews, originalPreviews);
  for (const [page, preview] of originalPreviews) assert.equal(previews.get(page), preview);
});
