import { useEffect, useRef, useState } from 'react';

/** The referenced element's width in px, kept current with a ResizeObserver (0 until measured). Lets
 * an SVG chart draw in real pixels — no stretched viewBox, so axis text keeps its size and shape. */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
