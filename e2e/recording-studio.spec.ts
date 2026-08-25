import { expect, test, type Page } from "@playwright/test";

type MockPatch = {
  displaySurface?: string;
  displaySurfaceQueue?: string[];
  displayFailureQueue?: string[];
  displayAudioQueue?: boolean[];
  mp4Supported?: boolean;
  directoryFailure?: string;
  failCamera?: boolean;
  failMicrophone?: boolean;
  cameraFailureName?: string;
  microphoneFailureName?: string;
  displayDelayMs?: number;
  directoryDelayMs?: number;
  countdownDelayMs?: number;
  recordingTimerIntervalMs?: number;
  directoryWriteFailure?: string;
  directoryPermission?: PermissionState;
  directoryRequestPermission?: PermissionState;
  directoryName?: string;
  grantDirectoryOnPicker?: boolean;
  displayDimensionsQueue?: Array<{ width: number; height: number }>;
};

const patchMockState = async (page: Page, patch: MockPatch) => {
  await page.evaluate((next) => {
    Object.assign(
      (window as typeof window & { __JINGCHANG_E2E__: Record<string, unknown> })
        .__JINGCHANG_E2E__,
      next,
    );
  }, patch);
};

const getMockSummary = async (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as typeof window & {
        __JINGCHANG_E2E__: {
          cameraCalls: number;
          microphoneCalls: number;
          displayCalls: number;
          directoryPickerCalls: number;
          mediaRecorderStarts: number;
          mediaRecorderStops: number;
          focusBehaviors: string[];
          recorderInputs: Array<Record<string, unknown>>;
          cameraTracks: MediaStreamTrack[];
          microphoneTracks: MediaStreamTrack[];
          displayTracks: MediaStreamTrack[];
          displayAudioTracks: MediaStreamTrack[];
          audioSourceTrackIds: string[];
          disconnectedAudioSourceTrackIds: string[];
          recorderStreams: MediaStream[];
          directoryPermission: PermissionState;
          directoryName: string;
          displaySources: Array<{
            surface: string;
            label: string;
            width: number;
            height: number;
            hasAudio: boolean;
            track: MediaStreamTrack;
          }>;
        };
      }
    ).__JINGCHANG_E2E__;
    return {
      cameraCalls: state.cameraCalls,
      microphoneCalls: state.microphoneCalls,
      displayCalls: state.displayCalls,
      directoryPickerCalls: state.directoryPickerCalls,
      mediaRecorderStarts: state.mediaRecorderStarts,
      mediaRecorderStops: state.mediaRecorderStops,
      focusBehaviors: [...state.focusBehaviors],
      recorderInputs: state.recorderInputs.map((input) => ({ ...input })),
      cameraTracks: state.cameraTracks.map((track) => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      })),
      microphoneTracks: state.microphoneTracks.map((track) => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      })),
      displayTracks: state.displayTracks.map((track) => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      })),
      displayAudioTracks: state.displayAudioTracks.map((track) => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      })),
      audioSourceTrackIds: [...state.audioSourceTrackIds],
      disconnectedAudioSourceTrackIds: [...state.disconnectedAudioSourceTrackIds],
      recorderStreams: state.recorderStreams.map((stream) =>
        stream.getTracks().map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
        })),
      ),
      directoryPermission: state.directoryPermission,
      directoryName: state.directoryName,
      displaySources: state.displaySources.map((source) => ({
        surface: source.surface,
        label: source.label,
        width: source.width,
        height: source.height,
        hasAudio: source.hasAudio,
        readyState: source.track.readyState,
      })),
    };
  });

const expectVideoReady = async (page: Page, testId: "camera-preview" | "screen-preview") => {
  const preview = page.getByTestId(testId);
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => ({
        hasStream: video.srcObject instanceof MediaStream,
        width: video.videoWidth,
        readyState: video.readyState,
      })),
    )
    .toMatchObject({ hasStream: true, readyState: 4 });
  expect(await preview.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
};

const chooseScreen = async (page: Page) => {
  await page.getByRole("button", { name: /步骤 2 (选择|重新选择)屏幕/ }).click();
  await expectVideoReady(page, "screen-preview");
};

const startRecording = async (page: Page) => {
  await page.getByRole("button", { name: "步骤 3 开始录制" }).click();
  await expect(page.getByRole("button", { name: /停止录制/ })).toBeVisible();
};

const stopRecording = async (page: Page) => {
  await page.getByRole("button", { name: /停止录制/ }).click();
  await expect(page.getByRole("button", { name: "步骤 3 开始录制" })).toBeVisible();
};

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    const state = {
      cameraCalls: 0,
      microphoneCalls: 0,
      displayCalls: 0,
      directoryPickerCalls: 0,
      mediaRecorderStarts: 0,
      mediaRecorderStops: 0,
      displaySurface: "window",
      displaySurfaceQueue: [] as string[],
      displayFailureQueue: [] as string[],
      displayAudioQueue: [] as boolean[],
      sourceSequence: 0,
      focusBehaviors: [] as string[],
      recorderInputs: [] as Array<{
        videoTracks: number;
        audioTracks: number;
        mimeType: string;
        videoBitsPerSecond?: number;
        audioBitsPerSecond?: number;
      }>,
      mp4Supported: true,
      directoryFailure: "",
      failCamera: false,
      failMicrophone: false,
      cameraFailureName: "NotAllowedError",
      microphoneFailureName: "NotFoundError",
      displayDelayMs: 0,
      directoryDelayMs: 0,
      countdownDelayMs: 20,
      recordingTimerIntervalMs: 1000,
      directoryWriteFailure: "",
      directoryPermission: "granted" as PermissionState,
      directoryRequestPermission: "granted" as PermissionState,
      directoryName: "镜场端到端测试",
      grantDirectoryOnPicker: false,
      displayDimensionsQueue: [] as Array<{ width: number; height: number }>,
      cameraTracks: [] as MediaStreamTrack[],
      microphoneTracks: [] as MediaStreamTrack[],
      displayTracks: [] as MediaStreamTrack[],
      displayAudioTracks: [] as MediaStreamTrack[],
      audioSourceTrackIds: [] as string[],
      disconnectedAudioSourceTrackIds: [] as string[],
      recorderStreams: [] as MediaStream[],
      displaySources: [] as Array<{
        surface: string;
        label: string;
        width: number;
        height: number;
        hasAudio: boolean;
        track: MediaStreamTrack;
      }>,
    };

    Object.defineProperty(window, "__JINGCHANG_E2E__", {
      configurable: true,
      value: state,
    });

    const drawVideoStream = (
      kind: "camera" | "screen",
      width: number,
      height: number,
      label = kind,
      displaySurface = state.displaySurface,
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        if (!context) return;
        context.fillStyle = kind === "camera" ? "#6eb98b" : "#24333d";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#fff";
        context.font = `${Math.max(24, Math.round(width / 24))}px sans-serif`;
        context.fillText(
          kind === "camera" ? `测试摄像头 ${frame}` : `${label} ${frame}`,
          width * 0.08,
          height * 0.18,
        );
        frame += 1;
        requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      Object.defineProperty(track, "getSettings", {
        configurable: true,
        value: () => ({
          width,
          height,
          frameRate: 30,
          displaySurface: kind === "screen" ? displaySurface : undefined,
        }),
      });
      return stream;
    };

    const createAudioStream = () => {
      const AudioContextClass = window.AudioContext;
      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      gain.gain.value = 0.001;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      return destination.stream;
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          if (constraints.video) {
            state.cameraCalls += 1;
            if (state.failCamera) {
              throw new DOMException("camera unavailable", state.cameraFailureName);
            }
            const stream = drawVideoStream("camera", 1280, 720);
            state.cameraTracks.push(...stream.getVideoTracks());
            return stream;
          }

          state.microphoneCalls += 1;
          if (state.failMicrophone) {
            throw new DOMException("microphone unavailable", state.microphoneFailureName);
          }
          const stream = createAudioStream();
          state.microphoneTracks.push(...stream.getAudioTracks());
          return stream;
        },
        getDisplayMedia: async () => {
          state.displayCalls += 1;
          if (state.displayDelayMs) {
            await new Promise((resolve) => window.setTimeout(resolve, state.displayDelayMs));
          }
          const failure = state.displayFailureQueue.shift();
          if (failure === "abort") {
            throw new DOMException("selection cancelled", "AbortError");
          }
          if (failure === "deny") {
            throw new DOMException("screen permission denied", "NotAllowedError");
          }
          if (failure === "notfound") {
            throw new DOMException("screen source missing", "NotFoundError");
          }

          const surface = state.displaySurfaceQueue.shift() || state.displaySurface;
          const hasAudio = state.displayAudioQueue.shift() ?? true;
          const dimensions =
            state.displayDimensionsQueue.shift() ||
            (surface === "browser"
              ? { width: 1365, height: 768 }
              : surface === "monitor"
                ? { width: 1920, height: 1080 }
                : { width: 1440, height: 900 });
          state.sourceSequence += 1;
          const label = `${surface === "browser" ? "浏览器标签页" : surface === "monitor" ? "整个屏幕" : "应用窗口"} ${state.sourceSequence}`;
          const stream = drawVideoStream(
            "screen",
            dimensions.width,
            dimensions.height,
            label,
            surface,
          );
          if (hasAudio) {
            const audioStream = createAudioStream();
            audioStream.getAudioTracks().forEach((track) => {
              stream.addTrack(track);
              state.displayAudioTracks.push(track);
            });
          }
          state.displayTracks.push(...stream.getVideoTracks());
          state.displaySources.push({
            surface,
            label,
            ...dimensions,
            hasAudio,
            track: stream.getVideoTracks()[0],
          });
          return stream;
        },
      },
    });

    const nativeCreateMediaStreamSource =
      AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream: MediaStream) {
      const trackId = stream.getAudioTracks()[0]?.id;
      if (trackId) state.audioSourceTrackIds.push(trackId);
      const source = nativeCreateMediaStreamSource.call(this, stream);
      const nativeDisconnect = source.disconnect.bind(source);
      source.disconnect = ((...args: Parameters<AudioNode["disconnect"]>) => {
        if (trackId) state.disconnectedAudioSourceTrackIds.push(trackId);
        return nativeDisconnect(...args);
      }) as AudioNode["disconnect"];
      return source;
    };

    class MockMediaRecorder extends EventTarget {
      static isTypeSupported(type: string) {
        return state.mp4Supported && type.toLowerCase().includes("mp4");
      }

      state: RecordingState = "inactive";
      readonly mimeType: string;

      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        state.recorderStreams.push(stream);
        this.mimeType = options?.mimeType || "video/mp4";
        state.recorderInputs.push({
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length,
          mimeType: this.mimeType,
          videoBitsPerSecond: options?.videoBitsPerSecond,
          audioBitsPerSecond: options?.audioBitsPerSecond,
        });
      }

      start() {
        this.state = "recording";
        state.mediaRecorderStarts += 1;
      }

      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        state.mediaRecorderStops += 1;
        queueMicrotask(() => {
          const data = new Blob(["mock-mp4-video"], { type: "video/mp4" });
          const dataEvent = new Event("dataavailable") as Event & { data: Blob };
          Object.defineProperty(dataEvent, "data", { value: data });
          this.dispatchEvent(dataEvent);
          this.dispatchEvent(new Event("stop"));
        });
      }

      pause() {
        this.state = "paused";
      }

      resume() {
        this.state = "recording";
      }

      requestData() {}
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: MockMediaRecorder,
    });

    class MockCaptureController {
      focusBehavior = "";

      setFocusBehavior(behavior: string) {
        this.focusBehavior = behavior;
        state.focusBehaviors.push(behavior);
      }
    }

    Object.defineProperty(window, "CaptureController", {
      configurable: true,
      value: MockCaptureController,
    });

    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        state.directoryPickerCalls += 1;
        if (state.directoryDelayMs) {
          await new Promise((resolve) => window.setTimeout(resolve, state.directoryDelayMs));
        }
        if (state.directoryFailure === "abort") {
          throw new DOMException("folder selection cancelled", "AbortError");
        }
        if (state.grantDirectoryOnPicker) {
          state.directoryPermission = "granted";
        }
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(state.directoryName, { create: true });
      },
    });

    const directoryPrototype = (
      window as typeof window & {
        FileSystemDirectoryHandle?: { prototype: Record<string, unknown> };
      }
    ).FileSystemDirectoryHandle?.prototype;
    if (directoryPrototype) {
      Object.defineProperty(directoryPrototype, "queryPermission", {
        configurable: true,
        value: async () => state.directoryPermission,
      });
      Object.defineProperty(directoryPrototype, "requestPermission", {
        configurable: true,
        value: async () => state.directoryRequestPermission,
      });
    }

    const filePrototype = (
      window as typeof window & {
        FileSystemFileHandle?: { prototype: { createWritable?: (...args: unknown[]) => Promise<unknown> } };
      }
    ).FileSystemFileHandle?.prototype;
    const nativeCreateWritable = filePrototype?.createWritable;
    if (filePrototype && nativeCreateWritable) {
      filePrototype.createWritable = async function (...args: unknown[]) {
        if (state.directoryWriteFailure === "quota") {
          throw new DOMException("disk full", "QuotaExceededError");
        }
        if (state.directoryWriteFailure === "denied") {
          throw new DOMException("write permission revoked", "NotAllowedError");
        }
        return nativeCreateWritable.apply(this, args);
      };
    }

    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(
        handler,
        timeout === 700 ? state.countdownDelayMs : timeout,
        ...args,
      )) as typeof window.setTimeout;
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetInterval(
        handler,
        timeout === 1000 ? state.recordingTimerIntervalMs : timeout,
        ...args,
      )) as typeof window.setInterval;
  });

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
});

test("首屏核心控制完整可见且没有重复状态行", async ({ page }) => {
  await expect(page.getByRole("region", { name: "录制画面" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(2);
  await expect(page.locator(".device-state")).toHaveCount(0);
  await expect(page.locator(".recording-readiness")).toHaveCount(0);
  await expect(page.locator(".status-line")).toHaveCount(0);

  const recordButton = page.getByRole("button", { name: "步骤 3 开始录制" });
  await expect(recordButton).toBeVisible();
  const box = await recordButton.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(900);
});

test("摄像头关闭后可由开关和步骤按钮重新恢复画面", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  const preview = page.getByTestId("camera-preview");
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => ({
        hasStream: video.srcObject instanceof MediaStream,
        width: video.videoWidth,
        readyState: video.readyState,
      })),
    )
    .toMatchObject({ hasStream: true, width: 1280, readyState: 4 });

  await page.getByRole("switch", { name: "关闭摄像头" }).click();
  await expect(page.getByRole("switch", { name: "开启摄像头" })).not.toBeChecked();
  await expect(page.getByTestId("camera-preview")).toHaveCount(0);

  await page.getByRole("switch", { name: "开启摄像头" }).click();
  await expect(page.getByRole("switch", { name: "关闭摄像头" })).toBeChecked();
  await expect(page.getByTestId("camera-preview")).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId("camera-preview").evaluate(
        (video: HTMLVideoElement) =>
          video.srcObject instanceof MediaStream && video.videoWidth > 0,
      ),
    )
    .toBe(true);

  await page.getByRole("switch", { name: "关闭摄像头" }).click();
  await page.getByTestId("open-camera").click();
  await expect(page.getByRole("switch", { name: "关闭摄像头" })).toBeChecked();
  await expect
    .poll(() =>
      page.getByTestId("camera-preview").evaluate(
        (video: HTMLVideoElement) =>
          video.srcObject instanceof MediaStream && video.videoWidth > 0,
      ),
    )
    .toBe(true);
});

test("麦克风开关会真实启停音轨", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  await page.getByRole("switch", { name: "静音麦克风" }).click();
  await expect(page.getByRole("switch", { name: "开启麦克风" })).not.toBeChecked();
  expect(
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __JINGCHANG_E2E__: { microphoneTracks: MediaStreamTrack[] };
      }).__JINGCHANG_E2E__;
      return state.microphoneTracks.at(-1)?.enabled;
    }),
  ).toBe(false);

  await page.getByRole("switch", { name: "开启麦克风" }).click();
  await expect(page.getByRole("switch", { name: "静音麦克风" })).toBeChecked();
  expect(
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __JINGCHANG_E2E__: { microphoneTracks: MediaStreamTrack[] };
      }).__JINGCHANG_E2E__;
      return state.microphoneTracks.at(-1)?.enabled;
    }),
  ).toBe(true);
});

test("录屏重选、模式切换和标准画幅保持一致", async ({ page }) => {
  await page.getByRole("button", { name: "步骤 2 选择屏幕" }).click();
  await expect(page.getByTestId("screen-preview")).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId("screen-preview").evaluate(
        (video: HTMLVideoElement) =>
          video.srcObject instanceof MediaStream && video.videoWidth > 0,
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "4:3", exact: true }).click();
  await expect(page.getByTestId("preview-stage")).toHaveAttribute("data-aspect", "4:3");
  await expect(page.getByText("MP4 · 4:3 · 1440 × 1080 · 30 FPS")).toBeVisible();

  await page.getByRole("button", { name: "录屏", exact: true }).click();
  await expect(page.getByRole("button", { name: "录屏", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("仅监看 · 不入成片")).toBeVisible();

  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await expect(page.getByRole("button", { name: "摄像头", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();
  await expect(page.getByRole("button", { name: "录屏 + 人像", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "步骤 2 重新选择屏幕" }).click();
  expect(
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __JINGCHANG_E2E__: { displayCalls: number; displayTracks: MediaStreamTrack[] };
      }).__JINGCHANG_E2E__;
      return {
        calls: state.displayCalls,
        firstTrackEnded: state.displayTracks[0]?.readyState === "ended",
      };
    }),
  ).toEqual({ calls: 2, firstTrackEnded: true });
});

test("裁剪区域可以框选并恢复完整画面", async ({ page }) => {
  await page.getByRole("button", { name: "步骤 2 选择屏幕" }).click();
  await expect
    .poll(() =>
      page.getByTestId("screen-preview").evaluate(
        (video: HTMLVideoElement) => video.videoWidth,
      ),
    )
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "裁剪画面" }).click();
  const overlay = page.getByTestId("crop-selection-overlay");
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, {
    steps: 5,
  });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "重新框选" })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复完整" })).toBeVisible();
  await expect(page.locator(".crop-region")).toContainText("成片范围");
  await page.getByRole("button", { name: "恢复完整" }).click();
  await expect(page.getByTestId("crop-selection-overlay")).toHaveCount(0);
});

test("提词器编辑、字号、滚动和悬浮窗口可用", async ({ context, page }) => {
  const script = page.getByRole("textbox", { name: "可编辑的提词脚本" });
  const longScript = Array.from(
    { length: 40 },
    (_, index) => `第 ${index + 1} 句测试脚本，继续演示录制工作台。`,
  ).join("\n");
  await script.click();
  await script.press("ControlOrMeta+A");
  await script.press("Backspace");
  await script.type(longScript);
  await expect(script).toHaveValue(longScript);
  await script.evaluate((element: HTMLTextAreaElement) => {
    element.scrollTop = 0;
  });

  await page.getByLabel("字号").fill("30");
  await expect(page.getByLabel("字号")).toHaveValue("30");
  await expect(script).toHaveCSS("font-size", "30px");

  const autoScroll = page.getByRole("button", { name: "AUTO SCROLL 开启自动滚动" });
  await autoScroll.click();
  await expect(
    page.getByRole("button", { name: "AUTO SCROLL 暂停自动滚动" }),
  ).toHaveAttribute("aria-pressed", "true");

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "ALWAYS ON TOP 悬浮提词器" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveTitle("镜场 · 悬浮提词器");
  await expect(popup.getByText("第 1 句测试脚本，继续演示录制工作台。")).toBeVisible();
  await popup.close();
});

test("录制、录制中切换模式、保存 MP4 和录制库形成闭环", async ({ page }) => {
  await page.getByRole("button", { name: "步骤 3 开始录制" }).click();
  await expect(page.getByRole("button", { name: /停止录制/ })).toBeVisible();

  await page.getByRole("button", { name: "录屏", exact: true }).click();
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();

  await page.getByRole("button", { name: /停止录制/ }).click();
  await expect(page.getByRole("button", { name: "LIBRARY 录制库" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("镜场端到端测试", { exact: true })).toBeVisible();
  await expect(page.getByText("1 条本机录制")).toBeVisible();
  await expect(page.locator(".recording-card")).toHaveCount(1);
  await expect(page.locator(".recording-card strong")).toContainText(".mp4");

  expect(
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __JINGCHANG_E2E__: {
          mediaRecorderStarts: number;
          mediaRecorderStops: number;
        };
      }).__JINGCHANG_E2E__;
      return {
        starts: state.mediaRecorderStarts,
        stops: state.mediaRecorderStops,
      };
    }),
  ).toEqual({ starts: 1, stops: 1 });
});

test("拒绝整屏录制和摄像头权限失败会给出明确错误", async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { displaySurface: string };
    }).__JINGCHANG_E2E__;
    state.displaySurface = "monitor";
  });
  await page.getByRole("button", { name: "步骤 2 选择屏幕" }).click();
  await expect(page.locator(".visually-hidden")).toContainText(
    "请选择单个窗口或标签页",
  );

  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { failCamera: boolean };
    }).__JINGCHANG_E2E__;
    state.failCamera = true;
  });
  await page.getByTestId("open-camera").click();
  await expect(page.locator(".visually-hidden")).toContainText("权限没有开启");
});

test("选择应用窗口后保持当前页面且预览使用窗口分辨率", async ({ page }) => {
  await patchMockState(page, { displaySurfaceQueue: ["window"] });
  await chooseScreen(page);

  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1440);
  const state = await getMockSummary(page);
  expect(state.displaySources).toEqual([
    expect.objectContaining({ surface: "window", width: 1440, height: 900 }),
  ]);
  expect(state.focusBehaviors).toEqual(["no-focus-change"]);
});

test("选择浏览器标签页后正常显示标签页画面", async ({ page }) => {
  await patchMockState(page, { displaySurfaceQueue: ["browser"] });
  await chooseScreen(page);

  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1365);
  expect((await getMockSummary(page)).displaySources[0]).toEqual(
    expect.objectContaining({ surface: "browser", width: 1365, height: 768 }),
  );
});

test("可以从应用窗口重新切换到浏览器标签页", async ({ page }) => {
  await patchMockState(page, { displaySurfaceQueue: ["window", "browser"] });
  await chooseScreen(page);
  await chooseScreen(page);

  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1365);
  const state = await getMockSummary(page);
  expect(state.displayCalls).toBe(2);
  expect(state.displaySources.map((source) => source.surface)).toEqual(["window", "browser"]);
  expect(state.displaySources[0].readyState).toBe("ended");
  expect(state.displaySources[1].readyState).toBe("live");
});

test("首次取消分享选择不会留下假就绪状态", async ({ page }) => {
  await patchMockState(page, { displayFailureQueue: ["abort"] });
  await page.getByRole("button", { name: "步骤 2 选择屏幕" }).click();

  await expect(page.getByRole("button", { name: "步骤 2 选择屏幕" })).toBeVisible();
  await expect(page.getByText("选择你要演示的屏幕")).toBeVisible();
  await expect(page.locator(".visually-hidden")).toContainText("没有选择共享画面");
});

test("重新选择时取消会保留原来的分享窗口", async ({ page }) => {
  await chooseScreen(page);
  await patchMockState(page, { displayFailureQueue: ["abort"] });
  await page.getByRole("button", { name: "步骤 2 重新选择屏幕" }).click();

  await expectVideoReady(page, "screen-preview");
  await expect(page.locator(".visually-hidden")).toContainText("已保留原共享画面");
  const state = await getMockSummary(page);
  expect(state.displayCalls).toBe(2);
  expect(state.displaySources).toHaveLength(1);
  expect(state.displaySources[0].readyState).toBe("live");
});

test("重新选择整个屏幕会拒绝新来源并保留原窗口", async ({ page }) => {
  await patchMockState(page, { displaySurfaceQueue: ["window", "monitor"] });
  await chooseScreen(page);
  await page.getByRole("button", { name: "步骤 2 重新选择屏幕" }).click();

  await expect(page.locator(".visually-hidden")).toContainText("不要选择整个屏幕");
  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1440);
  const state = await getMockSummary(page);
  expect(state.displaySources[0].readyState).toBe("live");
  expect(state.displaySources[1]).toEqual(
    expect.objectContaining({ surface: "monitor", readyState: "ended" }),
  );
});

test("屏幕分享被系统停止后会回到待选择状态", async ({ page }) => {
  await chooseScreen(page);
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { displayTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.displayTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByText("选择你要演示的屏幕")).toBeVisible();
  await expect(page.getByRole("button", { name: "步骤 2 选择屏幕" })).toBeVisible();
  await expect(page.locator(".visually-hidden")).toContainText("屏幕共享已结束");
});

test("录制中停止系统分享会自动结束并保存 MP4", async ({ page }) => {
  await chooseScreen(page);
  await startRecording(page);
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { displayTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.displayTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByRole("button", { name: "LIBRARY 录制库" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".recording-card")).toHaveCount(1);
  const state = await getMockSummary(page);
  expect({ starts: state.mediaRecorderStarts, stops: state.mediaRecorderStops }).toEqual({
    starts: 1,
    stops: 1,
  });
});

test("摄像头被系统断开后可以重新申请并恢复", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { cameraTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.cameraTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByTestId("camera-preview")).toHaveCount(0);

  await page.getByTestId("open-camera").click();
  await expectVideoReady(page, "camera-preview");
  expect((await getMockSummary(page)).cameraCalls).toBe(2);
});

test("反复关闭开启摄像头复用同一设备流且始终恢复画面", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("switch", { name: "关闭摄像头" }).click();
    await expect(page.getByTestId("camera-preview")).toHaveCount(0);
    await page.getByRole("switch", { name: "开启摄像头" }).click();
    await expectVideoReady(page, "camera-preview");
  }

  const state = await getMockSummary(page);
  expect(state.cameraCalls).toBe(1);
  expect(state.cameraTracks[0]).toEqual(
    expect.objectContaining({ enabled: true, readyState: "live" }),
  );
});

test("反复静音和恢复麦克风不会重复申请权限", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("switch", { name: "静音麦克风" }).click();
    await page.getByRole("switch", { name: "开启麦克风" }).click();
  }

  const state = await getMockSummary(page);
  expect(state.microphoneCalls).toBe(1);
  expect(state.microphoneTracks[0]).toEqual(
    expect.objectContaining({ enabled: true, readyState: "live" }),
  );
});

test("纯摄像头模式录制不会申请屏幕分享", async ({ page }) => {
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await startRecording(page);
  await stopRecording(page);

  const state = await getMockSummary(page);
  expect(state.displayCalls).toBe(0);
  expect(state.cameraCalls).toBe(1);
  expect(state.recorderInputs[0]).toEqual(
    expect.objectContaining({ videoTracks: 1, mimeType: expect.stringContaining("mp4") }),
  );
});

test("纯录屏模式在无系统声音且麦克风关闭时仍可录制", async ({ page }) => {
  await patchMockState(page, {
    displaySurfaceQueue: ["browser"],
    displayAudioQueue: [false],
  });
  await page.getByRole("switch", { name: "静音麦克风" }).click();
  await page.getByRole("button", { name: "录屏", exact: true }).click();
  await startRecording(page);
  await stopRecording(page);

  const state = await getMockSummary(page);
  expect(state.displaySources[0]).toEqual(expect.objectContaining({ surface: "browser", hasAudio: false }));
  expect(state.recorderInputs[0]).toEqual(expect.objectContaining({ videoTracks: 1, audioTracks: 0 }));
});

test("录屏加人像模式会准备摄像头、屏幕和混合音频", async ({ page }) => {
  await startRecording(page);
  await expectVideoReady(page, "screen-preview");
  await expectVideoReady(page, "camera-preview");
  await stopRecording(page);

  const state = await getMockSummary(page);
  expect({ camera: state.cameraCalls, screen: state.displayCalls, mic: state.microphoneCalls }).toEqual({
    camera: 1,
    screen: 1,
    mic: 1,
  });
  expect(state.recorderInputs[0]).toEqual(expect.objectContaining({ videoTracks: 1, audioTracks: 1 }));
});

test("录制中连续切换摄像头、录屏和录屏加人像不会重启录制器", async ({ page }) => {
  await startRecording(page);
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  expect((await getMockSummary(page)).displayAudioTracks[0].enabled).toBe(false);
  await page.getByRole("button", { name: "录屏", exact: true }).click();
  expect((await getMockSummary(page)).displayAudioTracks[0].enabled).toBe(true);
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();

  expect((await getMockSummary(page)).mediaRecorderStarts).toBe(1);
  await stopRecording(page);
  expect((await getMockSummary(page)).mediaRecorderStops).toBe(1);
});

test("录制中可以关闭再开启摄像头和麦克风", async ({ page }) => {
  await startRecording(page);
  await page.getByRole("switch", { name: "关闭摄像头" }).click();
  await page.getByRole("switch", { name: "静音麦克风" }).click();
  let state = await getMockSummary(page);
  expect(state.cameraTracks[0].enabled).toBe(false);
  expect(state.microphoneTracks[0].enabled).toBe(false);

  await page.getByRole("switch", { name: "开启摄像头" }).click();
  await page.getByRole("switch", { name: "开启麦克风" }).click();
  await expectVideoReady(page, "camera-preview");
  state = await getMockSummary(page);
  expect(state.cameraTracks[0].enabled).toBe(true);
  expect(state.microphoneTracks[0].enabled).toBe(true);
  await stopRecording(page);
});

test("录制中可以从应用窗口重新分享到浏览器标签页", async ({ page }) => {
  await patchMockState(page, { displaySurfaceQueue: ["window", "browser"] });
  await chooseScreen(page);
  await startRecording(page);
  await expect(page.getByRole("button", { name: "步骤 2 重新选择屏幕" })).toBeEnabled();
  await chooseScreen(page);

  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1365);
  const state = await getMockSummary(page);
  expect(state.mediaRecorderStarts).toBe(1);
  expect(state.displaySources[0].readyState).toBe("ended");
  expect(state.displaySources[1].readyState).toBe("live");
  expect(state.displayAudioTracks[1]).toEqual(
    expect.objectContaining({ enabled: true, readyState: "live" }),
  );
  await stopRecording(page);
});

test("录制中框选裁剪和恢复完整画面不会中断录制", async ({ page }) => {
  await chooseScreen(page);
  await startRecording(page);
  await page.getByRole("button", { name: "裁剪画面" }).click();
  const overlay = page.getByTestId("crop-selection-overlay");
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + 80, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 100, box.y + box.height - 80, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".crop-region")).toContainText("成片范围");
  expect((await getMockSummary(page)).mediaRecorderStarts).toBe(1);
  await page.getByRole("button", { name: "恢复完整" }).click();
  await expect(page.getByTestId("crop-selection-overlay")).toHaveCount(0);
  await stopRecording(page);
});

test("录制中画幅被锁定但录制模式仍可切换", async ({ page }) => {
  await startRecording(page);
  await expect(page.getByRole("button", { name: "4:3", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "摄像头", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await expect(page.getByTestId("preview-stage")).toHaveAttribute("data-aspect", "16:9");
  await stopRecording(page);
});

test("录制时锁定脚本编辑，停止后恢复编辑", async ({ page }) => {
  const script = page.getByRole("textbox", { name: "可编辑的提词脚本" });
  await startRecording(page);
  await expect(script).toBeDisabled();
  await stopRecording(page);
  await page.getByRole("button", { name: "SCRIPT 提词器" }).click();
  await expect(script).toBeEnabled();
});

test("悬浮提词器可以调字号、滚动、暂停并主动关闭", async ({ context, page }) => {
  const script = page.getByRole("textbox", { name: "可编辑的提词脚本" });
  const longScript = Array.from({ length: 60 }, (_, index) => `悬浮提词器第 ${index + 1} 行`).join("\n");
  await script.click();
  await script.press("ControlOrMeta+A");
  await script.press("Backspace");
  await script.type(longScript);
  await expect(script).toHaveValue(longScript);
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "ALWAYS ON TOP 悬浮提词器" }).click();
  const popup = await popupPromise;
  const popupScript = popup.getByRole("region", { name: "提词内容" });
  await expect(popupScript).toContainText("悬浮提词器第 60 行");

  await popup.getByRole("button", { name: "A＋" }).click();
  await expect(popupScript).toHaveCSS("font-size", "32px");
  await popup.getByRole("button", { name: "A−" }).click();
  await expect(popupScript).toHaveCSS("font-size", "30px");
  await popup.getByRole("button", { name: "快一点" }).click();
  await popup.getByRole("button", { name: "慢一点" }).click();
  await popup.getByRole("button", { name: "开始滚动" }).click();
  await expect(popup.getByRole("button", { name: "暂停滚动" })).toBeVisible();
  await expect.poll(() => popupScript.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await popup.getByRole("button", { name: "暂停滚动" }).click();
  await expect(popup.getByRole("button", { name: "开始滚动" })).toBeVisible();
  await popup.getByRole("button", { name: "关闭" }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test("人像画中画可拖动且切换模式后保留位置", async ({ page }) => {
  await page.getByTestId("open-camera").click();
  await chooseScreen(page);
  const pip = page.getByRole("group", { name: "可拖动的人像画中画" });
  const before = await pip.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 140, before.y + before.height / 2 - 80, {
    steps: 5,
  });
  await page.mouse.up();
  const moved = await pip.boundingBox();
  expect(moved?.x).toBeGreaterThan(before.x + 80);

  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await expect(pip).toHaveCount(0);
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();
  const restored = await pip.boundingBox();
  expect(restored?.x).toBeGreaterThan(before.x + 80);
});

test("浏览器不支持 MP4 时不会创建伪 MP4 录制", async ({ page }) => {
  await patchMockState(page, { mp4Supported: false });
  await page.getByRole("button", { name: "步骤 3 开始录制" }).click();

  await expect(page.locator(".visually-hidden")).toContainText("不能直接生成 MP4");
  const state = await getMockSummary(page);
  expect(state.mediaRecorderStarts).toBe(0);
  expect(state.directoryPickerCalls).toBe(0);
});

test("取消保存文件夹时录制不会误启动", async ({ page }) => {
  await patchMockState(page, { directoryFailure: "abort" });
  await page.getByRole("button", { name: "步骤 3 开始录制" }).click();

  await expect(page.locator(".visually-hidden")).toContainText("未选择保存文件夹");
  const state = await getMockSummary(page);
  expect(state.directoryPickerCalls).toBe(1);
  expect(state.mediaRecorderStarts).toBe(0);
});

test("连续完成两次录制会在录制库保留两条不同 MP4", async ({ page }) => {
  await startRecording(page);
  await stopRecording(page);
  await startRecording(page);
  await stopRecording(page);

  await expect(page.locator(".recording-card")).toHaveCount(2);
  await expect(page.getByText("2 条本机录制")).toBeVisible();
  const names = await page.locator(".recording-card strong").allTextContents();
  expect(new Set(names).size).toBe(2);
  const state = await getMockSummary(page);
  expect({ starts: state.mediaRecorderStarts, stops: state.mediaRecorderStops }).toEqual({
    starts: 2,
    stops: 2,
  });
});

test("切换到录屏时若误选整个屏幕会回滚原录制模式", async ({ page }) => {
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await patchMockState(page, { displaySurfaceQueue: ["monitor"] });
  await page.getByRole("button", { name: "录屏", exact: true }).click();

  await expect(page.getByRole("button", { name: "摄像头", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".visually-hidden")).toContainText("不要选择整个屏幕");
});

test("摄像头或麦克风设备不存在时显示明确错误并保持关闭", async ({ page }) => {
  await page.getByRole("switch", { name: "静音麦克风" }).click();
  await patchMockState(page, { failCamera: true });
  await page.getByTestId("open-camera").click();
  await expect(page.locator(".visually-hidden")).toContainText("权限没有开启");

  await patchMockState(page, { failCamera: false, failMicrophone: true });
  await page.getByRole("switch", { name: "开启麦克风" }).click();
  await expect(page.locator(".visually-hidden")).toContainText("没有找到可用设备");
  await expect(page.getByRole("switch", { name: "开启麦克风" })).not.toBeChecked();
});

test("蓝军：同一事件循环重复点击开始录制只允许一个启动流程", async ({ page }) => {
  await patchMockState(page, { directoryDelayMs: 80 });
  await page.getByRole("button", { name: "步骤 3 开始录制" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByRole("button", { name: /停止录制/ })).toBeVisible();
  const state = await getMockSummary(page);
  expect(state.directoryPickerCalls).toBe(1);
  expect(state.displayCalls).toBe(1);
  expect(state.mediaRecorderStarts).toBe(1);
  await stopRecording(page);
});

test("蓝军：重复点击选择屏幕只拉起一次系统分享选择", async ({ page }) => {
  await patchMockState(page, { displayDelayMs: 80 });
  await page.getByRole("button", { name: "步骤 2 选择屏幕" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expectVideoReady(page, "screen-preview");
  expect((await getMockSummary(page)).displayCalls).toBe(1);
});

test("蓝军：快速从摄像头点到录屏再点录屏加人像只请求一个分享源并服从最后选择", async ({ page }) => {
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await patchMockState(page, { displayDelayMs: 80 });
  await page.locator(".mode-tabs").evaluate((tabs) => {
    const buttons = Array.from(tabs.querySelectorAll("button"));
    (buttons.find((button) => button.textContent?.trim() === "录屏") as HTMLButtonElement).click();
    (
      buttons.find((button) => button.textContent?.trim() === "录屏 + 人像") as HTMLButtonElement
    ).click();
  });

  await expectVideoReady(page, "screen-preview");
  await expect(page.getByRole("button", { name: "录屏 + 人像", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await getMockSummary(page)).displayCalls).toBe(1);
});

test("蓝军：录制中摄像头断开后开关同步关闭且单击即可恢复", async ({ page }) => {
  await startRecording(page);
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { cameraTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.cameraTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByRole("switch", { name: "开启摄像头" })).not.toBeChecked();
  await page.getByRole("switch", { name: "开启摄像头" }).click();
  await expectVideoReady(page, "camera-preview");
  expect((await getMockSummary(page)).cameraCalls).toBe(2);
  await stopRecording(page);
});

test("蓝军：录制中麦克风断开后单击恢复并把新音轨重新接入混音器", async ({ page }) => {
  await startRecording(page);
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { microphoneTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.microphoneTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByRole("switch", { name: "开启麦克风" })).not.toBeChecked();
  await page.getByRole("switch", { name: "开启麦克风" }).click();
  await expect
    .poll(async () => {
      const state = await getMockSummary(page);
      const newestMicrophone = state.microphoneTracks.at(-1);
      return {
        calls: state.microphoneCalls,
        connected: Boolean(
          newestMicrophone && state.audioSourceTrackIds.includes(String(newestMicrophone.id)),
        ),
      };
    })
    .toEqual({ calls: 2, connected: true });
  await stopRecording(page);
});

test("蓝军：切到纯摄像头后停止旧屏幕分享不会误停当前录制", async ({ page }) => {
  await startRecording(page);
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { displayTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.displayTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByRole("button", { name: /停止录制/ })).toBeVisible();
  expect((await getMockSummary(page)).mediaRecorderStops).toBe(0);
  await stopRecording(page);
});

test("蓝军：倒计时期间分享被系统停止不会开始一段黑屏录制", async ({ page }) => {
  await chooseScreen(page);
  await patchMockState(page, { countdownDelayMs: 120 });
  await page.getByRole("button", { name: "步骤 3 开始录制" }).click();
  await expect(page.locator(".countdown")).toBeVisible();
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __JINGCHANG_E2E__: { displayTracks: MediaStreamTrack[] };
    }).__JINGCHANG_E2E__;
    const track = state.displayTracks.at(-1);
    track?.stop();
    track?.dispatchEvent(new Event("ended"));
  });

  await expect(page.getByRole("button", { name: "步骤 3 开始录制" })).toBeVisible();
  await expect(page.locator(".visually-hidden")).toContainText("屏幕共享已结束");
  expect((await getMockSummary(page)).mediaRecorderStarts).toBe(0);
});

test("蓝军：录制中反复更换分享源会停止旧轨道并及时断开旧音频节点", async ({ page }) => {
  await patchMockState(page, {
    displaySurfaceQueue: ["window", "browser", "window", "browser", "window"],
  });
  await chooseScreen(page);
  await startRecording(page);
  for (let index = 0; index < 4; index += 1) {
    await chooseScreen(page);
  }

  const state = await getMockSummary(page);
  expect(state.displayTracks.filter((track) => track.readyState === "live")).toHaveLength(1);
  expect(state.displayTracks.filter((track) => track.readyState === "ended")).toHaveLength(4);
  const oldAudioTrackIds = state.displayAudioTracks.slice(0, -1).map((track) => String(track.id));
  expect(state.disconnectedAudioSourceTrackIds).toEqual(expect.arrayContaining(oldAudioTrackIds));
  expect(state.mediaRecorderStarts).toBe(1);
  await stopRecording(page);
});

test("蓝军：文件在保存目录被删除后刷新录制库会同步消失", async ({ page }) => {
  await startRecording(page);
  await stopRecording(page);
  const name = await page.locator(".recording-card strong").textContent();
  expect(name).toBeTruthy();
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("镜场端到端测试");
    await directory.removeEntry(String(fileName));
  }, name);
  await page.getByRole("button", { name: "刷新" }).click();

  await expect(page.locator(".recording-card")).toHaveCount(0);
  await expect(page.getByText("0 条本机录制")).toBeVisible();
});

test("蓝军：悬浮提词器在录制和模式切换期间持续滚动且不被关闭", async ({ context, page }) => {
  const script = page.getByRole("textbox", { name: "可编辑的提词脚本" });
  const longScript = Array.from({ length: 80 }, (_, index) => `蓝军提词第 ${index + 1} 行`).join("\n");
  await script.fill(longScript);
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "ALWAYS ON TOP 悬浮提词器" }).click();
  const popup = await popupPromise;
  const popupScript = popup.getByRole("region", { name: "提词内容" });
  await popup.getByRole("button", { name: "开始滚动" }).click();

  await startRecording(page);
  await page.getByRole("button", { name: "摄像头", exact: true }).click();
  await page.getByRole("button", { name: "录屏 + 人像", exact: true }).click();
  await expect.poll(() => popupScript.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(popup).toHaveTitle("镜场 · 悬浮提词器");
  await stopRecording(page);
  await popup.getByRole("button", { name: "关闭" }).click();
});

test("韧性：录制中刷新会触发离开确认并在返回后提示异常中断", async ({ page }) => {
  await startRecording(page);
  let sawBeforeUnload = false;
  page.once("dialog", async (dialog) => {
    sawBeforeUnload = dialog.type() === "beforeunload";
    await dialog.accept();
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  expect(sawBeforeUnload).toBe(true);
  await expect(page.locator(".visually-hidden")).toContainText(
    "上次录制异常中断，没有生成可用文件",
  );
});

test("韧性：正常停止录制后刷新不会误报异常中断", async ({ page }) => {
  await startRecording(page);
  await stopRecording(page);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator(".visually-hidden")).not.toContainText("上次录制异常中断");
});

test("韧性：切到其他标签页后录制继续计时并可正常停止", async ({ context, page }) => {
  await startRecording(page);
  const otherPage = await context.newPage();
  await otherPage.goto("about:blank");
  await otherPage.bringToFront();
  await otherPage.waitForTimeout(2200);
  await page.bringToFront();

  const seconds = await page.locator(".record-clock time").evaluate((time) => {
    const [hours, minutes, remaining] = (time.textContent || "0:0:0").split(":").map(Number);
    return hours * 3600 + minutes * 60 + remaining;
  });
  expect(seconds).toBeGreaterThanOrEqual(1);
  await stopRecording(page);
  await otherPage.close();
});

test("韧性：第二个页面遇到设备占用时给出明确提示且不影响第一个页面", async ({ context, page }) => {
  await page.getByTestId("open-camera").click();
  await expectVideoReady(page, "camera-preview");
  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await patchMockState(secondPage, {
    failCamera: true,
    cameraFailureName: "NotReadableError",
  });
  await secondPage.getByTestId("open-camera").click();

  await expect(secondPage.locator(".visually-hidden")).toContainText(
    "设备正在被其他页面或应用使用",
  );
  await expectVideoReady(page, "camera-preview");
  await secondPage.close();
});

test("韧性：两个页面同时录制到同一目录不会覆盖文件", async ({ context, page }) => {
  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await Promise.all([startRecording(page), startRecording(secondPage)]);
  await Promise.all([stopRecording(page), stopRecording(secondPage)]);

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.locator(".recording-card")).toHaveCount(2);
  const names = await page.locator(".recording-card strong").allTextContents();
  expect(new Set(names).size).toBe(2);
  await secondPage.close();
});

test("韧性：原目录权限失效后可选择新目录继续录制", async ({ page }) => {
  await startRecording(page);
  await stopRecording(page);
  await patchMockState(page, {
    directoryPermission: "denied",
    directoryRequestPermission: "denied",
    directoryName: "镜场替换目录",
    grantDirectoryOnPicker: true,
  });
  await startRecording(page);
  await stopRecording(page);

  await expect(page.getByText("镜场替换目录", { exact: true })).toBeVisible();
  await expect(page.getByText("1 条本机录制")).toBeVisible();
});

test("韧性：磁盘空间不足时保留真实 MP4 下载副本", async ({ page }) => {
  await patchMockState(page, { directoryWriteFailure: "quota" });
  await startRecording(page);
  await stopRecording(page);

  await expect(page.locator(".visually-hidden")).toContainText("磁盘空间不足");
  const rescue = page.locator(".recording-rescue");
  await expect(rescue).toContainText("尚未写入保存文件夹");
  await expect(rescue.getByRole("link", { name: "下载 MP4 副本" })).toHaveAttribute(
    "download",
    /\.mp4$/,
  );
});

test("韧性：写入中权限被撤销时保留 MP4 下载副本", async ({ page }) => {
  await patchMockState(page, { directoryWriteFailure: "denied" });
  await startRecording(page);
  await stopRecording(page);

  await expect(page.locator(".visually-hidden")).toContainText("写入权限已失效");
  await expect(page.getByRole("link", { name: "下载 MP4 副本" })).toBeVisible();
});

test("韧性：保存目录权限撤销后刷新会清除旧卡片并要求重新授权", async ({ page }) => {
  await startRecording(page);
  await stopRecording(page);
  await expect(page.locator(".recording-card")).toHaveCount(1);
  await patchMockState(page, { directoryPermission: "denied" });
  await page.getByRole("button", { name: "刷新" }).click();

  await expect(page.locator(".recording-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新授权文件夹" })).toBeVisible();
});

test("韧性：窗口尺寸和缩放变化后核心控制与裁剪仍可操作", async ({ page }) => {
  await chooseScreen(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("button", { name: "步骤 3 开始录制" })).toBeVisible();
  await page.getByRole("button", { name: "裁剪画面" }).click();
  const overlay = page.getByTestId("crop-selection-overlay");
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 50, box.y + box.height - 40, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "恢复完整" }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByRole("button", { name: "步骤 3 开始录制" })).toBeVisible();
});

test("韧性：分享窗口从普通分辨率切换到 4K 后预览与裁剪同步更新", async ({ page }) => {
  await patchMockState(page, {
    displaySurfaceQueue: ["window", "window"],
    displayDimensionsQueue: [
      { width: 1440, height: 900 },
      { width: 3840, height: 2160 },
    ],
  });
  await chooseScreen(page);
  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 1440);
  await chooseScreen(page);
  await expect(page.getByTestId("screen-preview")).toHaveJSProperty("videoWidth", 3840);
  await page.getByRole("button", { name: "裁剪画面" }).click();
  await expect(page.getByTestId("crop-selection-overlay")).toBeVisible();
});

test("韧性：页面冻结再恢复后录制状态保持可控", async ({ context, page }) => {
  await startRecording(page);
  const session = await context.newCDPSession(page);
  await session.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await session.send("Page.setWebLifecycleState", { state: "active" });

  await expect(page.getByRole("button", { name: /停止录制/ })).toBeVisible();
  expect((await getMockSummary(page)).mediaRecorderStarts).toBe(1);
  await stopRecording(page);
  await session.detach();
});

test("韧性：加速模拟一小时录制时钟后仍可停止并保存", async ({ page }) => {
  test.setTimeout(40_000);
  await patchMockState(page, { recordingTimerIntervalMs: 1 });
  await startRecording(page);
  await expect
    .poll(
      () =>
        page.locator(".record-clock time").evaluate((time) => {
          const [hours, minutes, seconds] = (time.textContent || "0:0:0")
            .split(":")
            .map(Number);
          return hours * 3600 + minutes * 60 + seconds;
        }),
      { timeout: 25_000 },
    )
    .toBeGreaterThanOrEqual(3600);
  await stopRecording(page);
  await expect(page.locator(".recording-card")).toHaveCount(1);
});

test("韧性：连续五次录制都会停止各自的输出轨道", async ({ page }) => {
  for (let index = 0; index < 5; index += 1) {
    await startRecording(page);
    await stopRecording(page);
  }

  const state = await getMockSummary(page);
  expect(state.recorderStreams).toHaveLength(5);
  expect(state.recorderStreams.flat()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "video", readyState: "ended" }),
    ]),
  );
  expect(state.recorderStreams.flat().every((track) => track.readyState === "ended")).toBe(true);
  await expect(page.locator(".recording-card")).toHaveCount(5);
});
