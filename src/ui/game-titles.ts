import { useEffect, useSyncExternalStore } from 'react';
import { isGameAppId } from '../shared';
import { api } from './model';

let titles: ReadonlyMap<string, string> = new Map();
const attempts = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const readTitles = () => titles;

export function useGameTitles() {
  return useSyncExternalStore(subscribe, readTitles);
}

function loadTitle(id: string) {
  if (titles.has(id) || Date.now() < (attempts.get(id) ?? 0)) return;
  attempts.set(id, Date.now() + 2 * 60_000);
  void api.gameTitle(id).then(title => {
    if (!title) return;
    attempts.delete(id);
    titles = new Map(titles).set(id, title);
    for (const listener of listeners) listener();
  }).catch(() => {});
}

export function useLoadGameTitles(ids: Iterable<string | null>) {
  const key = [...new Set([...ids].filter(isGameAppId))].join(',');
  useEffect(() => {
    if (key) key.split(',').forEach(loadTitle);
  }, [key]);
}
