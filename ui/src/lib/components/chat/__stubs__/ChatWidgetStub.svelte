<script lang="ts">
  // Stub léger de @sentropic/chat-ui ChatWidget pour tester le SHELL ChatDock
  // sans monter le contenu streaming réel. Les autres props passées par l'hôte
  // (chatTabLabel/queueTabLabel/showCommentsTab/renderChatPanel) sont ignorées
  // via $$restProps — seul widgetLabel est reflété.
  export let widgetLabel = "";
</script>

<div data-testid="chat-widget-stub" aria-label={widgetLabel}></div>
