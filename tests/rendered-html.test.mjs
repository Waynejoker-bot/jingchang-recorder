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
  assert.match(html, /aria-label="录制画幅"/);
  assert.match(html, />16:9<\/button>/);
  assert.match(html, />4:3<\/button>/);
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

test("keeps the primary recording controls inside the desktop viewport", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.workspace\s*\{[^}]*height:\s*calc\(100dvh - 72px\)[^}]*min-height:\s*0/s,
  );
  assert.match(
    css,
    /\.stage-panel\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /\.preview-wrap\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /\.preview-frame-slot\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
  );
  assert.match(
    css,
    /\.preview-stage\s*\{[^}]*width:\s*auto[^}]*max-width:\s*100%[^}]*height:\s*100%[^}]*max-height:\s*100%/s,
  );
  assert.match(css, /\.control-dock\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(
    css,
    /@media \(max-width: 860px\)[\s\S]*?\.workspace\s*\{[^}]*height:\s*auto[^}]*min-height:\s*calc\(100vh - 72px\)/s,
  );
});

test("keeps the device controls minimal and action-led", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /className="device-workspace" aria-label="设备控制与状态"/);
  assert.match(page, /className="device-control-item"/);
  assert.match(page, /role="switch"/);
  assert.match(page, /aria-checked=\{cameraEnabled\}/);
  assert.match(page, /aria-checked=\{microphoneEnabled\}/);
  assert.match(page, /aria-label=\{cameraEnabled \? "关闭摄像头" : "开启摄像头"\}/);
  assert.match(page, /aria-label=\{microphoneEnabled \? "静音麦克风" : "开启麦克风"\}/);
  assert.match(page, /<span className="button-kicker">步骤 1<\/span>/);
  assert.match(page, /<span className="button-kicker">步骤 1<\/span>\s*开启摄像头/);
  assert.doesNotMatch(page, /className="quick-toggles"/);
  assert.doesNotMatch(page, /className="device-state/);
  assert.doesNotMatch(page, /className="recording-readiness"/);
  assert.doesNotMatch(page, /className=\{`status-line/);
  assert.doesNotMatch(page, /MIC \{microphoneEnabled/);
  assert.doesNotMatch(page, /CAM \{cameraEnabled/);
  assert.doesNotMatch(page, /\{cameraEnabled \? "开" : "关"\}/);
  assert.doesNotMatch(page, /\{microphoneEnabled \? "开" : "关"\}/);
});

test("uses the selected standard aspect for both preview and MP4 output", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /type RecordingAspect = "16:9" \| "4:3"/);
  assert.match(page, /id: "16:9"[\s\S]*?width: 1920,[\s\S]*?height: 1080/);
  assert.match(page, /id: "4:3"[\s\S]*?width: 1440,[\s\S]*?height: 1080/);
  assert.match(page, /const dimensions = getRecordingDimensions\(\)/);
  assert.match(page, /canvas\.width = dimensions\.width/);
  assert.match(page, /canvas\.height = dimensions\.height/);
  assert.match(page, /style=\{\{ aspectRatio: recordingAspect\.replace\(":", " \/ "\) \}\}/);
  assert.match(page, /MP4 · \{recordingAspect\} · \{outputResolution\} · 30 FPS/);
});

test("keeps focus on the studio and can replace an active screen share", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /CaptureController\?: new \(\) => CaptureControllerLike/);
  assert.match(page, /options\.controller = focusController/);
  assert.match(page, /focusController\?\.setFocusBehavior\("no-focus-change"\)/);
  assert.match(page, /window\.focus\(\)/);
  assert.match(
    page,
    /const openScreen = useCallback\(\(replaceActive = false\) => \{/,
  );
  assert.match(
    page,
    /if \(previousStream\?\.active && !replaceActive\) \{\s*return Promise\.resolve\(previousStream\)/s,
  );
  assert.match(page, /if \(screenOpenPromiseRef\.current\) return screenOpenPromiseRef\.current/);
  assert.match(page, /await openScreen\(true\)/);
  assert.match(page, /if \(screenStreamRef\.current !== stream\) return/);
  assert.match(
    page,
    /if \(previousStream && previousStream !== stream\) \{\s*disconnectAudioStreamFromMixer\(previousStream\);\s*stopStream\(previousStream\)/s,
  );
  assert.match(page, /aria-busy=\{screenSelectionPending\}/);
});

test("protects interrupted recordings and exposes a real MP4 rescue download", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /INTERRUPTED_RECORDING_KEY/);
  assert.match(page, /window\.addEventListener\("beforeunload", warnBeforeLeaving\)/);
  assert.match(page, /上次录制异常中断，没有生成可用文件/);
  assert.match(page, /QuotaExceededError/);
  assert.match(page, /下载 MP4 副本/);
  assert.match(page, /className="recording-rescue"/);
  assert.match(styles, /\.recording-rescue\s*\{/);
});
