// Police : on NE charge PAS Inter — parité stricte avec la référence DS. Le site DS
// (design-system.sent-tech.ca), ses docs et dataviz déclarent --st-font-sans: Inter,…
// mais ne chargent jamais les fichiers Inter → le thème sent-tech rend en system-ui
// (les poids DS 550/650/760 sont tunés pour ce rendu). Forcer Inter rendait radar
// « pas la même police » que la référence. On laisse donc le token tomber sur system-ui.
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root");
}

const app = mount(App, { target });

export default app;
