import { expect, test } from "@playwright/test";

test("真实 Chrome 编码器可持续生成 1080p 30FPS MP4", async ({ page }) => {
  const durationMs = Number(process.env.MEDIA_STRESS_MS || 5_000);
  test.setTimeout(durationMs + 45_000);
  await page.goto("/");

  const result = await page.evaluate(async (duration) => {
    const candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.42001E,mp4a.40.2",
      "video/mp4;codecs=h264,aac",
      "video/mp4",
    ];
    const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      return { supported: false, mimeType: "", size: 0, chunks: 0, elapsedMs: 0 };
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("2D canvas unavailable");
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 16_000_000,
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve) =>
      recorder.addEventListener("stop", () => resolve(), { once: true }),
    );

    let frame = 0;
    const drawFrame = () => {
      const hue = frame % 360;
      context.fillStyle = `hsl(${hue} 42% 13%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < 72; index += 1) {
        const x = (index * 137 + frame * (3 + (index % 5))) % canvas.width;
        const y = (index * 83 + frame * (2 + (index % 7))) % canvas.height;
        context.fillStyle = `hsla(${(hue + index * 17) % 360} 75% 58% / .7)`;
        context.fillRect(x, y, 90 + (index % 6) * 18, 54 + (index % 4) * 14);
      }
      context.fillStyle = "white";
      context.font = "700 56px sans-serif";
      context.fillText(`镜场真实 MP4 压力帧 ${frame}`, 72, 92);
      frame += 1;
    };
    drawFrame();
    const drawingTimer = window.setInterval(drawFrame, 1000 / 30);
    const startedAt = performance.now();
    recorder.start(1000);
    await new Promise((resolve) => window.setTimeout(resolve, duration));
    recorder.stop();
    await stopped;
    window.clearInterval(drawingTimer);
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: "video/mp4" });
    return {
      supported: true,
      mimeType: recorder.mimeType || mimeType,
      size: blob.size,
      chunks: chunks.length,
      elapsedMs: performance.now() - startedAt,
      tracksEnded: stream.getTracks().every((track) => track.readyState === "ended"),
    };
  }, durationMs);

  expect(result.supported).toBe(true);
  expect(result.mimeType.toLowerCase()).toContain("mp4");
  expect(result.size).toBeGreaterThan(100_000);
  expect(result.chunks).toBeGreaterThan(0);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(durationMs * 0.9);
  expect(result.tracksEnded).toBe(true);
});
