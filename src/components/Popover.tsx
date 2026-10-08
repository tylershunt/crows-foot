import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  /** The control that opened the popover, which it opens above or below. */
  anchor: HTMLElement;
  /** The element whose right edge the popover's right edge meets; the anchor by default. */
  edge?: HTMLElement | null;
  /** Called on Escape, and on a click or scroll anywhere outside the popover and its anchor. */
  onClose: () => void;
  label: string;
  width: number;
  maxHeight: number;
  children: ReactNode;
}

const GAP = 4;

/**
 * A panel floating over the window beside `anchor`, drawn above any container
 * that would clip it.
 */
export function Popover({ anchor, edge, onClose, label, width, maxHeight, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePlacement(anchor, edge ?? anchor, maxHeight);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (panelRef.current?.contains(target) || anchor.contains(target));
    const onPointer = (event: MouseEvent) => !inside(event.target) && onClose();
    const onScroll = (event: Event) => !inside(event.target) && onClose();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && (event.stopPropagation(), onClose());

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{ ...position, width, maxHeight }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-white text-xs shadow-xl dark:border-ink-700 dark:bg-ink-900"
    >
      {children}
    </div>,
    document.body,
  );
}

/** Opens below the anchor, or above it where the window runs out, its right edge on `edge`'s. */
function usePlacement(
  anchor: HTMLElement,
  edge: HTMLElement,
  height: number,
): { top?: number; bottom?: number; right: number } {
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const right = Math.max(GAP, clientWidth - edge.getBoundingClientRect().right);
    return rect.bottom + GAP + height <= clientHeight
      ? { top: rect.bottom + GAP, right }
      : { bottom: clientHeight - rect.top + GAP, right };
  };
  const [position, setPosition] = useState(place);

  useLayoutEffect(() => {
    const onResize = () => setPosition(place());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  return position;
}
