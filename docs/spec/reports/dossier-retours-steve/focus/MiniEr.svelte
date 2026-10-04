<script>
  // Small entity-relationship diagram of a decision option (option-details.js), laid out
  // in the browser with the same parser, layout and renderer as scene 2.
  import ErDiagram from './ErDiagram.svelte';
  import { parseEr } from './parse-er.mjs';
  import { erLayout } from './diagram-layout.js';
  let { id, spec } = $props();
  const graph = $derived.by(() => {
    const model = parseEr(spec.er, id);
    return { id, relations: model.relations, layout: erLayout(model, spec),
      entities: model.entities.map(entity => ({ ...entity, existing: spec.existing.includes(entity.id), status: spec.status?.[entity.id] })) };
  });
</script>

<ErDiagram {graph} compact />
