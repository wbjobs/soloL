import React, { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Tag, Button, Input, Space, Tooltip, message } from 'antd';
import {
  CheckOutlined,
  SaveOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { ProofreadBlock, AISuggestion } from '../../types';
import { useProofreadStore } from '../../stores/proofread-store';
import { useAISuggestionStore } from '../../stores/ai-store';
import { updateBlock } from '../../api/proofread';
import { formatSrtTime, formatMsOffset } from '../../utils';
import { otClient } from '../../ot/ot-client';
import type { OTOperation } from '../../types';

const { TextArea } = Input;

interface BlockCardProps {
  block: ProofreadBlock;
  index: number;
  isActive: boolean;
  onClick: (index: number, block: ProofreadBlock) => void;
  userId?: string;
  broadcastMessage?: (data: any) => void;
}

function getDiffTypeColor(diffType: string): string {
  switch (diffType) {
    case 'timeline-offset':
      return '#fa8c16';
    case 'text-diff':
      return '#eb2f96';
    case 'both':
      return '#f5222d';
    default:
      return '#d9d9d9';
  }
}

function getDiffTypeLabel(diffType: string): string {
  switch (diffType) {
    case 'timeline-offset':
      return '时间轴偏移';
    case 'text-diff':
      return '文本差异';
    case 'both':
      return '时间+文本';
    default:
      return '差异';
  }
}

export const BlockCard: React.FC<BlockCardProps> = memo(
  ({ block, index, isActive, onClick, userId, broadcastMessage }) => {
    const updateBlockInStore = useProofreadStore((s) => s.updateBlock);
    const getSuggestionForBlock = useAISuggestionStore((s) => s.getSuggestionForBlock);
    const adoptSuggestion = useAISuggestionStore((s) => s.adopt);
    const rejectSuggestion = useAISuggestionStore((s) => s.reject);

    const [correctedText, setCorrectedText] = useState(block.correctedText);
    const [saving, setSaving] = useState(false);
    const [isComposing, setIsComposing] = useState(false);
    const [adopting, setAdopting] = useState(false);
    const lastSentTextRef = useRef(block.correctedText);

    const suggestion: AISuggestion | undefined = getSuggestionForBlock(index);
    const hasSuggestion = !!suggestion;

    useEffect(() => {
      setCorrectedText(block.correctedText);
      lastSentTextRef.current = block.correctedText;
    }, [block.correctedText]);

    const computeAndSendDiff = useCallback(
      (oldText: string, newText: string) => {
        if (oldText === newText || !userId) return;

        let i = 0;
        while (i < oldText.length && i < newText.length && oldText[i] === newText[i]) {
          i++;
        }

        let j = 0;
        while (
          j < oldText.length - i &&
          j < newText.length - i &&
          oldText[oldText.length - 1 - j] === newText[newText.length - 1 - j]
        ) {
          j++;
        }

        const deletedText = oldText.substring(i, oldText.length - j);
        const insertedText = newText.substring(i, newText.length - j);

        let op: OTOperation | null = null;

        if (deletedText.length > 0 && insertedText.length > 0) {
          op = otClient.createReplaceOp(
            block.index,
            'correctedText',
            i,
            deletedText,
            insertedText,
            userId,
          );
        } else if (deletedText.length > 0) {
          op = otClient.createDeleteOp(
            block.index,
            'correctedText',
            i,
            deletedText,
            userId,
          );
        } else if (insertedText.length > 0) {
          op = otClient.createInsertOp(
            block.index,
            'correctedText',
            i,
            insertedText,
            userId,
          );
        }

        if (op) {
          otClient.applyLocalOp(op);
          broadcastMessage?.({ type: 'edit', op });
        }
      },
      [block.index, userId, broadcastMessage],
    );

    const handleTextChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setCorrectedText(newText);

        if (!isComposing && userId) {
          computeAndSendDiff(lastSentTextRef.current, newText);
          lastSentTextRef.current = newText;
        }
      },
      [isComposing, userId, computeAndSendDiff],
    );

    const handleCompositionStart = useCallback(() => {
      setIsComposing(true);
    }, []);

    const handleCompositionEnd = useCallback(
      (e: React.CompositionEvent<HTMLTextAreaElement>) => {
        setIsComposing(false);
        if (userId) {
          const newText = (e.target as HTMLTextAreaElement).value;
          computeAndSendDiff(lastSentTextRef.current, newText);
          lastSentTextRef.current = newText;
        }
      },
      [userId, computeAndSendDiff],
    );

    const handleSave = useCallback(async () => {
      setSaving(true);
      try {
        await updateBlock({
          blockId: block.id,
          correctedText,
          userId,
        });
        updateBlockInStore(block.id, { correctedText });
        lastSentTextRef.current = correctedText;
        message.success('已保存');
      } catch (err) {
        console.error('Failed to save block:', err);
        message.error('保存失败');
      } finally {
        setSaving(false);
      }
    }, [block.id, correctedText, userId, updateBlockInStore]);

    const handleMarkDone = useCallback(async () => {
      const newStatus = block.status === 'done' ? 'pending' : 'done';
      try {
        await updateBlock({
          blockId: block.id,
          status: newStatus,
          userId,
        });
        updateBlockInStore(block.id, { status: newStatus });
      } catch (err) {
        console.error('Failed to update status:', err);
      }
    }, [block.id, block.status, userId, updateBlockInStore]);

    const handleAdoptSuggestion = useCallback(async () => {
      if (!suggestion || !userId) return;
      setAdopting(true);
      try {
        await adoptSuggestion(suggestion.id, userId);
        const newStartTime = block.startTime + suggestion.startTimeOffset;
        const newEndTime = block.endTime + suggestion.endTimeOffset;
        await updateBlock({
          blockId: block.id,
          correctedText: suggestion.suggestedText,
          startTime: newStartTime,
          endTime: newEndTime,
          userId,
        });
        updateBlockInStore(block.id, {
          correctedText: suggestion.suggestedText,
          startTime: newStartTime,
          endTime: newEndTime,
        });
        setCorrectedText(suggestion.suggestedText);
        lastSentTextRef.current = suggestion.suggestedText;
        message.success('已采纳AI建议');
      } catch (err) {
        console.error('Failed to adopt suggestion:', err);
        message.error('采纳失败');
      } finally {
        setAdopting(false);
      }
    }, [suggestion, userId, block, adoptSuggestion, updateBlockInStore]);

    const handleRejectSuggestion = useCallback(async () => {
      if (!suggestion || !userId) return;
      try {
        await rejectSuggestion(suggestion.id, userId);
        message.success('已忽略AI建议');
      } catch (err) {
        console.error('Failed to reject suggestion:', err);
        message.error('操作失败');
      }
    }, [suggestion, userId, rejectSuggestion]);

    const handleClick = useCallback(() => {
      onClick(index, block);
    }, [index, block, onClick]);

    return (
      <div
        className={`block-card ${isActive ? 'block-card--active' : ''} ${hasSuggestion ? 'block-card--has-suggestion' : ''}`}
        data-index={index}
        onClick={handleClick}
        style={{
          borderLeft: hasSuggestion
            ? `4px solid ${getDiffTypeColor(suggestion.diffType)}`
            : undefined,
        }}
      >
        <div className="block-card__header">
          <span className="block-card__index">#{index + 1}</span>
          <span className="block-card__time">
            {formatSrtTime(block.startTime)} → {formatSrtTime(block.endTime)}
          </span>
          <Space size={8}>
            {hasSuggestion && (
              <Tooltip title={`AI建议：${getDiffTypeLabel(suggestion.diffType)}`}>
                <Tag color={getDiffTypeColor(suggestion.diffType)} icon={<RobotOutlined />}>
                  {getDiffTypeLabel(suggestion.diffType)}
                </Tag>
              </Tooltip>
            )}
            <Tag
              color={block.status === 'done' ? 'green' : 'orange'}
              className="block-card__status"
            >
              {block.status}
            </Tag>
          </Space>
        </div>

        {hasSuggestion && (
          <div className="ai-suggestion-banner">
            <div className="ai-suggestion-banner__header">
              <RobotOutlined />
              <span className="ai-suggestion-banner__title">AI 识别建议</span>
              <Space size={8}>
                {suggestion.diffType !== 'text-diff' && (
                  <Tooltip title="时间轴偏移">
                    <Tag icon={<ClockCircleOutlined />} color="orange">
                      开始 {formatMsOffset(suggestion.startTimeOffset)} / 结束 {formatMsOffset(suggestion.endTimeOffset)}
                    </Tag>
                  </Tooltip>
                )}
                {suggestion.diffType !== 'timeline-offset' && (
                  <Tag color="pink">
                    文本差异 {(suggestion.textDiffRate * 100).toFixed(0)}%
                  </Tag>
                )}
              </Space>
            </div>
            <div className="ai-suggestion-banner__content">
              <div className="ai-suggestion-banner__comparison">
                <div className="ai-suggestion-banner__original">
                  <span className="ai-suggestion-banner__label">原文:</span>
                  <span className="ai-suggestion-banner__text--original">{suggestion.originalText}</span>
                </div>
                <div className="ai-suggestion-banner__suggested">
                  <span className="ai-suggestion-banner__label">AI建议:</span>
                  <span className="ai-suggestion-banner__text--suggested">{suggestion.suggestedText}</span>
                </div>
              </div>
              <Space size={8} className="ai-suggestion-banner__actions">
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  loading={adopting}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAdoptSuggestion();
                  }}
                >
                  采纳
                </Button>
                <Button
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRejectSuggestion();
                  }}
                >
                  忽略
                </Button>
              </Space>
            </div>
          </div>
        )}

        <div className="block-card__body">
          <div className="block-card__original">
            <label>Original:</label>
            <p className="block-card__original-text">{block.originalText}</p>
          </div>

          <div className="block-card__corrected">
            <label>Corrected:</label>
            <TextArea
              value={correctedText}
              onChange={handleTextChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              autoSize={{ minRows: 2, maxRows: 6 }}
              className="block-card__textarea"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        <div className="block-card__actions">
          <Button
            icon={<SaveOutlined />}
            size="small"
            loading={saving}
            onClick={(e) => {
              e.stopPropagation();
              handleSave();
            }}
          >
            Save
          </Button>
          <Button
            icon={<CheckOutlined />}
            size="small"
            type={block.status === 'done' ? 'default' : 'primary'}
            onClick={(e) => {
              e.stopPropagation();
              handleMarkDone();
            }}
          >
            {block.status === 'done' ? 'Undo' : 'Done'}
          </Button>
        </div>
      </div>
    );
  },
);

BlockCard.displayName = 'BlockCard';
