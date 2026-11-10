import "../../src/app.css";
import { mount } from "svelte";
import FocusSignalHarness from "./FocusSignalHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");
mount(FocusSignalHarness, { target });
