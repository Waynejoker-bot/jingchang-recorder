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

type PipPosition = {
  x: number;
  y: number;
  width: number;
};

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

const chooseMimeType = () => {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
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
  const [fontSize, setFontSize] = useState(24);
  const [scrollSpeed, setScrollSpeed] = useState(2);
  const [autoScroll, setAutoScroll] = useState(false);
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

  useEffect(() => {
    pipPositionRef.current = pipPosition;
  }, [pipPosition]);

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
        cursor: "always",
      },
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions;

    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    screenStreamRef.current = stream;
    attachStream(screenSourceRef.current, stream);
    const videoTrack = stream.getVideoTracks()[0];
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
      setFriendlyError(error, "没有成功选择屏幕，请再试一次。");
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

  const beginCanvasComposition = (captureMode: CaptureMode) => {
    const canvas = recordingCanvasRef.current;
    const camera = cameraSourceRef.current;
    const screen = screenSourceRef.current;
    if (!canvas) throw new Error("录制画布不可用");

    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法创建录制画面");

    const draw = () => {
      context.fillStyle = "#050607";
      context.fillRect(0, 0, canvas.width, canvas.height);

      if (captureMode === "camera" && camera) {
        drawCover(context, camera, 0, 0, canvas.width, canvas.height);
      } else if (screen) {
        drawContain(context, screen, canvas.width, canvas.height);
      }

      if (captureMode === "composite" && camera && cameraEnabled) {
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
    return canvas.captureStream(30);
  };

  const addMixedAudio = async (
    outputStream: MediaStream,
    sourceStreams: MediaStream[],
  ) => {
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
      outputStream.addTrack(audioTracks[0]);
      return;
    }

    const audioContext = new AudioContextClass();
    audioContextRef.current = audioContext;
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();

    audioTracks.forEach((track) => {
      const stream = new MediaStream([track]);
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
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
      const outputStream = beginCanvasComposition(mode);
      const audioSources = [
        ...(microphoneEnabled && microphoneStream ? [microphoneStream] : []),
        ...(screenStream ? [screenStream] : []),
      ];
      await addMixedAudio(outputStream, audioSources);

      const mimeType = chooseMimeType();
      const recorder = new MediaRecorder(
        outputStream,
        mimeType
          ? {
              mimeType,
              videoBitsPerSecond: 8_000_000,
              audioBitsPerSecond: 192_000,
            }
          : undefined,
      );
      mediaRecorderRef.current = recorder;
      recorderChunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      });

      recorder.addEventListener(
        "stop",
        () => {
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

          const finalMime = recorder.mimeType || mimeType || "video/webm";
          const extension = finalMime.includes("mp4") ? "mp4" : "webm";
          const blob = new Blob(recorderChunksRef.current, { type: finalMime });
          const url = URL.createObjectURL(blob);
          const stamp = new Date()
            .toISOString()
            .replace(/:/g, "-")
            .replace(/\.\d{3}Z$/, "");
          const name = `镜场-${stamp}.${extension}`;
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          link.click();
          setLastRecording({ url, name, size: blob.size });
          setRecorderState("idle");
          setStatusMessage("录制完成，文件已保存到下载目录");
          mediaRecorderRef.current = null;
        },
        { once: true },
      );

      recorder.start(1000);
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
      setFriendlyError(error, "录制没有启动，请检查设备和浏览器权限。");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      setStatusMessage("正在整理录制文件…");
      mediaRecorderRef.current.stop();
    }
  };

  const changeMode = (nextMode: CaptureMode) => {
    if (isBusy) return;
    setMode(nextMode);
    setErrorMessage("");
    if (nextMode === "camera") {
      setStatusMessage("摄像头会占满最终画面");
    } else if (nextMode === "screen") {
      setStatusMessage("摄像头仅用于监看，不会进入成片");
    } else {
      setStatusMessage("屏幕与人像会合成在同一个视频里");
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
                  disabled={isBusy}
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
              <span>1920 × 1080 · 30 FPS</span>
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
                  <p>浏览器会让你决定分享整个屏幕、窗口或标签页</p>
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
              <a href={lastRecording.url} download={lastRecording.name}>
                再次下载 · {formatBytes(lastRecording.size)}
              </a>
            )}
          </div>
        </section>

        <aside className="teleprompter" aria-label="提词器">
          <div className="teleprompter-heading">
            <div>
              <p className="eyebrow">SCRIPT / 台词</p>
              <h2>提词器</h2>
            </div>
            <button
              type="button"
              className="reset-script"
              onClick={() => {
                if (scriptRef.current) scriptRef.current.scrollTop = 0;
              }}
            >
              回到开头
            </button>
          </div>

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
          </div>

          <footer className="teleprompter-footer">
            <span>脚本可直接编辑与粘贴</span>
            <span>{isRecording ? "录制中已锁定" : "录制时自动锁定"}</span>
          </footer>
        </aside>
      </section>

      <video ref={cameraSourceRef} className="source-video" autoPlay muted playsInline />
      <video ref={screenSourceRef} className="source-video" autoPlay muted playsInline />
      <canvas ref={recordingCanvasRef} className="source-video" />
    </main>
  );
}
