<script lang="ts">
  // Every menu screen's frame: a title (or a custom header), a body that
  // scrolls inside the panel when it's tall, and a footer for the main actions
  // that's always visible. So nothing important ends up below the fold, and
  // screens share one layout.
  import type { Snippet } from "svelte";

  let {
    title,
    size = "",
    header,
    children,
    footer,
  }: { title?: string; size?: "" | "wide" | "narrow"; header?: Snippet; children: Snippet; footer?: Snippet } = $props();
</script>

<section class="card panel {size}">
  {#if header}{@render header()}{:else if title}<h2>{title}</h2>{/if}
  <div class="panel-body">{@render children()}</div>
  {#if footer}<div class="panel-footer">{@render footer()}</div>{/if}
</section>
