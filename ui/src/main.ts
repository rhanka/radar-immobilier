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
import { bootArtifactTransport } from "./lib/net/artifact-boot";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root");
}

async function bootstrap(root: HTMLElement) {
  // J1.2d/e: a no-op in the app build; the artifact build aliases it to the
  // transport installer (see vite.config.ts). Runs before any component fetch.
  bootArtifactTransport();
  await initializeMaplibreWorker();
  return mount(App, { target: root });
}

export default bootstrap(target);
