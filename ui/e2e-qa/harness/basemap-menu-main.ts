/**
 * Point d'entrée du harnais §5 R3 P1+P3 (menu « Fond de carte »). Monte
 * `BasemapMenuHarness` (qui monte le VRAI `GeoCityMapBase` avec le contrôle de
 * fond activé) puis marque `#ready` — le rendu des contrôles bas-droit ne dépend
 * PAS de l'init MapLibre (WebGL indisponible en headless), donc le trigger
 * `Layers` et son popover sont pilotables dès le montage.
 */
import "../../src/app.css";
import { mount } from "svelte";
import BasemapMenuHarness from "./BasemapMenuHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

mount(BasemapMenuHarness, { target });

const ready = document.getElementById("ready");
if (ready) ready.textContent = "ready";
