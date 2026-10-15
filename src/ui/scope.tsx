// Bandeau « Mes pages / Toutes » affiché aux vendeurs rattachés à des pages.
import type { useMyScope } from '../lib/scope';
import { Icon } from './icons';

export function ScopeBar({ scope, mineLabel = 'Mes pages', text }: { scope: ReturnType<typeof useMyScope>; mineLabel?: string; text?: string }) {
  if (!scope.has) return null;
  if (scope.locked) return <div className="scope-bar"><Icon name="tag" /><span className="small">{text ?? 'Vous voyez seulement vos pages'} : <strong>{scope.names}</strong></span></div>;
  return (
    <div className="scope-bar">
      <Icon name="tag" />
      <span className="small">{scope.on ? (text ?? `Vous voyez seulement vos pages : ${scope.names}`) : 'Vous voyez toutes les pages'}</span>
      <div className="segmented" role="group" aria-label="Filtre">
        <button type="button" aria-pressed={scope.on} onClick={() => scope.setAll(false)}>{mineLabel}</button>
        <button type="button" aria-pressed={!scope.on} onClick={() => scope.setAll(true)}>Tout</button>
      </div>
    </div>
  );
}
