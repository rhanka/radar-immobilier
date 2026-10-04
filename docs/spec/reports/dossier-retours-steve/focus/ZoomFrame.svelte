<script>
  // Zoom and pan for every diagram of the page, without dependency.
  //   transform mode: the content (SVG or HTML) sits on a stage scaled and translated by
  //     CSS. In the page: fit to width, + / − / ajuster / 1:1, drag to pan, Ctrl+molette
  //     (or trackpad pinch) to zoom, two-finger pinch on touch screens.
  //   native mode (SvelteFlow scenes): the scene keeps its own zoom; the frame only adds
  //     the full-screen view.
  // « Agrandir » turns the same element into a full-screen overlay (no copy of the
  // content): molette and pinch zoom, drag to pan, + / − / ajuster, Échap to close.
  import { tick } from 'svelte';
  let { id, label, width = null, minWidth = 0, inline = true, mode = 'transform', children } = $props();

  let open = $state(false), scale = $state(1), tx = $state(0), ty = $state(0), touched = $state(false);
  let viewport = $state(), stage = $state(), closeButton = $state();
  let viewW = $state(0), viewH = $state(0), naturalH = $state(0), pageW = $state(0);
  const MIN = 0.1, MAX = 4;
  // Natural size of the content: the given width (SVG canvas) or the page width (HTML).
  // HTML content takes the page width, but never less than minWidth (scaled down on phones).
  const naturalW = $derived(width ?? Math.max(minWidth, pageW || viewW || 1));
  const fitScale = () => open
    ? Math.min(MAX, Math.max(MIN, Math.min((viewW - 32) / naturalW, (viewH - 32) / Math.max(naturalH, 1))))
    : Math.min(1, viewW / naturalW);
  const center = () => {
    const margin = open ? 16 : 0;
    tx = Math.max(margin, (viewW - naturalW * scale) / 2);
    ty = open ? Math.max(margin, (viewH - naturalH * scale) / 2) : 0;
  };
  function fit() { scale = fitScale(); center(); touched = false; }
  function actual() { scale = 1; tx = open ? 16 : 0; ty = open ? 16 : 0; touched = true; }
  function zoomAt(factor, x = viewW / 2, y = (open ? viewH : inlineH) / 2) {
    const next = Math.min(MAX, Math.max(MIN, scale * factor));
    tx = x - (x - tx) * (next / scale); ty = y - (y - ty) * (next / scale);
    scale = next; touched = true;
  }
  // In the page the panel keeps its fitted height; once zoomed it may grow up to 80 % of
  // the window so that the zoomed area stays usable.
  const fitH = $derived(naturalH * Math.min(1, viewW / naturalW));
  const inlineH = $derived(touched ? Math.max(fitH, Math.min(naturalH * scale, (typeof innerHeight === 'number' ? innerHeight : 900) * 0.8)) : fitH);

  $effect(() => {
    if (mode !== 'transform' || !viewport || !stage) return;
    const observer = new ResizeObserver(() => {
      viewW = viewport.clientWidth; viewH = viewport.clientHeight;
      if (!open) pageW = viewport.clientWidth;
      naturalH = stage.offsetHeight;
      if (!touched) fit();
    });
    observer.observe(viewport); observer.observe(stage);
    return () => observer.disconnect();
  });

  async function enter() {
    open = true; touched = false;
    document.documentElement.classList.add('zoom-frame-open');
    await tick();
    closeButton?.focus();
    if (mode === 'transform') { viewW = viewport.clientWidth; viewH = viewport.clientHeight; fit(); }
  }
  async function leave() {
    open = false; touched = false;
    document.documentElement.classList.remove('zoom-frame-open');
    await tick();
    if (mode === 'transform') { viewW = viewport.clientWidth; fit(); }
  }
  function keydown(event) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); leave(); }
    else if (mode === 'transform' && (event.key === '+' || event.key === '=')) zoomAt(1.25);
    else if (mode === 'transform' && event.key === '-') zoomAt(0.8);
    else if (mode === 'transform' && event.key === '0') fit();
  }
  function wheel(event) {
    if (!open && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  }
  // Pointer pan (one pointer) and pinch zoom (two pointers).
  const pointers = new Map();
  let last = null, pinch = null;
  function down(event) {
    if (event.target.closest('button, a, input, select, textarea')) return;
    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) last = { x: event.clientX, y: event.clientY };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) }; }
  }
  function move(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), rect = viewport.getBoundingClientRect();
      zoomAt(distance / pinch.distance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      pinch.distance = distance;
    } else if (pointers.size === 1 && last) {
      tx += event.clientX - last.x; ty += event.clientY - last.y; touched = true;
      last = { x: event.clientX, y: event.clientY };
    }
  }
  function up(event) { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; last = pointers.size === 1 ? { ...[...pointers.values()][0] } : null; }
</script>

<svelte:window onkeydown={keydown} />

<div class="zoom-frame" class:fullscreen={open} class:native={mode === 'native'} data-zoom={id} data-zoom-mode={mode} data-zoom-open={open}
  data-scale={mode === 'transform' ? scale.toFixed(3) : undefined} role={open ? 'dialog' : undefined} aria-modal={open ? 'true' : undefined} aria-label={open ? label : undefined}>
  <div class="zoom-tools" role="toolbar" aria-label={`Zoom : ${label}`}>
    {#if open}<strong class="zoom-title">{label}</strong>{/if}
    {#if mode === 'transform' && (open || inline)}
      <button type="button" data-action="zoom-out" aria-label="Zoom arrière" onclick={() => zoomAt(0.8)}>−</button>
      <button type="button" data-action="zoom-in" aria-label="Zoom avant" onclick={() => zoomAt(1.25)}>+</button>
      <button type="button" data-action="fit" aria-pressed={!touched} onclick={fit}>Ajuster</button>
      <button type="button" data-action="actual-size" aria-pressed={touched && Math.abs(scale - 1) < 0.001} onclick={actual}>1:1</button>
    {/if}
    {#if open}
      <button type="button" data-action="close" bind:this={closeButton} onclick={leave}>Fermer (Échap)</button>
    {:else}
      <button type="button" data-action="expand" onclick={enter} aria-label={`Agrandir : ${label}`}>⤢ Agrandir</button>
    {/if}
  </div>
  {#if mode === 'transform'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="zoom-viewport" bind:this={viewport} style={open ? undefined : `height:${Math.ceil(inlineH)}px`}
      onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
      <div class="zoom-stage" bind:this={stage} style={`width:${naturalW}px;transform:translate(${tx}px,${ty}px) scale(${scale})`}>
        {@render children()}
      </div>
    </div>
  {:else}
    <div class="zoom-native">{@render children()}</div>
  {/if}
</div>

<style>
  .zoom-frame { position: relative; min-width: 0; }
  .zoom-tools { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; padding: 6px 8px;
    border-bottom: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .zoom-tools button { min-width: 34px; padding: 4px 10px; font-size: .8rem; font-weight: 700; background: var(--st-semantic-surface-default); color: var(--st-semantic-text-primary); }
  .zoom-tools button[aria-pressed='true'] { border-color: var(--st-semantic-action-primary); color: var(--st-semantic-action-primary); }
  .zoom-title { margin-right: auto; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .zoom-viewport { position: relative; overflow: hidden; touch-action: pan-y; cursor: grab; }
  .zoom-viewport:active { cursor: grabbing; }
  .zoom-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .fullscreen { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; background: var(--st-semantic-surface-default); }
  .fullscreen .zoom-viewport { flex: 1; touch-action: none; background: var(--st-semantic-surface-default); }
  .fullscreen .zoom-native { flex: 1; min-height: 0; }
  .fullscreen .zoom-native :global(.flow) { height: 100%; min-height: 0; }
  :global(html.zoom-frame-open) { overflow: hidden; }
</style>
