class FallbackDOMMatrixReadOnly {
  readonly m22: number;

  constructor(transform?: string) {
    this.m22 = scaleYFromTransform(transform);
  }
}

export function installDomMatrixReadOnlyPolyfill() {
  if (typeof window === "undefined" || typeof window.DOMMatrixReadOnly === "function") {
    return;
  }

  (window as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = FallbackDOMMatrixReadOnly;
}

function scaleYFromTransform(transform: string | undefined): number {
  if (!transform || transform === "none") {
    return 1;
  }

  const matrix = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrix) {
    const values = matrix[1].split(",").map((value) => Number(value.trim()));
    return Number.isFinite(values[3]) ? values[3] : 1;
  }

  const scale = transform.match(/scale\(([^,\s)]+)/);
  if (scale) {
    const value = Number(scale[1]);
    return Number.isFinite(value) ? value : 1;
  }

  return 1;
}

installDomMatrixReadOnlyPolyfill();
