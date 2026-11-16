import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react";
import { normaliseCode } from "../../shared/masters";
import { Button, Spinner } from "./ui";

const CameraScanner = lazy(() => import("./CameraScanner"));

interface ScanInputProps {
  /** Called with the normalised code after Enter (USB scanners send Enter) or a camera read. */
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * One box for every barcode: a USB scanner types into it like a keyboard and
 * presses Enter; the camera button reads codes with the device camera.
 */
export function ScanInput({ onScan, placeholder = "Scan or type a barcode / serial number", autoFocus, disabled }: ScanInputProps) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(raw: string) {
    const code = normaliseCode(raw);
    setValue("");
    if (code) onScan(code);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(value);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M16 8v8" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Scan barcode or serial number"
            className="block w-full rounded-lg border-0 py-2.5 pl-10 pr-3 font-mono text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:font-sans placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900 sm:text-sm"
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => setCameraOpen(true)} disabled={disabled} aria-label="Scan with camera">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <span className="hidden sm:inline">Camera</span>
        </Button>
      </div>
      {cameraOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
              <Spinner className="h-8 w-8 text-white" />
            </div>
          }
        >
          <CameraScanner
            onDetected={(code) => {
              setCameraOpen(false);
              submit(code);
            }}
            onClose={() => {
              setCameraOpen(false);
              inputRef.current?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
