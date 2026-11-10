// These official Chinese names can be absent from the storefront title field.
const officialNames: Record<string, string> = {
  '289070': '席德·梅尔的文明 VI', // 2K Chinese store
  '2868840': '杀戮尖塔 2', // Steam Chinese store description
};

export function chineseGameName(id: string, title: string | null | undefined) {
  return title && /\p{Script=Han}/u.test(title) ? title : officialNames[id] ?? null;
}

export function officialGameMatches(query: string) {
  return Object.entries(officialNames).filter(([, title]) => title.toLowerCase().includes(query)).map(([id]) => id);
}
