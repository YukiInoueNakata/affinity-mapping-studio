import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseResizableWidthOptions {
  /** Initial width in pixels (used when no stored value). */
  initial: number;
  min: number;
  max: number;
  /** 'right' means the drag handle is on the *right* edge of the element (drag right → wider).
   *  'left' means the handle is on the *left* edge (drag left → wider). */
  direction: 'right' | 'left';
  /** localStorage key for persistence (optional). */
  storageKey?: string;
}

export interface ResizableWidthApi {
  width: number;
  setWidth: (n: number) => void;
  startDrag: (e: React.MouseEvent | React.PointerEvent) => void;
  resetWidth: () => void;
  isDragging: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function loadStored(key: string | undefined, fallback: number): number {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function useResizableWidth(opts: UseResizableWidthOptions): ResizableWidthApi {
  const [width, setWidthState] = useState<number>(() =>
    clamp(loadStored(opts.storageKey, opts.initial), opts.min, opts.max)
  );
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (!opts.storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(opts.storageKey, String(width));
    } catch {
      // ignore
    }
  }, [width, opts.storageKey]);

  const setWidth = useCallback(
    (n: number) => setWidthState(clamp(n, opts.min, opts.max)),
    [opts.min, opts.max]
  );

  const resetWidth = useCallback(() => {
    setWidthState(clamp(opts.initial, opts.min, opts.max));
  }, [opts.initial, opts.min, opts.max]);

  const startDrag = useCallback(
    (startEvent: React.MouseEvent | React.PointerEvent) => {
      startEvent.preventDefault();
      const startWidth = widthRef.current;
      const startX = startEvent.clientX;
      setIsDragging(true);
      const onMove = (e: MouseEvent) => {
        const dx = e.clientX - startX;
        const delta = opts.direction === 'right' ? dx : -dx;
        setWidthState(clamp(startWidth + delta, opts.min, opts.max));
      };
      const onUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [opts.direction, opts.min, opts.max]
  );

  return { width, setWidth, startDrag, resetWidth, isDragging };
}
