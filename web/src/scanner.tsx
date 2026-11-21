/**
 * סורק ברקודים: BarcodeDetector מובנה כשיש (Chrome Android, Safari 17+), ZXing כגיבוי.
 * נשאר פתוח אחרי סריקה כדי לסרוק כמה מוצרים ברצף; אותו קוד לא נקלט פעמיים תוך 2.5 שניות.
 */
import { useEffect, useRef, useState } from "preact/hooks";

declare global {
  interface Window { BarcodeDetector?: any }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"];

export function Scanner(props: { onCode: (code: string) => Promise<string>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("מפעיל מצלמה…");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [count, setCount] = useState(0);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);

  const handle = async (code: string) => {
    const now = Date.now();
    if (busy.current || (code === last.current.code && now - last.current.at < 2500)) return;
    last.current = { code, at: now };
    busy.current = true;
    try {
      navigator.vibrate?.(40);
      const msg = await props.onCode(code);
      setStatus(msg);
      if (!msg.startsWith("לא")) setCount((c) => c + 1);
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    let zxingControls: { stop(): void } | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        let detector: any = null;
        if (window.BarcodeDetector) {
          try {
            const supported: string[] = await window.BarcodeDetector.getSupportedFormats();
            const fmts = FORMATS.filter((f) => supported.includes(f));
            if (fmts.length) detector = new window.BarcodeDetector({ formats: fmts });
          } catch { detector = null; }
        }
        if (detector) {
          setStatus("כוונו את המצלמה לברקוד");
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (codes?.length) await handle(String(codes[0].rawValue));
            } catch { /* פריים לא מוכן */ }
            timer = window.setTimeout(tick, 120);
          };
          tick();
        } else {
          setStatus("טוען סורק…");
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          setStatus("כוונו את המצלמה לברקוד");
          zxingControls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) handle(result.getText());
          });
        }
      } catch (e: any) {
        const name = e?.name ?? "";
        setError(
          name === "NotAllowedError"
            ? "אין הרשאה למצלמה. אפשר לאשר בהגדרות הדפדפן, או להקליד ברקוד למטה."
            : "לא הצלחנו להפעיל מצלמה. אפשר להקליד ברקוד למטה.",
        );
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="scanner" role="dialog" aria-modal="true" aria-label="סריקת ברקוד">
      <div class="scanner-top">
        <button class="btn ghost on-dark" onClick={props.onClose} aria-label="סגירת הסורק">✕ סגירה</button>
        <span class="scan-count" aria-live="polite">{count ? `נסרקו ${count}` : ""}</span>
      </div>
      <div class="scanner-view">
        {!error && <video ref={videoRef} playsInline muted aria-hidden="true" />}
        {!error && <div class="scan-frame" aria-hidden="true" />}
        {error && <p class="scan-error" role="alert">{error}</p>}
      </div>
      <p class="scan-status" aria-live="polite">{status}</p>
      <form
        class="scan-manual"
        onSubmit={(e) => {
          e.preventDefault();
          const c = manual.replace(/\D/g, "");
          if (c) { last.current = { code: "", at: 0 }; handle(c); setManual(""); }
        }}
      >
        <label class="sr-only" for="manual-code">הקלדת ברקוד</label>
        <input id="manual-code" inputMode="numeric" pattern="[0-9]*" placeholder="או הקלידו ברקוד" value={manual}
          onInput={(e) => setManual((e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit">הוספה</button>
      </form>
    </div>
  );
}
