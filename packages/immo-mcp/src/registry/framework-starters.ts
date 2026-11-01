import { STARTER_INDEX_HTML } from "./starter-files.js";

// The four framework shells reuse exactly the qualified DS markup and H5
// client. Compile framework source ahead of publication; no runtime compiler,
// dynamic stylesheet injection, external CDN or new content-host route.
const shell = STARTER_INDEX_HTML.split("<body>\n")[1]!.split("<script src=")[0]!.trim();
const file = (path: string, text: string) => ({ path, text });
export const FRAMEWORK_STARTERS = [
  {
    framework: "plain JS", templateId: "immo.baskets.native.v1",
    fastPath: "Publish starter.files directly. Configure workspaceId and citySlug explicitly; no build required.",
    files: [],
  },
  {
    framework: "React", templateId: "immo.baskets.react.v1",
    package: "@sentropic/design-system-react", packageVersion: "0.36.46",
    fastPath: "Compile this React 18 component with your existing build. Import shell.html as a string. " +
      "Use the native DS CSS fast path today. Full SentropicDS components require DS styles + ThemeProvider; " +
      "that runtime is deferred because its injected style violates the current CSP. Never write your own palette.",
    files: [file("shell.html", shell), file("App.jsx", `import { useEffect, useRef } from "react";
import shell from "./shell.html?raw";
export default function App() {
  const root = useRef(null);
  useEffect(() => window.ImmoArtifact.mount(root.current), []);
  return <div ref={root} dangerouslySetInnerHTML={{ __html: shell }} />;
}
`)],
  },
  {
    framework: "Svelte", templateId: "immo.baskets.svelte.v1",
    package: "@sentropic/design-system-svelte", packageVersion: "0.35.0",
    fastPath: "Compile App.svelte with Vite/Svelte, extracting CSS. The native DS markup is the qualified fast path; " +
      "the inventoried Svelte DS binding exists but its complete runtime is a separate CSP qualification.",
    files: [file("shell.html", shell), file("App.svelte", `<script>
import { onMount } from "svelte";
import shell from "./shell.html?raw";
let root;
onMount(() => window.ImmoArtifact.mount(root));
</script>
<div bind:this={root}>{@html shell}</div>
`)],
  },
  {
    framework: "Vue", templateId: "immo.baskets.vue.v1",
    package: "@sentropic/design-system-vue", packageVersion: "0.37.0",
    fastPath: "Compile this Vue 3 single-file component ahead of publication (no runtime template compiler). " +
      "Use the native DS CSS fast path; the inventoried Vue DS binding needs separate runtime CSP qualification.",
    files: [file("shell.html", shell), file("App.vue", `<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import shell from "./shell.html?raw";
const root = ref(null);
let dispose;
onMounted(() => { dispose = window.ImmoArtifact.mount(root.value); });
onBeforeUnmount(() => dispose?.());
</script>
<template><div ref="root" v-html="shell"></div></template>
`)],
  },
  {
    framework: "Angular", templateId: "immo.baskets.angular.v1",
    package: "@sentropic/design-system-angular", packageVersion: "0.37.0",
    fastPath: "Compile the standalone component with Angular AOT (no JIT/eval). Its template embeds the same " +
      "shell.html markup. Use the native DS CSS fast path; the inventoried Angular binding " +
      "needs separate runtime CSP qualification. Check the compiled files fit the publication budget.",
    files: [file("shell.html", shell), file("app.component.ts", `import { Component, ElementRef, AfterViewInit, OnDestroy, ViewChild } from "@angular/core";
declare global { interface Window { ImmoArtifact: { mount(root: Element): () => void } } }
@Component({ selector: "immo-root", standalone: true, template: ${JSON.stringify("<div #root>" + shell + "</div>")} })
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild("root", { static: true }) root!: ElementRef<HTMLElement>;
  private dispose?: () => void;
  ngAfterViewInit() { this.dispose = window.ImmoArtifact.mount(this.root.nativeElement); }
  ngOnDestroy() { this.dispose?.(); }
}
`)],
  },
].map((starter) => ({ ...starter,
  identity: { catalogId: "immo.artifact-templates", componentId: starter.templateId, contractVersion: "1.0" },
  componentRefs: ["Button", "Input", "Select", "Card", "Tag"].map((componentId) => ({
    catalogId: "@sentropic/design-system-react", componentId, contractVersion: "1.0",
  })),
}));

export const FRAMEWORK_BUILD_RULE = "Keep the starter head, data-st-theme and exact kit links. Replace the " +
  "body main with your framework mount element. Load reader.js then app.js before the compiled framework " +
  "entrypoint. shell.html is trusted template markup, never reader data: render API values as text. " +
  "Publish only compiled HTML/CSS/JS (not JSX, Svelte, Vue or TypeScript sources); extract styles, disable " +
  "dev mode/HMR and runtime compilers. All imports/assets must resolve on the same pinned origin, no eval " +
  "or injected styles. Maximum 32 files and 256 KiB decoded total. Browser-qualify any added runtime under " +
  "the real CSP. The native starter is qualified here; these framework adapters are authoring sources, " +
  "not prebuilt or qualified full framework runtimes. The same ImmoArtifact.mount/dispose, ImmoReader " +
  "and UI-state contract apply to all five paths.";
