// Images made from SVG markup (faces, stock icons, baked platforms, texture
// tiles): one way to encode them, and a keyed cache that starts loading on
// first ask and returns null until the image is ready (the caller just skips
// drawing it for a frame or two).

/** SVG markup as a data URL, for an <img> or a CSS url(). */
export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** A cache of SVG-made images, keyed; `ready` turns the loaded image into what's stored (e.g. a raster canvas). */
export class SvgImages<T = HTMLImageElement> {
  private items = new Map<string, T | null>(); // null = loading

  constructor(private ready: (img: HTMLImageElement) => T = (img) => img as unknown as T) {}

  /** The image for `key` (building its SVG with `svg()` the first time), or null while it loads. */
  get(key: string, svg: () => string): T | null {
    const hit = this.items.get(key);
    if (hit !== undefined) return hit;
    this.items.set(key, null);
    const img = new Image();
    img.onload = () => this.items.set(key, this.ready(img));
    img.onerror = () => this.items.delete(key);
    img.src = svgDataUrl(svg());
    return null;
  }

  /** How many are ready (for tests). */
  get readyCount(): number {
    return [...this.items.values()].filter((v) => v !== null).length;
  }
}
