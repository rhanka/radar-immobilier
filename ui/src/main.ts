// Inter VARIABLE self-hostée (axe wght 100..900 continu). INDISPENSABLE : les
// composants DS (AppHeader/AppChrome) utilisent des poids intermédiaires (550/650/760).
// Une Inter STATIQUE (400/500/600/700) ferait arrondir 650→700 et 550→600 (algo CSS
// Fonts L4) → header « trop gras ». La variable rend chaque poids exact, comme l'ancien
// @import Google `wght@100..900`, mais sans dépendance réseau. Le token --st-font-sans
// est mené sur « Inter Variable » dans app.css (famille réellement enregistrée).
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initializeMaplibreWorker } from "./lib/maps/maplibre-worker";
import {
  initServiceWorker,
  publishServiceWorkerClient,
} from "./lib/sw/client";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root");
}

async function bootstrap(root: HTMLElement) {
  await initializeMaplibreWorker();
  const app = mount(App, { target: root });
  // Service worker: local-client coordination + its own update cycle only.
  // Registered after the mount, never blocking startup; the app and the
  // local sync stay fully usable when the worker is unsupported.
  publishServiceWorkerClient(initServiceWorker({
    onInvalidation: () => window.dispatchEvent(new Event("immo:coordination-invalidated")),
    onSessionInvalidated: (payload) => window.dispatchEvent(new CustomEvent("immo:session-invalidated", { detail: payload })),
  }));
  return app;
}

export default bootstrap(target);
