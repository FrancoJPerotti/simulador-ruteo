import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  linkId: string;
  source: string;
  target: string;
  cost: number;
  isDown: boolean;
  isCongested: boolean;
  onSetNormal: (linkId: string) => void;
  onSetCongested: (linkId: string) => void;
  onSetDown: (linkId: string) => void;
  onClose: () => void;
}

export function ContextMenu({
  x, y, linkId, source, target, cost,
  isDown, isCongested,
  onSetNormal, onSetCongested, onSetDown, onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      ref={menuRef}
      style={{ left: x, top: y }}
    >
      <div className="context-menu-title">
        {source} &mdash; {target} (costo {cost})
      </div>
      <div className="context-menu-divider" />
      <button
        className={`context-menu-item ${!isDown && !isCongested ? 'active' : ''}`}
        onClick={() => { onSetNormal(linkId); onClose(); }}
      >
        <span className="indicator normal" />
        Normal
      </button>
      <button
        className={`context-menu-item ${isCongested ? 'active' : ''}`}
        onClick={() => { onSetCongested(linkId); onClose(); }}
      >
        <span className="indicator congested" />
        Congestionado
      </button>
      <button
        className={`context-menu-item ${isDown ? 'active' : ''}`}
        onClick={() => { onSetDown(linkId); onClose(); }}
      >
        <span className="indicator down" />
        Roto
      </button>
    </div>
  );
}
