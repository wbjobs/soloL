import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { ProofreadEvent, ProofreadEventDocument } from '../../common/schemas/proofread-event.schema';
import { UpdateProofreadBlockDto, MoveTimelineDto } from '../../common/dto/proofread-block.dto';

@Injectable()
export class ProofreadService {
  constructor(
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
    @InjectModel(ProofreadEvent.name) private eventModel: Model<ProofreadEventDocument>,
  ) {}

  async getBlocks(projectId: string): Promise<ProofreadBlockDocument[]> {
    return this.blockModel
      .find({ projectId })
      .sort({ index: 1 })
      .exec();
  }

  async getBlockById(id: string): Promise<ProofreadBlockDocument> {
    const block = await this.blockModel.findById(id).exec();
    if (!block) {
      throw new NotFoundException(`Block with ID ${id} not found`);
    }
    return block;
  }

  async updateBlock(
    id: string,
    dto: UpdateProofreadBlockDto,
  ): Promise<ProofreadBlockDocument> {
    const block = await this.blockModel.findById(id).exec();
    if (!block) {
      throw new NotFoundException(`Block with ID ${id} not found`);
    }

    const oldText = block.correctedText;
    const oldStatus = block.status;

    if (dto.correctedText !== undefined) {
      block.correctedText = dto.correctedText;
    }
    if (dto.status !== undefined) {
      block.status = dto.status;
    }
    if (dto.assignedTo !== undefined) {
      block.assignedTo = dto.assignedTo;
    }

    if (block.correctedText && block.status === 'pending') {
      block.status = 'in-progress';
    }

    const saved = await block.save();

    if (dto.correctedText !== undefined && dto.correctedText !== oldText) {
      await this.logEvent(block.projectId.toString(), dto.userId || 'unknown', 'edit', block.index, {
        oldText,
        newText: dto.correctedText,
      });
    }

    if (oldStatus !== block.status) {
      await this.logEvent(block.projectId.toString(), dto.userId || 'unknown', 'status-change', block.index, {
        oldStatus,
        newStatus: block.status,
      });
    }

    return saved;
  }

  async moveTimeline(
    id: string,
    dto: MoveTimelineDto,
  ): Promise<ProofreadBlockDocument> {
    const block = await this.blockModel.findById(id).exec();
    if (!block) {
      throw new NotFoundException(`Block with ID ${id} not found`);
    }

    if (dto.startTime >= dto.endTime) {
      throw new Error('Start time must be less than end time');
    }

    const oldStart = block.startTime;
    const oldEnd = block.endTime;

    block.startTime = dto.startTime;
    block.endTime = dto.endTime;

    const saved = await block.save();

    if (oldStart !== dto.startTime || oldEnd !== dto.endTime) {
      await this.logEvent(block.projectId.toString(), dto.userId || 'unknown', 'timeline-adjust', block.index, {
        oldStart,
        oldEnd,
        newStart: dto.startTime,
        newEnd: dto.endTime,
        startOffset: dto.startTime - oldStart,
        endOffset: dto.endTime - oldEnd,
      });
    }

    return saved;
  }

  private async logEvent(
    projectId: string,
    userId: string,
    eventType: string,
    blockIndex: number,
    detail: Record<string, any>,
  ): Promise<void> {
    try {
      await this.eventModel.create({
        projectId,
        userId,
        eventType,
        blockIndex,
        detail,
      });
    } catch (err) {
      console.warn('Failed to log proofread event:', err);
    }
  }
}
