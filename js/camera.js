// 摄像头管理:列出设备、开启预览、录制 webm
export async function listCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('当前浏览器不支持摄像头枚举');
  }
  // 先请一次权限,否则 label 为空
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach(t => t.stop());
  } catch (e) { /* 用户拒绝 */ }
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter(d => d.kind === 'videoinput');
}

let currentStream = null;
let recorder = null;
let chunks = [];
let onStopCallback = null;

export async function startPreview(videoEl, { deviceId, width, height } = {}) {
  await stopPreview();
  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: width ? { ideal: width } : undefined,
      height: height ? { ideal: height } : undefined,
      frameRate: { ideal: 30 },
    },
    audio: false, // 静音拍摄
  };
  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = currentStream;
  await videoEl.play().catch(()=>{});
  return currentStream;
}

export async function stopPreview() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

export function startRecord({ onStop } = {}) {
  if (!currentStream) throw new Error('请先开启摄像头');
  chunks = [];
  onStopCallback = onStop;
  const mime = pickMime();
  recorder = new MediaRecorder(currentStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (onStopCallback) onStopCallback(blob);
  };
  recorder.start(1000);
}

export function stopRecord() {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
}

function pickMime() {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

// ============= 麦克风录音(用于音色克隆) =============
let micStream = null;
let micRecorder = null;
let micChunks = [];

export async function startMicRecord() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 } });
  micChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  micRecorder = new MediaRecorder(micStream, { mimeType: mime });
  micRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
  micRecorder.start();
}

export async function stopMicRecord() {
  return new Promise((resolve) => {
    if (!micRecorder) return resolve(null);
    micRecorder.onstop = () => {
      const blob = new Blob(micChunks, { type: 'audio/webm' });
      micChunks = [];
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
      resolve(blob);
    };
    micRecorder.stop();
  });
}
