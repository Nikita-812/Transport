// jsdom не реализует 2D-контекст, а ECharts рисует через canvas. Заглушка отвечает на любые вызовы
// контекста: тесты проверяют жизненный цикл графика и подготовку данных, а не пиксели.
const NOOP = (): undefined => undefined;

function createContextStub(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {
    canvas,
    measureText: (text: unknown) => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop: NOOP }),
    createRadialGradient: () => ({ addColorStop: NOOP }),
    createPattern: () => null,
    getLineDash: () => [] as number[],
    getImageData: (_x: number, _y: number, width = 1, height = 1) => ({
      data: new Uint8ClampedArray(Math.max(1, width * height) * 4), width, height,
    }),
  };
  return new Proxy(state, {
    get: (target, prop) => (prop in target ? target[prop as string] : NOOP),
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

export function installCanvasStub(): void {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    const existing = contexts.get(this);
    if (existing) return existing;
    const context = createContextStub(this);
    contexts.set(this, context);
    return context;
  } as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
}
