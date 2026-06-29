/**
 * Point d'entrée du harnais NAV (#91/#86/#4). Monte `PdfNavHarness`, qui détient
 * navSignals/navIndex/signals/hover en `$state` et expose
 * `window.__setNavScenario(...)` pour piloter les scénarios à chaud (multi-PDF,
 * hors-filtre, hover) sur UN SEUL montage → cache #89 / waiter #90 préservés.
 */
import "../../src/app.css";
import { mount } from "svelte";
import PdfNavHarness from "./PdfNavHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

mount(PdfNavHarness, { target });
