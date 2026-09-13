<script>
  import { serviceIcons } from './service-icons.js';
  let { kind } = $props();
  let icon = $derived(serviceIcons[kind]);
</script>
<svg class="service-icon" data-service-icon={kind} viewBox="0 0 64 64" aria-hidden="true">
  <path d="M7 54L32 42L57 54L32 64Z" fill="#dceaff" />
  <path d={icon.face} fill="#639dff" stroke="#3f7ae0" stroke-width="1.5" stroke-linejoin="round" />
  <path d={icon.lines} fill="none" stroke={kind === 'join' || kind === 'graph' || kind === 'network' ? '#3575d9' : '#e6f0ff'} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  {#if icon.text}<text x="32" y="47" text-anchor="middle" fill="white" font-size="13" font-weight="750">{icon.text}</text>{/if}
</svg>
<style>
  svg { width: 52px; height: 52px; flex: 0 0 52px; overflow: visible; }
</style>
