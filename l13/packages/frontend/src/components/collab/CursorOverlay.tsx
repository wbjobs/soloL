import React, { memo } from 'react';
import { useRoomStore } from '../../stores/room-store';
import { useProofreadStore } from '../../stores/proofread-store';

export const CursorOverlay: React.FC = memo(() => {
  const cursors = useRoomStore((s) => s.cursors);
  const activeBlockIndex = useProofreadStore((s) => s.activeBlockIndex);
  const participants = useRoomStore((s) => s.participants);

  const cursorEntries = Array.from(cursors.entries()).filter(
    ([, cursor]) => cursor.blockIndex === activeBlockIndex,
  );

  if (cursorEntries.length === 0) return null;

  return (
    <div className="cursor-overlay">
      {cursorEntries.map(([userId, cursor]) => {
        const participant = participants.find((p) => p.id === userId);
        return (
          <div
            key={userId}
            className="cursor-overlay__item"
            style={{
              borderLeft: `3px solid ${cursor.userColor}`,
              backgroundColor: `${cursor.userColor}20`,
            }}
          >
            <span
              className="cursor-overlay__label"
              style={{ backgroundColor: cursor.userColor }}
            >
              {cursor.userName || participant?.name || 'Unknown'}
            </span>
            <span className="cursor-overlay__field">
              {cursor.field === 'correctedText' ? 'Corrected' : 'Original'} @
              pos {cursor.offset}
            </span>
          </div>
        );
      })}
    </div>
  );
});

CursorOverlay.displayName = 'CursorOverlay';
