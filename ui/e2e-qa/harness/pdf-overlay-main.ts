/**
 * Harnais QA — monte SignalPdfOverlay EN ISOLATION pour le QA navigateur du
 * rendu pdf.js (bug #5). On teste le pipeline RÉEL : worker pdf.js bundlé par
 * Vite (?url), getDocument sur l'URL /api/documents/raw (mockée par Playwright
 * avec un vrai PDF), rendu canvas. Aucune donnée backend, aucun stack docker.
 *
 * Props pilotées par la query string :
 *   ?rawRef=...     → l'overlay construit /api/documents/raw?rawRef=... et le
 *                     RENDU pdf.js passe par cette route interne (same-origin,
 *                     CORS-safe) — PRIORITAIRE sur sourceUrl pour le rendu.
 *   ?sourceUrl=...  → URL publique de la ville ; sert au lien « Ouvrir » (et au
 *                     rendu UNIQUEMENT quand aucun rawRef n'est fourni).
 */
import "../../src/app.css";
import { mount } from "svelte";
import SignalPdfOverlay from "../../src/lib/components/maps/SignalPdfOverlay.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

const params = new URLSearchParams(window.location.search);
const rawRef = params.get("rawRef");
const sourceUrl = params.get("sourceUrl");
// `page` et `excerpt` pilotent le surlignage : la QA #82/#83 ouvre le PV sur
// une page cible et fournit l'extrait cité à surligner.
const pageParam = params.get("page");
const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
const excerpt = params.get("excerpt");

// LOT 2 (#84) : `signals` (JSON encodé) pilote le surlignage MULTI-signaux —
// liste de { id, label, excerpt, page, color, current }. Absent ⇒ mode
// mono-signal LOT 1 (prop `excerpt`).
const signalsParam = params.get("signals");
let signals: unknown[] = [];
if (signalsParam) {
  try {
    const parsed = JSON.parse(signalsParam);
    if (Array.isArray(parsed)) signals = parsed;
  } catch {
    signals = [];
  }
}

mount(SignalPdfOverlay, {
  target,
  props: {
    title: "Preuve QA",
    rawRef: rawRef ?? null,
    sourceUrl: sourceUrl ?? null,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    excerpt: excerpt ?? null,
    signals: signals as never,
    onClose: () => {},
  },
});
