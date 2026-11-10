import { type KeyboardEvent, type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import type { ActivityWindow } from '../../shared';

export const minTimelineWindow = 5 * 60_000;

const sameWindow = (a: ActivityWindow, b: ActivityWindow) => a.from === b.from && a.until === b.until;

export function placeWindow(base: ActivityWindow, from: number, size: number): ActivityWindow {
  const total = base.until - base.from;
  const length = Math.min(total, Math.max(minTimelineWindow, Math.round(size)));
  const left = Math.max(base.from, Math.min(base.until - length, Math.round(from)));
  return { from: left, until: left + length };
}

export function zoomWindow(base: ActivityWindow, view: ActivityWindow, factor: number, anchor: number) {
  const current = view.until - view.from;
  const size = Math.min(base.until - base.from, Math.max(minTimelineWindow, Math.round(current * factor)));
  return placeWindow(base, view.from + (current - size) * anchor, size);
}

export function timeInView(view: ActivityWindow, at: number) {
  return at >= view.from && at < view.until;
}

type Plot = { left: number; width: number };

type Gesture = { id: number; x: number; y: number; width: number; start: ActivityWindow; dragging: boolean };

export function useTimelineNavigation<T extends Element>({ base, view, plot, onView, onClear, selectedAt }: {
  base: ActivityWindow; view: ActivityWindow; plot: (element: T) => Plot;
  onView: (next: ActivityWindow) => void; onClear: () => void; selectedAt?: number;
}) {
  const ref = useRef<T>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ fraction: number; label?: string } | null>(null);
  const size = view.until - view.from;
  const fullSize = base.until - base.from;
  const canPan = size < fullSize;

  function apply(next: ActivityWindow) {
    if (!sameWindow(next, view)) onView(next);
  }

  function pan(fraction: number) {
    apply(placeWindow(base, view.from + size * fraction, size));
  }

  function zoom(factor: number, at = selectedAt) {
    const position = at !== undefined && timeInView(view, at) ? (at - view.from) / size : 0.5;
    apply(zoomWindow(base, view, factor, position));
  }

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (gesture.current?.dragging) return;
      const { left, width } = plot(element);
      const position = (event.clientX - left) / width;
      if (!(position >= 0 && position <= 1)) return;
      if (event.ctrlKey && event.deltaY) {
        event.preventDefault();
        const next = zoomWindow(base, view, event.deltaY < 0 ? 0.8 : 1.25, position);
        if (!sameWindow(view, next)) onView(next);
      } else if (canPan && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
        const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
        if (!delta) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
        const next = placeWindow(base, view.from + delta * unit / width * size, size);
        if (!sameWindow(view, next)) onView(next);
      }
    };
    element.addEventListener('wheel', wheel as EventListener, { passive: false });
    return () => element.removeEventListener('wheel', wheel as EventListener);
  }, [base, canPan, onView, plot, size, view]);

  function onPointerDown(event: PointerEvent<T>) {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    const { left, width } = plot(event.currentTarget);
    if (!canPan || event.clientX < left || event.clientX > left + width) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width, start: view, dragging: false };
  }

  function onPointerMove(event: PointerEvent<T>) {
    const active = gesture.current;
    if (active?.id === event.pointerId && (event.buttons & 1)) {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (!active.dragging && Math.abs(dx) >= 5 && Math.abs(dx) > Math.abs(dy)) {
        active.dragging = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        setHover(null);
      }
      if (active.dragging) {
        const length = active.start.until - active.start.from;
        apply(placeWindow(base, active.start.from - dx / active.width * length, length));
        return;
      }
    }
    if (event.pointerType === 'touch') return;
    const { left, width } = plot(event.currentTarget);
    const fraction = (event.clientX - left) / width;
    const label = event.target instanceof Element ? event.target.closest('[data-timeline-label]')?.getAttribute('data-timeline-label') : null;
    setHover(fraction >= 0 && fraction <= 1 ? { fraction, label: label ?? undefined } : null);
  }

  function end(event: PointerEvent<T>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<T>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    switch (event.key) {
      case 'ArrowLeft': if (!canPan) return; pan(-0.25); break;
      case 'ArrowRight': if (!canPan) return; pan(0.25); break;
      case '+': case '=': zoom(0.5); break;
      case '-': zoom(2); break;
      case 'Escape': onClear(); break;
      default: return;
    }
    event.preventDefault();
  }

  return {
    ref, pan, zoom, canPan, dragging,
    hover: hover && { ...hover, at: Math.min(view.until - 1, view.from + hover.fraction * size) },
    handlers: {
      onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end, onKeyDown,
      onPointerLeave: () => {
        if (!gesture.current?.dragging) gesture.current = null;
        setHover(null);
      },
      onClickCapture: (event: MouseEvent<T>) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    },
  };
}
