"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type CaptureMode = "camera" | "screen" | "composite";
type RecorderState = "idle" | "countdown" | "recording" | "processing";
type SidePanel = "script" | "library";

type PipPosition = {
  x: number;
  y: number;
  width: number;
};

type DirectoryHandleWithPermission = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  queryPermission?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};

type DocumentPictureInPictureWindow = Window & {
  documentPictureInPicture?: {
    requestWindow: (options?: {
      width?: number;
      height?: number;
      disallowReturnToOpener?: boolean;
    }) => Promise<Window>;
  };
};

type RecordingLibraryItem = {
  name: string;
  size: number;
  lastModified: number;
  url: string;
};

const DIRECTORY_DB = "jingchang-local-library";
const DIRECTORY_STORE = "handles";
const DIRECTORY_KEY = "recordings-directory";

const DEFAULT_SCRIPT = `今天我想分享一个，我最近在做产品时非常真实的判断。

很多人以为，做自媒体最难的是写稿、剪辑，或者找选题。但我真正开始录以后才发现，最容易打断表达的，其实是工具。

我需要一边演示电脑上的操作，一边让大家看到我，同时还要记得下一句话讲什么。以前这三件事分散在三个窗口里，讲着讲着，人就从内容里掉出来了。

所以我做了这个录制台。中间是最终会录下来的画面，左下角是我的镜头，右边是提词。所有内容只在本机处理，不需要先上传。

接下来我会直接演示一次：先打开摄像头，再选择要分享的屏幕，确认麦克风有声音，然后开始录制。`;

const MODE_LABELS: Array<{
  id: CaptureMode;
  label: string;
  description: string;
}> = [
  { id: "camera", label: "摄像头", description: "只录你自己" },
  { id: "screen", label: "录屏", description: "镜头仅监看" },
  { id: "composite", label: "录屏 + 人像", description: "画中画成片" },
];

const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatFileDate = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

const openDirectoryDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE)) {
        request.result.createObjectStore(DIRECTORY_STORE);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

const rememberDirectoryHandle = async (
  handle: FileSystemDirectoryHandle,
) => {
  const database = await openDirectoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE, "readwrite");
    transaction.objectStore(DIRECTORY_STORE).put(handle, DIRECTORY_KEY);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  database.close();
};

const restoreDirectoryHandle = async () => {
  const database = await openDirectoryDatabase();
  const handle = await new Promise<FileSystemDirectoryHandle | null>(
    (resolve, reject) => {
      const transaction = database.transaction(DIRECTORY_STORE, "readonly");
      const request = transaction.objectStore(DIRECTORY_STORE).get(DIRECTORY_KEY);
      request.addEventListener("success", () => {
        resolve((request.result as FileSystemDirectoryHandle | undefined) || null);
      });
      request.addEventListener("error", () => reject(request.error));
    },
  );
  database.close();
  return handle;
};

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const attachStream = (video: HTMLVideoElement | null, stream: MediaStream | null) => {
  if (!video || video.srcObject === stream) return;
  video.srcObject = stream;
  if (stream) {
    void video.play().catch(() => undefined);
  }
};

const chooseMp4MimeType = () => {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42001E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
};

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
};

const drawCover = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  if (!video.videoWidth || !video.videoHeight) return;
  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = width / height;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = video.videoHeight * targetRatio;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = video.videoWidth / targetRatio;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }

  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
};

const drawContain = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) => {
  if (!video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(video, x, y, drawWidth, drawHeight);
};

export default function Home() {
  const [mode, setMode] = useState<CaptureMode>("composite");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [cameraActive, setCameraActive] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("准备好后，先开启摄像头");
  const [errorMessage, setErrorMessage] = useState("");
  const [outputResolution, setOutputResolution] = useState("原生分辨率优先");
  const [fontSize, setFontSize] = useState(24);
  const [scrollSpeed, setScrollSpeed] = useState(2);
  const [autoScroll, setAutoScroll] = useState(false);
  const [mp4Ready, setMp4Ready] = useState<boolean | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>("script");
  const [directoryName, setDirectoryName] = useState("");
  const [directoryNeedsPermission, setDirectoryNeedsPermission] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [recordingLibrary, setRecordingLibrary] = useState<
    RecordingLibraryItem[]
  >([]);
  const [pipPosition, setPipPosition] = useState<PipPosition>({
    x: 0.035,
    y: 0.69,
    width: 0.25,
  });
  const [lastRecording, setLastRecording] = useState<{
    url: string;
    name: string;
    size: number;
  } | null>(null);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const cameraSourceRef = useRef<HTMLVideoElement | null>(null);
  const screenSourceRef = useRef<HTMLVideoElement | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const scriptRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(
    new Map(),
  );
  const audioTrackIdsRef = useRef<Set<string>>(new Set());
  const recordingOutputStreamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<CaptureMode>(mode);
  const directoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const floatingPrompterWindowRef = useRef<Window | null>(null);
  const libraryUrlsRef = useRef<string[]>([]);
  const pipPositionRef = useRef(pipPosition);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
  } | null>(null);

  const isBusy = recorderState !== "idle";
  const isRecording = recorderState === "recording";

  const refreshRecordingLibrary = useCallback(
    async (handle = directoryHandleRef.current) => {
      if (!handle) {
        setRecordingLibrary([]);
        return;
      }

      const permissionHandle = handle as DirectoryHandleWithPermission;
      const permission = permissionHandle.queryPermission
        ? await permissionHandle.queryPermission({ mode: "readwrite" })
        : "granted";
      if (permission !== "granted") {
        setDirectoryNeedsPermission(true);
        return;
      }

      setLibraryLoading(true);
      try {
        const items: RecordingLibraryItem[] = [];
        for await (const [name, entry] of permissionHandle.entries()) {
          if (entry.kind !== "file" || !name.toLowerCase().endsWith(".mp4")) {
            continue;
          }
          try {
            const file = await (entry as FileSystemFileHandle).getFile();
            items.push({
              name,
              size: file.size,
              lastModified: file.lastModified,
              url: URL.createObjectURL(file),
            });
          } catch {
            // The file may have been moved or deleted while the folder was read.
          }
        }

        items.sort((a, b) => b.lastModified - a.lastModified);
        libraryUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        libraryUrlsRef.current = items.map((item) => item.url);
        setRecordingLibrary(items);
        setDirectoryNeedsPermission(false);
      } finally {
        setLibraryLoading(false);
      }
    },
    [],
  );

  const chooseRecordingDirectory = useCallback(async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new Error("FOLDER_UNSUPPORTED");
    }

    const handle = await picker({
      id: "jingchang-recordings",
      mode: "readwrite",
    });
    directoryHandleRef.current = handle;
    setDirectoryName(handle.name);
    setDirectoryNeedsPermission(false);
    await rememberDirectoryHandle(handle);
    await refreshRecordingLibrary(handle);
    return handle;
  }, [refreshRecordingLibrary]);

  const ensureRecordingDirectory = useCallback(async () => {
    const current = directoryHandleRef.current;
    if (!current) return chooseRecordingDirectory();

    const permissionHandle = current as DirectoryHandleWithPermission;
    const existingPermission = permissionHandle.queryPermission
      ? await permissionHandle.queryPermission({ mode: "readwrite" })
      : "granted";
    if (existingPermission === "granted") return current;

    const requestedPermission = permissionHandle.requestPermission
      ? await permissionHandle.requestPermission({ mode: "readwrite" })
      : "denied";
    if (requestedPermission === "granted") {
      setDirectoryNeedsPermission(false);
      await refreshRecordingLibrary(current);
      return current;
    }

    return chooseRecordingDirectory();
  }, [chooseRecordingDirectory, refreshRecordingLibrary]);

  const saveRecordingToDirectory = async (blob: Blob, name: string) => {
    const directory = directoryHandleRef.current;
    if (!directory) throw new Error("FOLDER_REQUIRED");
    const fileHandle = await directory.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  };

  const openFloatingPrompter = async () => {
    setErrorMessage("");
    const script = scriptRef.current?.value || DEFAULT_SCRIPT;
    const pictureInPictureApi = (
      window as DocumentPictureInPictureWindow
    ).documentPictureInPicture;
    let prompterWindow: Window | null = null;

    try {
      if (pictureInPictureApi) {
        prompterWindow = await pictureInPictureApi.requestWindow({
          width: 440,
          height: 720,
          disallowReturnToOpener: false,
        });
      } else {
        prompterWindow = window.open(
          "",
          "jingchang-floating-prompter",
          "popup=yes,width=440,height=720",
        );
      }
      if (!prompterWindow) throw new Error("PROMPTER_BLOCKED");
      const activePrompterWindow = prompterWindow;

      if (
        floatingPrompterWindowRef.current &&
        floatingPrompterWindowRef.current !== activePrompterWindow
      ) {
        floatingPrompterWindowRef.current.close();
      }
      floatingPrompterWindowRef.current = activePrompterWindow;
      const prompterDocument = activePrompterWindow.document;
      prompterDocument.title = "镜场 · 悬浮提词器";
      prompterDocument.body.innerHTML = `
        <main class="prompter-shell">
          <header>
            <div>
              <small>镜场 / FLOATING SCRIPT</small>
              <strong>悬浮提词器</strong>
            </div>
            <button type="button" data-action="close">关闭</button>
          </header>
          <section class="script" aria-label="提词内容"></section>
          <footer>
            <button type="button" data-action="smaller">A−</button>
            <button type="button" data-action="toggle">开始滚动</button>
            <button type="button" data-action="slower">慢一点</button>
            <button type="button" data-action="faster">快一点</button>
            <button type="button" data-action="larger">A＋</button>
          </footer>
        </main>
      `;

      const style = prompterDocument.createElement("style");
      style.textContent = `
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #090a0b; }
        body { color: #f1eee8; font-family: "Avenir Next", "PingFang SC", sans-serif; }
        button { color: inherit; font: inherit; cursor: pointer; }
        .prompter-shell { display: grid; grid-template-rows: 68px minmax(0, 1fr) 62px; height: 100%; border: 1px solid #2b2f33; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid #2b2f33; background: #111315; }
        header div { display: grid; gap: 3px; }
        header small { color: #f04c3f; font: 700 8px "SFMono-Regular", monospace; letter-spacing: .14em; }
        header strong { font-size: 16px; letter-spacing: .04em; }
        header button, footer button { border: 1px solid #34383b; background: #1b1e20; }
        header button { padding: 7px 9px; color: #9b9fa1; font-size: 10px; }
        .script { overflow: auto; padding: 32px 24px 55vh; background: repeating-linear-gradient(0deg, transparent 0, transparent 47px, rgba(255,255,255,.025) 48px); font-family: "Songti SC", "STSong", serif; font-size: 30px; line-height: 1.72; white-space: pre-wrap; scrollbar-width: thin; scrollbar-color: #45494c transparent; }
        footer { display: grid; grid-template-columns: 48px 1.3fr 1fr 1fr 48px; gap: 5px; padding: 9px; border-top: 1px solid #2b2f33; background: #111315; }
        footer button { min-width: 0; padding: 8px 4px; font-size: 10px; }
        footer button[data-action="toggle"] { border-color: #f04c3f; background: #f04c3f; color: white; font-weight: 700; }
      `;
      prompterDocument.head.appendChild(style);

      const scriptElement =
        prompterDocument.querySelector<HTMLElement>(".script");
      if (!scriptElement) throw new Error("PROMPTER_FAILED");
      scriptElement.textContent = script;

      let isScrolling = false;
      let speed = 38;
      let fontSize = 30;
      let previous = activePrompterWindow.performance.now();
      let frame = 0;
      const tick = (now: number) => {
        if (isScrolling) {
          const delta = Math.min(now - previous, 50);
          scriptElement.scrollTop += (speed * delta) / 1000;
        }
        previous = now;
        frame = activePrompterWindow.requestAnimationFrame(tick);
      };
      frame = activePrompterWindow.requestAnimationFrame(tick);

      const actionButtons =
        prompterDocument.querySelectorAll<HTMLButtonElement>("[data-action]");
      actionButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.action;
          if (action === "close") activePrompterWindow.close();
          if (action === "smaller") {
            fontSize = Math.max(20, fontSize - 2);
            scriptElement.style.fontSize = `${fontSize}px`;
          }
          if (action === "larger") {
            fontSize = Math.min(52, fontSize + 2);
            scriptElement.style.fontSize = `${fontSize}px`;
          }
          if (action === "slower") speed = Math.max(12, speed - 8);
          if (action === "faster") speed = Math.min(110, speed + 8);
          if (action === "toggle") {
            isScrolling = !isScrolling;
            button.textContent = isScrolling ? "暂停滚动" : "开始滚动";
          }
        });
      });
      activePrompterWindow.addEventListener(
        "pagehide",
        () => {
          activePrompterWindow.cancelAnimationFrame(frame);
          if (floatingPrompterWindowRef.current === activePrompterWindow) {
            floatingPrompterWindowRef.current = null;
          }
        },
        { once: true },
      );
      setStatusMessage(
        pictureInPictureApi
          ? "提词器已悬浮置顶；录屏时请选择单个窗口或标签页"
          : "提词器已打开；录屏时请选择单个窗口或标签页",
      );
    } catch {
      setErrorMessage("悬浮提词器没有打开，请允许浏览器弹出窗口。");
    }
  };

  useEffect(() => {
    pipPositionRef.current = pipPosition;
  }, [pipPosition]);

  useEffect(() => {
    setMp4Ready(
      typeof MediaRecorder !== "undefined" && Boolean(chooseMp4MimeType()),
    );
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const handle = await restoreDirectoryHandle();
        if (!handle) return;
        directoryHandleRef.current = handle;
        setDirectoryName(handle.name);
        const permissionHandle = handle as DirectoryHandleWithPermission;
        const permission = permissionHandle.queryPermission
          ? await permissionHandle.queryPermission({ mode: "readwrite" })
          : "granted";
        if (permission === "granted") {
          await refreshRecordingLibrary(handle);
        } else {
          setDirectoryNeedsPermission(true);
        }
      } catch {
        // IndexedDB or a previously selected folder may be unavailable.
      }
    })();
  }, [refreshRecordingLibrary]);

  useEffect(() => {
    if (sidePanel !== "library") return;
    void refreshRecordingLibrary();

    const refreshOnFocus = () => {
      void refreshRecordingLibrary();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshRecordingLibrary();
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshRecordingLibrary, sidePanel]);

  useEffect(() => {
    attachStream(cameraSourceRef.current, cameraStreamRef.current);
    attachStream(cameraPreviewRef.current, cameraStreamRef.current);
    attachStream(screenSourceRef.current, screenStreamRef.current);
    attachStream(screenPreviewRef.current, screenStreamRef.current);
  }, [cameraActive, screenActive, mode]);

  useEffect(() => {
    if (!autoScroll) return;
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const script = scriptRef.current;
      if (script) {
        const delta = Math.min(now - previous, 50);
        const pixelsPerSecond = 10 + scrollSpeed * 12;
        script.scrollTop += (pixelsPerSecond * delta) / 1000;
        if (
          script.scrollTop + script.clientHeight >= script.scrollHeight - 2
        ) {
          setAutoScroll(false);
          return;
        }
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, scrollSpeed]);

  useEffect(() => {
    return () => {
      stopStream(cameraStreamRef.current);
      stopStream(screenStreamRef.current);
      stopStream(microphoneStreamRef.current);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timerRef.current) clearInterval(timerRef.current);
      void audioContextRef.current?.close();
      floatingPrompterWindowRef.current?.close();
      libraryUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const setFriendlyError = (error: unknown, fallback: string) => {
    const name =
      typeof error === "object" && error && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
    if (name === "NotAllowedError") {
      setErrorMessage("权限没有开启。请允许浏览器使用摄像头、麦克风或屏幕。");
    } else if (name === "NotFoundError") {
      setErrorMessage("没有找到可用设备，请检查摄像头或麦克风连接。");
    } else {
      setErrorMessage(fallback);
    }
  };

  const ensureCamera = useCallback(async () => {
    if (cameraStreamRef.current?.active) return cameraStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头调用");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: "user",
      },
      audio: false,
    });
    cameraStreamRef.current = stream;
    attachStream(cameraSourceRef.current, stream);
    stream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        cameraStreamRef.current = null;
        setCameraActive(false);
      },
      { once: true },
    );
    setCameraActive(true);
    setCameraEnabled(true);
    return stream;
  }, []);

  const ensureMicrophone = useCallback(async () => {
    if (microphoneStreamRef.current?.active) {
      return microphoneStreamRef.current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风调用");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    microphoneStreamRef.current = stream;
    stream.getAudioTracks()[0]?.addEventListener(
      "ended",
      () => {
        microphoneStreamRef.current = null;
        setMicrophoneActive(false);
      },
      { once: true },
    );
    setMicrophoneActive(true);
    return stream;
  }, []);

  const openCamera = async () => {
    setErrorMessage("");
    try {
      await Promise.all([
        ensureCamera(),
        microphoneEnabled ? ensureMicrophone() : Promise.resolve(null),
      ]);
      setStatusMessage("摄像头已就绪，可以选择屏幕");
    } catch (error) {
      setFriendlyError(error, "摄像头启动失败，请检查浏览器权限。");
    }
  };

  const openScreen = useCallback(async () => {
    if (screenStreamRef.current?.active) return screenStreamRef.current;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("当前浏览器不支持录屏");
    }

    const options = {
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 3840, max: 3840 },
        height: { ideal: 2160, max: 2160 },
        resizeMode: "none",
        cursor: "always",
        displaySurface: "window",
      },
      audio: true,
      monitorTypeSurfaces: "exclude",
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions;

    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack?.getSettings().displaySurface === "monitor") {
      stopStream(stream);
      throw new Error("ENTIRE_SCREEN_SELECTED");
    }

    screenStreamRef.current = stream;
    attachStream(screenSourceRef.current, stream);
    if (videoTrack && "contentHint" in videoTrack) {
      videoTrack.contentHint = "detail";
    }
    videoTrack?.addEventListener(
      "ended",
      () => {
        screenStreamRef.current = null;
        setScreenActive(false);
        setStatusMessage("屏幕共享已结束");
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      },
      { once: true },
    );
    setScreenActive(true);
    return stream;
  }, []);

  const selectScreen = async () => {
    setErrorMessage("");
    try {
      await openScreen();
      if (cameraEnabled) {
        await ensureCamera();
      }
      if (microphoneEnabled) {
        await ensureMicrophone();
      }
      setStatusMessage(
        screenStreamRef.current?.getAudioTracks().length
          ? "屏幕与系统声音已就绪"
          : "屏幕已就绪；当前分享源没有系统声音",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ENTIRE_SCREEN_SELECTED"
      ) {
        setErrorMessage(
          "为了不把提词器录进去，请选择单个窗口或标签页，不要选择整个屏幕。",
        );
      } else {
        setFriendlyError(error, "没有成功选择屏幕，请再试一次。");
      }
    }
  };

  const toggleMicrophone = async () => {
    setErrorMessage("");
    const nextEnabled = !microphoneEnabled;
    setMicrophoneEnabled(nextEnabled);
    try {
      if (nextEnabled) {
        const stream = await ensureMicrophone();
        stream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        setStatusMessage("麦克风已开启");
      } else {
        microphoneStreamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
        setStatusMessage("麦克风已静音");
      }
    } catch (error) {
      setMicrophoneEnabled(false);
      setFriendlyError(error, "麦克风启动失败，请检查浏览器权限。");
    }
  };

  const toggleCamera = async () => {
    setErrorMessage("");
    const nextEnabled = !cameraEnabled;
    setCameraEnabled(nextEnabled);
    try {
      if (nextEnabled) {
        const stream = await ensureCamera();
        stream.getVideoTracks().forEach((track) => {
          track.enabled = true;
        });
        setStatusMessage("摄像头已开启");
      } else {
        cameraStreamRef.current?.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        setStatusMessage("摄像头画面已关闭");
      }
    } catch (error) {
      setCameraEnabled(false);
      setFriendlyError(error, "摄像头启动失败，请检查浏览器权限。");
    }
  };

  const getRecordingDimensions = (captureMode: CaptureMode) => {
    if (captureMode === "camera") {
      return { width: 1920, height: 1080 };
    }

    const screen = screenSourceRef.current;
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    const settings = screenTrack?.getSettings();
    const sourceWidth = screen?.videoWidth || settings?.width || 1920;
    const sourceHeight = screen?.videoHeight || settings?.height || 1080;
    const scale = Math.min(1, 3840 / sourceWidth, 2160 / sourceHeight);

    return {
      width: Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2),
      height: Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2),
    };
  };

  const beginCanvasComposition = (captureMode: CaptureMode) => {
    const canvas = recordingCanvasRef.current;
    const camera = cameraSourceRef.current;
    const screen = screenSourceRef.current;
    if (!canvas) throw new Error("录制画布不可用");

    const dimensions = getRecordingDimensions(captureMode);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    setOutputResolution(`${dimensions.width} × ${dimensions.height}`);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建录制画面");

    const draw = () => {
      context.fillStyle = "#050607";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const activeMode = modeRef.current;
      if (activeMode === "camera" && camera) {
        drawCover(context, camera, 0, 0, canvas.width, canvas.height);
      } else if (screen) {
        drawContain(context, screen, canvas.width, canvas.height);
      }

      if (activeMode === "composite" && camera && cameraEnabled) {
        const pip = pipPositionRef.current;
        const pipWidth = canvas.width * pip.width;
        const pipHeight = pipWidth * (9 / 16);
        const pipX = canvas.width * pip.x;
        const pipY = Math.min(
          canvas.height - pipHeight - 26,
          canvas.height * pip.y,
        );

        context.save();
        context.shadowColor = "rgba(0,0,0,.55)";
        context.shadowBlur = 42;
        context.shadowOffsetY = 12;
        roundedRect(context, pipX, pipY, pipWidth, pipHeight, 26);
        context.fillStyle = "#0B0D0E";
        context.fill();
        context.shadowColor = "transparent";
        roundedRect(context, pipX, pipY, pipWidth, pipHeight, 26);
        context.clip();
        drawCover(context, camera, pipX, pipY, pipWidth, pipHeight);
        context.restore();

        context.save();
        roundedRect(context, pipX, pipY, pipWidth, pipHeight, 26);
        context.lineWidth = 5;
        context.strokeStyle = "rgba(255,255,255,.72)";
        context.stroke();
        context.restore();
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return {
      stream: canvas.captureStream(30),
      width: dimensions.width,
      height: dimensions.height,
    };
  };

  const addAudioStreamToMixer = (stream: MediaStream) => {
    const audioTracks = stream
      .getAudioTracks()
      .filter((track) => track.enabled && !audioTrackIdsRef.current.has(track.id));
    if (!audioTracks.length) return;

    const outputStream = recordingOutputStreamRef.current;
    const audioContext = audioContextRef.current;
    const destination = audioDestinationRef.current;
    if (!outputStream) return;

    if (!audioContext || !destination) {
      audioTracks.forEach((track) => {
        outputStream.addTrack(track);
        audioTrackIdsRef.current.add(track.id);
      });
      return;
    }

    audioTracks.forEach((track) => {
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination);
      audioSourcesRef.current.set(track.id, source);
      audioTrackIdsRef.current.add(track.id);
    });
  };

  const addMixedAudio = async (
    outputStream: MediaStream,
    sourceStreams: MediaStream[],
  ) => {
    recordingOutputStreamRef.current = outputStream;
    audioTrackIdsRef.current.clear();
    audioSourcesRef.current.clear();
    const audioTracks = sourceStreams.flatMap((stream) =>
      stream.getAudioTracks().filter((track) => track.enabled),
    );
    if (!audioTracks.length) return;

    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) {
      audioTracks.forEach((track) => {
        outputStream.addTrack(track);
        audioTrackIdsRef.current.add(track.id);
      });
      return;
    }

    const audioContext = new AudioContextClass();
    audioContextRef.current = audioContext;
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    audioDestinationRef.current = destination;

    audioTracks.forEach((track) => {
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination);
      audioSourcesRef.current.set(track.id, source);
      audioTrackIdsRef.current.add(track.id);
    });
    destination.stream.getAudioTracks().forEach((track) => {
      outputStream.addTrack(track);
    });
  };

  const runCountdown = async () => {
    setRecorderState("countdown");
    for (let value = 3; value > 0; value -= 1) {
      setCountdown(value);
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    setCountdown(null);
  };

  const startRecording = async () => {
    if (isBusy) return;
    setErrorMessage("");
    setLastRecording((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });

    try {
      const mimeType =
        typeof MediaRecorder !== "undefined" ? chooseMp4MimeType() : "";
      if (!mimeType) {
        throw new Error("MP4_UNSUPPORTED");
      }
      await ensureRecordingDirectory();

      let cameraStream: MediaStream | null = cameraStreamRef.current;
      let screenStream: MediaStream | null = screenStreamRef.current;
      let microphoneStream: MediaStream | null =
        microphoneStreamRef.current;

      if (mode === "camera" || mode === "composite" || cameraEnabled) {
        cameraStream = await ensureCamera();
      }
      if (mode === "screen" || mode === "composite") {
        screenStream = await openScreen();
      }
      if (microphoneEnabled) {
        microphoneStream = await ensureMicrophone();
        microphoneStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      }

      await runCountdown();
      const composition = beginCanvasComposition(mode);
      const outputStream = composition.stream;
      const audioSources = [
        ...(microphoneEnabled && microphoneStream ? [microphoneStream] : []),
        ...(screenStream ? [screenStream] : []),
      ];
      await addMixedAudio(outputStream, audioSources);

      const recorder = new MediaRecorder(
        outputStream,
        {
          mimeType,
          videoBitsPerSecond:
            mode === "camera"
              ? 12_000_000
              : Math.min(
                  32_000_000,
                  Math.max(
                    16_000_000,
                    Math.round(
                      (composition.width * composition.height * 30 * 0.24) /
                        1_000_000,
                    ) * 1_000_000,
                  ),
                ),
          audioBitsPerSecond: 192_000,
        },
      );
      mediaRecorderRef.current = recorder;
      recorderChunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      });

      recorder.addEventListener(
        "stop",
        async () => {
          setRecorderState("processing");
          if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          outputStream.getTracks().forEach((track) => track.stop());
          void audioContextRef.current?.close();
          audioContextRef.current = null;
          audioSourcesRef.current.forEach((source) => source.disconnect());
          audioSourcesRef.current.clear();
          audioDestinationRef.current = null;
          audioTrackIdsRef.current.clear();
          recordingOutputStreamRef.current = null;

          const finalMime = recorder.mimeType || mimeType;
          if (!finalMime.toLowerCase().includes("mp4")) {
            setRecorderState("idle");
            setErrorMessage(
              "浏览器没有生成真正的 MP4 文件，请更新浏览器后再试。",
            );
            mediaRecorderRef.current = null;
            return;
          }

          const blob = new Blob(recorderChunksRef.current, {
            type: "video/mp4",
          });
          const url = URL.createObjectURL(blob);
          const stamp = new Date()
            .toISOString()
            .replace(/:/g, "-")
            .replace(/\.\d{3}Z$/, "");
          const name = `镜场-${stamp}.mp4`;
          setLastRecording({ url, name, size: blob.size });
          try {
            await saveRecordingToDirectory(blob, name);
            await refreshRecordingLibrary();
            setSidePanel("library");
            setStatusMessage(
              `MP4 已保存到「${directoryHandleRef.current?.name || "录制文件夹"}」`,
            );
          } catch {
            setErrorMessage(
              "MP4 已生成，但没有写入保存文件夹。请点击右侧下载副本。",
            );
          } finally {
            setRecorderState("idle");
            mediaRecorderRef.current = null;
          }
        },
        { once: true },
      );

      recorder.start(1000);
      modeRef.current = mode;
      setElapsedSeconds(0);
      setRecorderState("recording");
      setStatusMessage("正在录制 · 所有画面只在本机合成");
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
    } catch (error) {
      setCountdown(null);
      setRecorderState("idle");
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (error instanceof Error && error.message === "MP4_UNSUPPORTED") {
        setErrorMessage(
          "当前浏览器不能直接生成 MP4。请更新 Chrome，或改用最新版 Safari。",
        );
      } else if (
        error instanceof Error &&
        error.message === "FOLDER_UNSUPPORTED"
      ) {
        setErrorMessage(
          "当前浏览器不能直接保存到文件夹。请使用最新版 Chrome 或 Edge。",
        );
      } else if (
        error instanceof Error &&
        error.message === "ENTIRE_SCREEN_SELECTED"
      ) {
        setErrorMessage(
          "为了不把提词器录进去，请重新选择单个窗口或标签页。",
        );
      } else if (
        typeof error === "object" &&
        error &&
        "name" in error &&
        String((error as { name: unknown }).name) === "AbortError"
      ) {
        setStatusMessage("未选择保存文件夹，录制没有开始");
      } else {
        setFriendlyError(error, "录制没有启动，请检查设备和浏览器权限。");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      setStatusMessage("正在整理录制文件…");
      mediaRecorderRef.current.stop();
    }
  };

  const changeMode = async (nextMode: CaptureMode) => {
    if (recorderState === "countdown" || recorderState === "processing") return;
    const previousMode = modeRef.current;
    setErrorMessage("");

    try {
      if (nextMode !== "camera" && !screenStreamRef.current?.active) {
        setStatusMessage("正在申请屏幕权限…");
        await openScreen();
      }

      if (nextMode !== "camera") {
        screenStreamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        if (mediaRecorderRef.current?.state === "recording") {
          addAudioStreamToMixer(screenStreamRef.current as MediaStream);
        }
      } else {
        screenStreamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }

      modeRef.current = nextMode;
      setMode(nextMode);
      if (nextMode === "camera") {
        setStatusMessage(isRecording ? "已切换为摄像头成片" : "摄像头会占满最终画面");
      } else if (nextMode === "screen") {
        setStatusMessage(
          isRecording ? "已切换为录屏成片" : "摄像头仅用于监看，不会进入成片",
        );
      } else {
        setStatusMessage(
          isRecording ? "已切换为录屏 + 人像成片" : "屏幕与人像会合成在同一个视频里",
        );
      }
    } catch (error) {
      modeRef.current = previousMode;
      setMode(previousMode);
      if (
        error instanceof Error &&
        error.message === "ENTIRE_SCREEN_SELECTED"
      ) {
        setErrorMessage(
          "为了不把提词器录进去，请选择单个窗口或标签页，不要选择整个屏幕。",
        );
      } else {
        setFriendlyError(error, "没有成功切换录制模式，请再试一次。");
      }
    }
  };

  const startPipDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isBusy || !previewRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pipPosition.x,
      originY: pipPosition.y,
      pointerId: event.pointerId,
    };
  };

  const movePip = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const preview = previewRef.current;
    if (!drag || !preview || drag.pointerId !== event.pointerId) return;
    const bounds = preview.getBoundingClientRect();
    const nextX =
      drag.originX + (event.clientX - drag.startX) / bounds.width;
    const nextY =
      drag.originY + (event.clientY - drag.startY) / bounds.height;
    setPipPosition((current) => ({
      ...current,
      x: Math.max(0.015, Math.min(0.985 - current.width, nextX)),
      y: Math.max(0.025, Math.min(0.79, nextY)),
    }));
  };

  const endPipDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const showScreen = mode !== "camera";
  const showCameraMain = mode === "camera";
  const showCameraPip = !showCameraMain && cameraActive && cameraEnabled;

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            镜
          </span>
          <div>
            <strong>镜场</strong>
            <span>创作者录制台</span>
          </div>
        </div>

        <div className="privacy-note">
          <span className="privacy-dot" aria-hidden="true" />
          本机录制 · 不上传
        </div>

        <div className={`record-clock ${isRecording ? "is-live" : ""}`}>
          <span>{isRecording ? "REC" : "READY"}</span>
          <time>{formatTime(elapsedSeconds)}</time>
        </div>
      </header>

      <section className="workspace">
        <section className="stage-panel" aria-label="录制画面">
          <div className="stage-heading">
            <div>
              <p className="eyebrow">OUTPUT / 最终成片</p>
              <h1>一边操作，一边把话讲完整。</h1>
            </div>
            <div className="mode-tabs" aria-label="录制模式">
              {MODE_LABELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={mode === item.id ? "active" : ""}
                  onClick={() => changeMode(item.id)}
                  disabled={recorderState === "countdown" || recorderState === "processing"}
                  aria-pressed={mode === item.id}
                  title={item.description}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="preview-wrap">
            <div className="preview-label">
              <span className={screenActive || cameraActive ? "ready" : ""}>
                {screenActive || cameraActive ? "信号就绪" : "等待信号"}
              </span>
              <span>MP4 · {outputResolution} · 30 FPS</span>
            </div>

            <div className="preview-stage" ref={previewRef}>
              {!showCameraMain && !screenActive && (
                <div className="empty-preview">
                  <span className="empty-index">01</span>
                  <div className="empty-frame" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <strong>选择你要演示的屏幕</strong>
                  <p>请选择单个窗口或标签页，悬浮提词器不会进入成片</p>
                </div>
              )}

              {showCameraMain && !cameraActive && (
                <div className="empty-preview camera-empty">
                  <span className="empty-index">CAM</span>
                  <strong>先开启摄像头</strong>
                  <p>画面会在这里预览，确认构图后再开始录制</p>
                </div>
              )}

              {showScreen && (
                <video
                  ref={screenPreviewRef}
                  className={`screen-preview ${screenActive ? "visible" : ""}`}
                  autoPlay
                  muted
                  playsInline
                />
              )}

              {showCameraMain && (
                <video
                  ref={cameraPreviewRef}
                  className={`camera-main-preview ${
                    cameraActive && cameraEnabled ? "visible" : ""
                  }`}
                  autoPlay
                  muted
                  playsInline
                />
              )}

              {showCameraPip && (
                <div
                  className={`camera-pip ${
                    mode === "screen" ? "monitor-only" : ""
                  }`}
                  style={{
                    left: `${pipPosition.x * 100}%`,
                    top: `${pipPosition.y * 100}%`,
                    width: `${pipPosition.width * 100}%`,
                  }}
                  onPointerDown={startPipDrag}
                  onPointerMove={movePip}
                  onPointerUp={endPipDrag}
                  onPointerCancel={endPipDrag}
                  role="group"
                  aria-label="可拖动的人像画中画"
                >
                  <video
                    ref={cameraPreviewRef}
                    autoPlay
                    muted
                    playsInline
                  />
                  <span>
                    {mode === "screen" ? "仅监看 · 不入成片" : "拖动调整位置"}
                  </span>
                </div>
              )}

              <div className="safe-area" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>

              {countdown !== null && (
                <div className="countdown" aria-live="assertive">
                  <span>{countdown}</span>
                  <p>看镜头，准备开始</p>
                </div>
              )}

              {isRecording && (
                <div className="live-badge">
                  <span />
                  REC
                </div>
              )}
            </div>
          </div>

          <div className="control-dock">
            <div className="device-status">
              <span className={cameraActive && cameraEnabled ? "ready" : ""}>
                <i /> 摄像头
              </span>
              <span
                className={
                  microphoneActive && microphoneEnabled ? "ready" : ""
                }
              >
                <i /> 麦克风
              </span>
              <span className={screenActive ? "ready" : ""}>
                <i /> 屏幕
              </span>
              <span className={mp4Ready ? "ready" : "unsupported"}>
                <i /> {mp4Ready === null ? "检测格式" : mp4Ready ? "MP4" : "MP4 不可用"}
              </span>
              <span className={directoryName ? "ready" : ""}>
                <i /> {directoryName || "未选文件夹"}
              </span>
            </div>

            <div className="primary-controls">
              <button
                className="setup-button"
                type="button"
                onClick={openCamera}
                disabled={isBusy}
              >
                <span className="button-kicker">STEP 1</span>
                {cameraActive ? "摄像头已开启" : "开启摄像头"}
              </button>
              <button
                className="setup-button"
                type="button"
                onClick={selectScreen}
                disabled={isBusy || mode === "camera"}
              >
                <span className="button-kicker">STEP 2</span>
                {screenActive ? "重新选择屏幕" : "选择屏幕"}
              </button>
              <button
                className={`record-button ${isRecording ? "stop" : ""}`}
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={recorderState === "countdown" || recorderState === "processing"}
              >
                <span className="record-symbol" aria-hidden="true" />
                <span>
                  <small>
                    {isRecording
                      ? formatTime(elapsedSeconds)
                      : recorderState === "processing"
                        ? "处理中"
                        : "STEP 3"}
                  </small>
                  {isRecording ? "停止录制" : "开始录制"}
                </span>
              </button>
            </div>

            <div className="quick-toggles">
              <button
                type="button"
                onClick={toggleMicrophone}
                className={microphoneEnabled ? "active" : ""}
                aria-pressed={microphoneEnabled}
                disabled={isBusy}
              >
                MIC {microphoneEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={toggleCamera}
                className={cameraEnabled ? "active" : ""}
                aria-pressed={cameraEnabled}
                disabled={isBusy}
              >
                CAM {cameraEnabled ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <div className="status-line" aria-live="polite">
            <span>{errorMessage || statusMessage}</span>
            {lastRecording && (
              <div className="status-actions">
                <button type="button" onClick={() => setSidePanel("library")}>
                  查看录制库
                </button>
                <a href={lastRecording.url} download={lastRecording.name}>
                  下载副本 · {formatBytes(lastRecording.size)}
                </a>
              </div>
            )}
          </div>
        </section>

        <aside
          className={`teleprompter ${sidePanel === "library" ? "library-mode" : ""}`}
          aria-label={sidePanel === "script" ? "提词器" : "录制库"}
        >
          <div className="teleprompter-heading">
            <div className="side-panel-tabs" aria-label="右侧面板">
              <button
                type="button"
                className={sidePanel === "script" ? "active" : ""}
                onClick={() => setSidePanel("script")}
                aria-pressed={sidePanel === "script"}
              >
                <small>SCRIPT</small>
                提词器
              </button>
              <button
                type="button"
                className={sidePanel === "library" ? "active" : ""}
                onClick={() => setSidePanel("library")}
                aria-pressed={sidePanel === "library"}
              >
                <small>LIBRARY</small>
                录制库
                {recordingLibrary.length > 0 && (
                  <b>{recordingLibrary.length}</b>
                )}
              </button>
            </div>
            {sidePanel === "script" ? (
              <button
                type="button"
                className="reset-script"
                onClick={() => {
                  if (scriptRef.current) scriptRef.current.scrollTop = 0;
                }}
              >
                回到开头
              </button>
            ) : (
              <button
                type="button"
                className="reset-script"
                onClick={() => void refreshRecordingLibrary()}
                disabled={libraryLoading || !directoryName}
              >
                {libraryLoading ? "读取中" : "刷新"}
              </button>
            )}
          </div>

          {sidePanel === "script" ? (
            <>
              <div className="script-window">
                <div className="reading-line" aria-hidden="true">
                  <span>阅读线</span>
                </div>
                <textarea
                  ref={scriptRef}
                  className="script-text"
                  defaultValue={DEFAULT_SCRIPT}
                  style={{ fontSize: `${fontSize}px` }}
                  aria-label="可编辑的提词脚本"
                  spellCheck={false}
                  disabled={isRecording}
                />
              </div>

              <div className="teleprompter-controls">
                <div className="control-row">
                  <label htmlFor="font-size">字号</label>
                  <input
                    id="font-size"
                    type="range"
                    min="18"
                    max="36"
                    step="1"
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value))}
                  />
                  <output>{fontSize}</output>
                </div>
                <div className="control-row">
                  <label htmlFor="scroll-speed">速度</label>
                  <input
                    id="scroll-speed"
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={scrollSpeed}
                    onChange={(event) => setScrollSpeed(Number(event.target.value))}
                  />
                  <output>{scrollSpeed}×</output>
                </div>
                <button
                  className={`autoscroll-button ${autoScroll ? "active" : ""}`}
                  type="button"
                  onClick={() => setAutoScroll((value) => !value)}
                  aria-pressed={autoScroll}
                >
                  <span className="toggle-track" aria-hidden="true">
                    <i />
                  </span>
                  <span>
                    <small>AUTO SCROLL</small>
                    {autoScroll ? "暂停自动滚动" : "开启自动滚动"}
                  </span>
                </button>
                <button
                  className="floating-prompter-button"
                  type="button"
                  onClick={() => void openFloatingPrompter()}
                >
                  <span aria-hidden="true">↗</span>
                  <span>
                    <small>ALWAYS ON TOP</small>
                    悬浮提词器
                  </span>
                </button>
              </div>

              <footer className="teleprompter-footer">
                <span>脚本可直接编辑与粘贴</span>
                <span>{isRecording ? "录制中已锁定" : "录制时自动锁定"}</span>
              </footer>
            </>
          ) : (
            <>
              <div className="recording-library">
                <section className="folder-card">
                  <p className="eyebrow">LOCAL FOLDER / 本机目录</p>
                  <strong>
                    {directoryName || "为录制内容选择一个保存文件夹"}
                  </strong>
                  <p>
                    {directoryName
                      ? directoryNeedsPermission
                        ? "浏览器需要你重新授权这个文件夹。"
                        : "这里是唯一来源：移出或删除文件后，录制库也会同步消失。"
                      : "以后每条 MP4 都会直接写进这里，不经过云端。"}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const directoryAction = directoryNeedsPermission
                        ? ensureRecordingDirectory()
                        : chooseRecordingDirectory();
                      void directoryAction.catch((error) => {
                        if (
                          typeof error === "object" &&
                          error &&
                          "name" in error &&
                          String((error as { name: unknown }).name) ===
                            "AbortError"
                        ) {
                          return;
                        }
                        setErrorMessage(
                          "保存文件夹没有打开，请使用最新版 Chrome 或 Edge。",
                        );
                      });
                    }}
                  >
                    {directoryNeedsPermission
                      ? "重新授权文件夹"
                      : directoryName
                        ? "更换保存文件夹"
                        : "选择保存文件夹"}
                  </button>
                </section>

                {directoryName && !directoryNeedsPermission && (
                  <div className="library-list">
                    <div className="library-list-heading">
                      <span>
                        {libraryLoading
                          ? "正在读取文件…"
                          : `${recordingLibrary.length} 条本机录制`}
                      </span>
                      <small>MP4 ONLY</small>
                    </div>

                    {!libraryLoading && recordingLibrary.length === 0 && (
                      <div className="empty-library">
                        <span>00</span>
                        <strong>还没有录制内容</strong>
                        <p>完成第一条录制后，视频会出现在这里。</p>
                      </div>
                    )}

                    {recordingLibrary.map((item) => (
                      <article className="recording-card" key={item.name}>
                        <video
                          src={item.url}
                          controls
                          preload="metadata"
                          playsInline
                        />
                        <div>
                          <strong title={item.name}>{item.name}</strong>
                          <span>
                            {formatFileDate(item.lastModified)} ·{" "}
                            {formatBytes(item.size)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <footer className="teleprompter-footer">
                <span>以文件夹真实内容为准</span>
                <span>删除或移出后刷新即消失</span>
              </footer>
            </>
          )}
        </aside>
      </section>

      <video ref={cameraSourceRef} className="source-video" autoPlay muted playsInline />
      <video ref={screenSourceRef} className="source-video" autoPlay muted playsInline />
      <canvas ref={recordingCanvasRef} className="source-video" />
    </main>
  );
}
