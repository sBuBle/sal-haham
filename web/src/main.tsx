import { render } from "preact";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.getElementById("app")!;
root.textContent = "";
render(<App />, root);

// כש-SW חדש לוקח שליטה על דף שכבר רץ עם SW ישן: טוענים את הדף פעם אחת מחדש, כדי לא להישאר על הגרסה הקודמת
if ("serviceWorker" in navigator && import.meta.env.PROD && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    try { if (sessionStorage.getItem("sal.swReloaded")) return; sessionStorage.setItem("sal.swReloaded", "1"); } catch {}
    location.reload();
  });
}
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => {
    // updateViaCache: "none" — sw.js נבדק תמיד מול השרת, כך שגרסה חדשה מזוהה מיד
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" }).then((r) => r.update()).catch((e) => console.warn("SW", e));
  });
}
