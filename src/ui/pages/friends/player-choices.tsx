import type { Player } from '../../../shared';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/media';
import { api, errorText } from '../../lib/api';

/** Previewed accounts with a checkbox each and a link to compare the profile on Steam. */
export function PlayerChoices({ players, selected, disabled, onChange, onError }: {
  players: Player[]; selected: ReadonlySet<string>; disabled: boolean;
  onChange: (selected: Set<string>) => void; onError: (text: string) => void;
}) {
  return <div className="preview-list">
    {players.map(player => <div key={player.id} className="preview-row">
      <label><input type="checkbox" checked={selected.has(player.id)} disabled={disabled} onChange={event => {
        const next = new Set(selected);
        if (event.target.checked) next.add(player.id);
        else next.delete(player.id);
        onChange(next);
      }} /> {player.avatar && <Avatar person={player} />}<span>{player.name === player.id ? player.id : `${player.name} · ${player.id}`}</span></label>
      <button type="button" className="link" onClick={() => {
        void api.openSteam('profile', player.id).catch(failure => onError(errorText(failure)));
      }}>核对资料 <Icon name="external" size={14} /></button>
    </div>)}
  </div>;
}
