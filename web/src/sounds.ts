/** צלילי ממשק (נוצרו ב-SoundCraft, design/sounds). נטענים רק בשימוש הראשון; אפשר להשתיק. */
import { load, save } from "./storage.ts";

export type Sound = "add-to-cart" | "remove" | "scan-beep" | "best-price";
const K_MUTE = "sal.mute";
const cache = new Map<Sound, HTMLAudioElement>();
let muted = load<boolean>(K_MUTE, false);

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  save(K_MUTE, m);
}

export function play(s: Sound) {
  if (muted || typeof Audio === "undefined") return;
  try {
    let a = cache.get(s);
    if (!a) {
      a = new Audio(`${import.meta.env.BASE_URL}sounds/${s}.wav`);
      a.volume = s === "best-price" ? 0.35 : 0.3;
      cache.set(s, a);
    }
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* בלי צליל זה בסדר */
  }
}
