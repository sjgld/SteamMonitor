export const paths = {
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-4a4 4 0 0 1 0 8',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-2a7 7 0 0 1 12-4l3 3M4 15l3 3a7 7 0 0 0 12-4',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.3-4.3m2.3-5.7a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  star: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  arrow: 'm9 5 7 7-7 7',
  external: 'M13 5h6v6m0-6-9 9m7-1v6H5V7h6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  edit: 'm4 16 12-12 4 4L8 20H4zm9-9 4 4',
  game: 'M7 7h10c2 0 4 2 4 5l1 4c.5 3-2 4-4 2l-2-2H8l-2 2c-2 2-4.5 1-4-2l1-4c0-3 2-5 4-5zm0 3v4m-2-2h4m6 0h.01m3 0h.01',
  close: 'm6 6 12 12M18 6 6 18',
  review: 'M4 20h16M6 16v-4m6 4V4m6 12V8',
  radar: 'M12 12l7-7m2 7a9 9 0 1 1-9-9m5 9a5 5 0 1 1-5-5m0 5h.01',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  database: 'M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6m-16 6v6c0 2 3.6 3 8 3s8-1 8-3v-6',
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
