import type { ReactNode } from 'react';
import { Icon } from './icon';

export function Dialog({ title, close, extra, children }: {
  title: string; close: () => void; extra?: ReactNode; children: ReactNode;
}) {
  return <dialog className="modal" aria-label={title} ref={element => {
    if (element && !element.open) element.showModal();
  }} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2>{title}</h2>{extra}<button className="icon-button" aria-label="关闭弹窗" onClick={close}><Icon name="close" /></button></header>
    {children}
  </dialog>;
}
