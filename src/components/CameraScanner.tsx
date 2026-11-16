// Camera barcode reader, loaded only when the camera button is pressed.
// Uses the browser's built-in BarcodeDetector where available (Chrome on
// Android), otherwise the ZXing library (iPhone, desktop browsers).
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "data_matrix", "itf"];

export default function CameraScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopZxing: (() => void) | null = null;

    const report = (code: string) => {
      if (doneRef.current || !code.trim()) return;
      doneRef.current = true;
      navigator.vibrate?.(80);
      onDetected(code);
    };

    async function start(target: HTMLVideoElement) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot use the camera. Open the site over HTTPS in Chrome or Safari.");
        return;
      }
      const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      try {
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (stopped) return;
          target.srcObject = stream;
          await target.play();
          const detector = new Native({ formats: FORMATS });
          const tick = async () => {
            if (stopped || doneRef.current) return;
            try {
              const found = await detector.detect(target);
              if (found[0]) return report(found[0].rawValue);
            } catch {
              // A frame that cannot be decoded is normal; keep scanning.
            }
            timer = setTimeout(tick, 200);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            target,
            (result) => {
              if (result) report(result.getText());
            },
          );
          stopZxing = () => controls.stop();
          if (stopped) stopZxing();
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access for this site in the browser settings."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : "Could not start the camera.",
        );
      }
    }

    void start(video);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Scan with camera">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="relative aspect-[4/3] bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {!error && <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />}
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">{error ?? "Point the camera at the barcode. It scans automatically."}</p>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
