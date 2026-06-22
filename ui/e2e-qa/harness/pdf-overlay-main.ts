/**
 * Harnais QA — monte SignalPdfOverlay EN ISOLATION pour le QA navigateur du
 * rendu pdf.js (bug #5). On teste le pipeline RÉEL : worker pdf.js bundlé par
 * Vite (?url), getDocument sur l'URL /api/documents/raw (mockée par Playwright
 * avec un vrai PDF), rendu canvas. Aucune donnée backend, aucun stack docker.
 *
 * Props pilotées par la query string :
 *   ?rawRef=...     → l'overlay construit /api/documents/raw?rawRef=...
 *   ?sourceUrl=...  → URL directe (prioritaire)
 */
import "../../src/app.css";
import { mount } from "svelte";
import SignalPdfOverlay from "../../src/lib/components/maps/SignalPdfOverlay.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

const params = new URLSearchParams(window.location.search);
const rawRef = params.get("rawRef");
const sourceUrl = params.get("sourceUrl");

mount(SignalPdfOverlay, {
  target,
  props: {
    title: "Preuve QA",
    rawRef: rawRef ?? null,
    sourceUrl: sourceUrl ?? null,
    page: 1,
    onClose: () => {},
  },
});
