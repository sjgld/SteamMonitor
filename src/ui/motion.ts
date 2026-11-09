export function locateElement(element: Element) {
  const rect = element.getBoundingClientRect();
  const viewport = element.closest('.workspace-main')?.getBoundingClientRect();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nearby = viewport && rect.bottom >= viewport.top - 120 && rect.top <= viewport.bottom + 120;
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: !reduced && nearby ? 'smooth' : 'instant' });
  if (element instanceof HTMLElement || element instanceof SVGElement) element.focus({ preventScroll: true });
  if (!reduced) element.animate([{ filter: 'brightness(1.28)' }, { filter: 'brightness(1)' }],
    { duration: 220, easing: 'ease-out' });
}
