import React, { memo, useCallback, useEffect, useRef } from 'react';
import { useProofreadStore } from '../../stores/proofread-store';
import { usePlayerStore } from '../../stores/player-store';
import { BlockCard } from './BlockCard';
import type { ProofreadBlock } from '../../types';

interface BlockEditorProps {
  onBlockClick?: (block: ProofreadBlock) => void;
  userId?: string;
  broadcastMessage?: (data: any) => void;
}

export const BlockEditor: React.FC<BlockEditorProps> = memo(({ onBlockClick, userId, broadcastMessage }) => {
  const blocks = useProofreadStore((s) => s.blocks);
  const activeBlockIndex = useProofreadStore((s) => s.activeBlockIndex);
  const setActiveBlockIndex = useProofreadStore((s) => s.setActiveBlockIndex);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleBlockClick = useCallback(
    (index: number, block: ProofreadBlock) => {
      setActiveBlockIndex(index);
      onBlockClick?.(block);
    },
    [setActiveBlockIndex, onBlockClick],
  );

  useEffect(() => {
    if (activeBlockIndex < 0 || !containerRef.current) return;

    const activeEl = containerRef.current.querySelector(
      `.block-card[data-index="${activeBlockIndex}"]`,
    );
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeBlockIndex]);

  return (
    <div className="block-editor" ref={containerRef}>
      {blocks.map((block, index) => (
        <BlockCard
          key={block.id}
          block={block}
          index={index}
          isActive={index === activeBlockIndex}
          onClick={handleBlockClick}
          userId={userId}
          broadcastMessage={broadcastMessage}
        />
      ))}
    </div>
  );
});

BlockEditor.displayName = 'BlockEditor';
