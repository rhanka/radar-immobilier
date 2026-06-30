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

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root");
}

const app = mount(App, { target });

export default app;
