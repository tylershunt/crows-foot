import { useEffect, useRef } from "react";

const SHOWN_AFTER_LAST_SCROLL_MS = 900;

/**
 * Shows a scroller's scrollbar while it scrolls and for a moment after.
 *
 * Attach `ref` to an element with the `scrollbar-while-scrolling` class. The
 * hook adds `scrolling` to it on each scroll and removes it once scrolling stops.
 */
export function useScrollbarWhileScrolling<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      element.classList.add("scrolling");
      clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove("scrolling"), SHOWN_AFTER_LAST_SCROLL_MS);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  return ref;
}
