<script lang="ts">
  // − value + control.
  let {
    value = $bindable(),
    min,
    max,
    label,
    disabled = false,
    onChange,
  }: { value: number; min: number; max: number; label: string; disabled?: boolean; onChange?: (v: number) => void } = $props();

  function set(v: number) {
    value = v;
    onChange?.(v);
  }
</script>

<div class="stepper">
  <button onclick={() => set(value - 1)} disabled={disabled || value <= min} aria-label={`fewer ${label}`}>−</button>
  <output aria-label={label}>{value}</output>
  <button onclick={() => set(value + 1)} disabled={disabled || value >= max} aria-label={`more ${label}`}>+</button>
</div>

<style>
  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  button {
    width: 2.25rem;
    padding: 0.35rem 0 !important;
  }
  output {
    min-width: 1.5rem;
    text-align: center;
    font-size: 1.2rem;
    font-weight: 700;
  }
</style>
