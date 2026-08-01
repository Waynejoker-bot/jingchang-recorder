import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Jingchang recording studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>镜场｜创作者录制台<\/title>/i);
  assert.match(html, /aria-label="录制画面"/);
  assert.match(html, />摄像头<\/button>/);
  assert.match(html, />录屏<\/button>/);
  assert.match(html, />录屏 \+ 人像<\/button>/);
  assert.match(html, /选择屏幕/);
  assert.match(html, /悬浮提词器/);
  assert.match(html, /录制库/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);
});

test("keeps crop controls above the recording preview", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const headingIndex = page.indexOf('className="stage-heading"');
  const toolbarIndex = page.indexOf('className="crop-toolbar"');
  const modeTabsIndex = page.indexOf('className="mode-tabs"');
  const previewIndex = page.indexOf('className="preview-wrap"');
  const overlayIndex = page.indexOf("crop-selection-overlay");

  assert.ok(headingIndex >= 0, "stage heading must exist");
  assert.ok(toolbarIndex > headingIndex, "crop toolbar must be in the heading");
  assert.ok(modeTabsIndex > toolbarIndex, "crop toolbar must sit before mode tabs");
  assert.ok(previewIndex > modeTabsIndex, "preview must follow the heading controls");
  assert.ok(overlayIndex > previewIndex, "only the crop selection overlay belongs in preview");

  const toolbarRule = css.match(/\.crop-toolbar\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.doesNotMatch(toolbarRule, /position:\s*absolute/);
  assert.match(css, /\.crop-selection-overlay\s*\{[^}]*position:\s*absolute/s);
});
