import { protocol } from 'electron';
import type { GameAssets } from '../steam/artwork';

const scheme = 'steam-art';

/** Must run before the app is ready. */
export function registerArtScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true } }]);
}

/** Serves cached game artwork as steam-art://game/<appId> and steam-art://icon/<appId>. */
export function handleArtProtocol(assets: GameAssets) {
  protocol.handle(scheme, async request => {
    const match = /^steam-art:\/\/(game|icon)\/([1-9]\d{0,7})$/.exec(request.url);
    const image = match && request.method === 'GET' ? await assets.image(match[2], match[1] === 'icon' ? 'icon' : 'image') : null;
    if (!image) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(new Uint8Array(image).buffer, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' } });
  });
}
