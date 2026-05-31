import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AISuggestion, AISuggestionDocument } from '../../common/schemas/ai-suggestion.schema';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectDocument } from '../../common/schemas/project.schema';
import { ProofreadEvent, ProofreadEventDocument } from '../../common/schemas/proofread-event.schema';
import { WhisperRunner } from '../../common/utils/whisper-runner';
import { compareSubtitles } from '../../common/utils/subtitle-differ';
import { ProofreadService } from '../proofread/proofread.service';
import { SrtBlock } from '../../common/utils/srt-parser';

@Injectable()
export class WhisperService {
  private whisperRunner = new WhisperRunner();

  constructor(
    @InjectModel(AISuggestion.name) private suggestionModel: Model<AISuggestionDocument>,
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(ProofreadEvent.name) private eventModel: Model<ProofreadEventDocument>,
    private readonly proofreadService: ProofreadService,
  ) {}

  async transcribeProject(
    projectId: string,
    options?: { language?: string; model?: string },
  ): Promise<AISuggestionDocument[]> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    if (!project.videoUrl) {
      throw new NotFoundException(`Project has no video URL`);
    }

    const aiBlocks = await this.whisperRunner.transcribe(project.videoUrl, options);

    const existingBlocks = await this.proofreadService.getBlocks(projectId);
    const originalSrtBlocks: SrtBlock[] = existingBlocks.map((block) => ({
      index: block.index,
      startTime: block.startTime,
      endTime: block.endTime,
      text: block.originalText,
    }));

    const diffs = compareSubtitles(originalSrtBlocks, aiBlocks);

    const suggestions: AISuggestionDocument[] = [];
    for (const diff of diffs) {
      const suggestion = new this.suggestionModel({
        projectId,
        blockIndex: diff.blockIndex,
        originalText: diff.originalText,
        suggestedText: diff.suggestedText,
        startTimeOffset: diff.startTimeOffset,
        endTimeOffset: diff.endTimeOffset,
        textDiffRate: diff.textDiffRate,
        diffType: diff.diffType,
        status: 'pending',
      });
      const saved = await suggestion.save();
      suggestions.push(saved);

      await this.eventModel.create({
        projectId,
        userId: 'system',
        eventType: 'adopt-ai',
        blockIndex: diff.blockIndex,
        detail: {
          suggestionId: String(saved._id),
          diffType: diff.diffType,
          textDiffRate: diff.textDiffRate,
          startTimeOffset: diff.startTimeOffset,
          endTimeOffset: diff.endTimeOffset,
        },
      });
    }

    return suggestions;
  }

  async getSuggestions(projectId: string): Promise<AISuggestionDocument[]> {
    return this.suggestionModel
      .find({ projectId })
      .sort({ blockIndex: 1 })
      .exec();
  }

  async adoptSuggestion(
    suggestionId: string,
    userId: string,
  ): Promise<ProofreadBlockDocument> {
    const suggestion = await this.suggestionModel.findById(suggestionId).exec();
    if (!suggestion) {
      throw new NotFoundException(`Suggestion with ID ${suggestionId} not found`);
    }

    suggestion.status = 'accepted';
    suggestion.adoptedBy = userId;
    await suggestion.save();

    const block = await this.blockModel
      .findOne({
        projectId: suggestion.projectId,
        index: suggestion.blockIndex,
      })
      .exec();

    if (!block) {
      throw new NotFoundException(
        `Block with index ${suggestion.blockIndex} not found in project`,
      );
    }

    block.correctedText = suggestion.suggestedText;
    block.startTime = block.startTime + suggestion.startTimeOffset;
    block.endTime = block.endTime + suggestion.endTimeOffset;

    if (block.status === 'pending') {
      block.status = 'in-progress';
    }

    const updatedBlock = await block.save();

    await this.eventModel.create({
      projectId: suggestion.projectId,
      userId,
      eventType: 'adopt-ai',
      blockIndex: suggestion.blockIndex,
      detail: {
        suggestionId,
        originalText: suggestion.originalText,
        suggestedText: suggestion.suggestedText,
        startTimeOffset: suggestion.startTimeOffset,
        endTimeOffset: suggestion.endTimeOffset,
      },
    });

    return updatedBlock;
  }

  async rejectSuggestion(
    suggestionId: string,
    userId: string,
  ): Promise<AISuggestionDocument> {
    const suggestion = await this.suggestionModel.findById(suggestionId).exec();
    if (!suggestion) {
      throw new NotFoundException(`Suggestion with ID ${suggestionId} not found`);
    }

    suggestion.status = 'rejected';
    await suggestion.save();

    await this.eventModel.create({
      projectId: suggestion.projectId,
      userId,
      eventType: 'reject-ai',
      blockIndex: suggestion.blockIndex,
      detail: {
        suggestionId,
        originalText: suggestion.originalText,
        suggestedText: suggestion.suggestedText,
      },
    });

    return suggestion;
  }
}
