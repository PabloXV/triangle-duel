// Images made from SVG markup (faces, stock icons, baked platforms, texture
// tiles): one way to encode them, and a keyed cache that starts loading on
// first ask and returns null until the image is ready (the caller just skips
// drawing it for a frame or two).

/** SVG markup as a data URL, for an <img> or a CSS url(). */
export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/**
 * A cache of SVG-made images, keyed. `ready` turns the loaded image into what's
 * stored (e.g. a raster canvas). It keeps at most `max` items, dropping the
 * least recently used (and calling `dispose` on it): phones cap total canvas
 * memory, and an ever-growing cache (every face of every bot of every menu
 * match) eventually made new canvases fail, so some faces never showed.
 */
export class SvgImages<T = HTMLImageElement> {
  private items = new Map<string, T | null>(); // null = loading; Map order = least recently used first
  /** How many images have been started (for tests: a stable cache stops growing this). */
  loads = 0;

  constructor(
    private ready: (img: HTMLImageElement) => T = (img) => img as unknown as T,
    private max = 96,
    private dispose: (item: T) => void = () => {},
  ) {}

  /** The image for `key` (building its SVG with `svg()` the first time), or null while it loads. */
  get(key: string, svg: () => string): T | null {
    const hit = this.items.get(key);
    if (hit !== undefined) {
      this.items.delete(key); // mark as recently used
      this.items.set(key, hit);
      return hit;
    }
    this.items.set(key, null);
    this.loads++;
    this.evict();
    const img = new Image();
    img.onload = () => {
      if (!this.items.has(key)) return; // evicted while loading
      try {
        this.items.set(key, this.ready(img));
      } catch {
        this.items.delete(key); // e.g. no canvas memory left: try again later
      }
    };
    img.onerror = () => this.items.delete(key);
    img.src = svgDataUrl(svg());
    return null;
  }

  private evict() {
    while (this.items.size > this.max) {
      const [oldest, item] = this.items.entries().next().value!;
      this.items.delete(oldest);
      if (item) this.dispose(item);
    }
  }

  /** How many are ready (for tests). */
  get readyCount(): number {
    return [...this.items.values()].filter((v) => v !== null).length;
  }
}
