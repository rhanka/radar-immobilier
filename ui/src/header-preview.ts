import "./app.css";
import { mount } from "svelte";
import HeaderPreview from "./HeaderPreview.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app root");
}
export default mount(HeaderPreview, { target });
