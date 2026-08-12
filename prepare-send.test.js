import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("twenty pages keep a stable visible and download order after every command", () => {
  let visiblePages = Array.from({ length: 20 }, (_, index) => index + 1);
  const previews = new Map(visiblePages.map((page) => [page, `preview-${page}`]));

  visiblePages = reorderPages(visiblePages, 20, "first");
  visiblePages = reorderPages(visiblePages, 5, "down");
  visiblePages = reorderPages(visiblePages, 11, "up");
  visiblePages = reorderPages(visiblePages, 3, "remove");

  const downloadedPages = [...visiblePages];
  assert.deepEqual(downloadedPages, visiblePages);
  assert.equal(downloadedPages[0], 20);
  assert.equal(downloadedPages.includes(3), false);
  assert.equal(previews.size, 20);
  for (const page of downloadedPages) assert.equal(previews.get(page), `preview-${page}`);
});

test("cards use normal two-column grid flow and intrinsically sized complete images", () => {
  const css = readFileSync(new URL("./prepare-send.css", import.meta.url), "utf8");
  const listRule = css.match(/\.send-review__list\s*\{([^}]*)\}/)?.[1] ?? "";
  const cardRule = css.match(/\.send-sheet\s*\{([^}]*)\}/)?.[1] ?? "";
  const imageRule = css.match(/\.send-sheet__image\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(listRule, /display:\s*grid/);
  assert.match(listRule, /grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(listRule, /align-items:\s*start/);
  assert.doesNotMatch(listRule, /masonry|position:\s*absolute|transform:/);
  assert.doesNotMatch(cardRule, /position:\s*absolute|height:|transform:/);
  assert.match(imageRule, /width:\s*100%/);
  assert.match(imageRule, /height:\s*auto/);
  assert.doesNotMatch(imageRule, /position:|aspect-ratio|object-fit|overflow|transform:/);
});

test("twenty differently proportioned portrait pages form non-overlapping grid rows", () => {
  const ratios = [1.18, 1.24, 1.31, 1.37, 1.42, 1.48, 1.53, 1.59, 1.64, 1.7,
    1.76, 1.82, 1.89, 1.95, 2.02, 2.08, 2.15, 2.22, 2.3, 2.4];
  const cardWidth = 170;
  const captionHeight = 35;
  const controlsHeight = 88;
  const rowGap = 12;
  let rowTop = 0;

  for (let index = 0; index < ratios.length; index += 2) {
    const row = ratios.slice(index, index + 2).map((ratio) => {
      const imageHeight = cardWidth * ratio;
      const controlsTop = rowTop + captionHeight + imageHeight;
      return { top: rowTop, imageBottom: controlsTop, controlsTop, bottom: controlsTop + controlsHeight };
    });
    for (const card of row) {
      assert.equal(card.controlsTop, card.imageBottom);
      assert.ok(card.top >= 0);
    }
    const nextRowTop = Math.max(...row.map((card) => card.bottom)) + rowGap;
    assert.ok(row.every((card) => nextRowTop > card.bottom));
    rowTop = nextRowTop;
  }

  assert.ok(rowTop > 4000, "the last row remains reachable through ordinary vertical scrolling");
});

test("each card presents its caption, complete image, then its two control rows", () => {
  const source = readFileSync(new URL("./prepare-send.js", import.meta.url), "utf8");
  const caption = source.indexOf('<header class="send-sheet__caption">');
  const preview = source.indexOf('<span class="send-sheet__preview">', caption);
  const controls = source.indexOf('<div class="send-sheet__controls"', preview);
  const up = source.indexOf('data-command="up"', controls);
  const down = source.indexOf('data-command="down"', up);
  const first = source.indexOf('data-command="first"', down);
  const remove = source.indexOf('data-command="remove"', first);

  assert.ok(caption >= 0 && caption < preview && preview < controls);
  assert.ok(controls < up && up < down && down < first && first < remove);
});
