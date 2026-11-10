import type { DiscoverySnapshot } from '../../../shared';
import { Icon } from '../../components/icon';
import { api, errorText } from '../../lib/api';

export function DiscoveryInbox({ discovery, review, onError }: {
  discovery: DiscoverySnapshot; review: () => void; onError: (message: string) => void;
}) {
  if (discovery.pending === 0) return null;
  return <section className="panel discovery-inbox" aria-label="好友发现">
    <span className="module-icon"><Icon name="radar" /></span>
    <div><strong>{discovery.pending} 位好友待确认</strong><p>公开好友名单中有可以添加的账号。</p></div>
    <div className="inbox-actions">
      <button className="link" onClick={() => void api.dismissDiscovery().catch(error => onError(errorText(error)))}>忽略本批</button>
      <button onClick={review}>查看名单 <Icon name="arrow" size={14} /></button>
    </div>
  </section>;
}
