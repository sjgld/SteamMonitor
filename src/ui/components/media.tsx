import { useState } from 'react';
import type { Player } from '../../shared';
import { useLoadGameTitles } from '../lib/game-titles';
import { gameImage } from '../lib/model';
import { Icon, paths } from './icon';

export function Avatar({ person, big }: { person: Player; big?: boolean }) {
  return <span className={big ? 'avatar avatar-big' : 'avatar'} aria-hidden="true">
    {Array.from(person.name).slice(0, 2).join('')}
    {person.avatar && <img key={person.avatar} src={person.avatar} alt="" referrerPolicy="no-referrer"
      onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export function GamePicture({ id, large = false }: { id: string | null; large?: boolean }) {
  return <GamePictureContent key={id} id={id} large={large} />;
}

function useGameArtwork(id: string | null) {
  const [failed, setFailed] = useState(false);
  return { image: failed ? null : gameImage(id), onError: () => setFailed(true) };
}

function GamePictureContent({ id, large }: { id: string | null; large: boolean }) {
  useLoadGameTitles([id]);
  const { image, onError } = useGameArtwork(id);
  return <span className={large ? 'game-picture game-picture-large' : 'game-picture'}><Icon name="game" size={large ? 18 : 13} />
    {image && <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={onError} />}
  </span>;
}

type ArtworkBounds = { x?: number; y: number; width: number; height: number };

export function TimelineGamePicture({ id, ...bounds }: ArtworkBounds & { id: string | null }) {
  return <TimelineArtwork key={id} id={id} {...bounds} />;
}

function TimelineArtwork({ id, ...bounds }: ArtworkBounds & { id: string | null }) {
  const { image, onError } = useGameArtwork(id);
  return image
    ? <image key={image} {...bounds} href={image} preserveAspectRatio="xMidYMid slice" onError={onError} />
    : <svg {...bounds} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths.game} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}
