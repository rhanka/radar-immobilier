import "@fontsource-variable/inter";
import "@sentropic/design-system-themes/css/sent-tech.css";
import { mount } from "svelte";
import BadgesProposalHarness from "./BadgesProposalHarness.svelte";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

mount(BadgesProposalHarness, { target });
