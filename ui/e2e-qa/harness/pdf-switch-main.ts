/**
 * Point d'entrée du harnais SWITCH/perf du viewer PDF (#89 / #90). Monte
 * `PdfSwitchHarness`, qui détient les props en `$state` et expose
 * `window.__setPdfProps(...)` pour piloter rawRef/page à chaud (un seul
 * montage → cache module-level #89 préservé entre opens).
 */
import "../../src/app.css";
import { mount } from "svelte";
import PdfSwitchHarness from "./PdfSwitchHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

mount(PdfSwitchHarness, { target });
