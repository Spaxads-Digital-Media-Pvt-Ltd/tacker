import { useEffect, useState, useRef } from 'react';

export function useIntersectionObserver(
  ref: { current: unknown },
  options: IntersectionObserverInit = { threshold: 0, rootMargin: '0px' },
  triggerOnce = true
): boolean {
  const [isIntersecting, setIntersecting] = useState(false);
  const hasTriggered = useRef(false);

  useEffect(() => {
    const target = ref.current;
    if (!(target instanceof Element)) return;
    if (triggerOnce && hasTriggered.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setIntersecting(true);
        if (triggerOnce) {
          hasTriggered.current = true;
          observer.unobserve(target);
        }
      } else if (!triggerOnce) {
        setIntersecting(false);
      }
    }, options);

    observer.observe(target);
    return () => observer.disconnect();
  }, [ref, options.threshold, options.rootMargin, triggerOnce]);

  return isIntersecting;
}
