// Inter self-hosté (famille « Inter » = token --st-font-sans du thème sent-tech).
// Le DS porte le font-family via la var mais NE charge PAS les fichiers (volontaire) :
// c'est au consommateur de servir Inter. On self-host (déterministe, pas de dépendance
// réseau Google Fonts / CSP en prod). Poids utilisés par l'UI : 400/500/600/700.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root");
}

const app = mount(App, { target });

export default app;
