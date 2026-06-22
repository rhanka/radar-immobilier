import "../../src/app.css";
import { mount } from "svelte";
import RailFilterHarness from "./RailFilterHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

mount(RailFilterHarness, { target });
