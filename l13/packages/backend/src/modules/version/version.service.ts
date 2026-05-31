import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as Diff from 'diff';
import { Version, VersionDocument } from '../../common/schemas/version.schema';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectDocument } from '../../common/schemas/project.schema';

@Injectable()
export class VersionService {
  constructor(
    @InjectModel(Version.name) private versionModel: Model<VersionDocument>,
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
  ) {}

  async createVersion(projectId: string, createdBy?: string): Promise<VersionDocument> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const blocks = await this.blockModel
      .find({ projectId })
      .sort({ index: 1 })
      .exec();

    const blockSnapshots = blocks.map((block) => ({
      index: block.index,
      startTime: block.startTime,
      endTime: block.endTime,
      originalText: block.originalText,
      correctedText: block.correctedText,
      status: block.status,
      assignedTo: block.assignedTo,
    }));

    const latestVersion = await this.versionModel
      .findOne({ projectId })
      .sort({ versionNumber: -1 })
      .exec();

    const versionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

    let diffResult: Record<string, any> | null = null;
    if (latestVersion) {
      const oldText = latestVersion.blocks
        .map((b) => b.correctedText || b.originalText)
        .join('\n');
      const newText = blockSnapshots
        .map((b) => b.correctedText || b.originalText)
        .join('\n');

      const changes = Diff.diffLines(oldText, newText);
      diffResult = {
        changes: changes.map((change) => ({
          value: change.value,
          added: change.added || false,
          removed: change.removed || false,
        })),
        summary: {
          added: changes
            .filter((c) => c.added)
            .reduce((sum, c) => sum + (c.count ?? 0), 0),
          removed: changes
            .filter((c) => c.removed)
            .reduce((sum, c) => sum + (c.count ?? 0), 0),
        },
      };
    }

    const version = new this.versionModel({
      projectId,
      versionNumber,
      blocks: blockSnapshots,
      diff: diffResult,
      createdBy: createdBy || 'system',
    });

    return version.save();
  }

  async getVersions(projectId: string): Promise<VersionDocument[]> {
    return this.versionModel
      .find({ projectId })
      .sort({ versionNumber: -1 })
      .exec();
  }

  async getVersionDiff(
    projectId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<Record<string, any>> {
    const v1 = await this.versionModel.findOne({
      projectId,
      versionNumber: fromVersion,
    });
    const v2 = await this.versionModel.findOne({
      projectId,
      versionNumber: toVersion,
    });

    if (!v1) {
      throw new NotFoundException(`Version ${fromVersion} not found for project ${projectId}`);
    }
    if (!v2) {
      throw new NotFoundException(`Version ${toVersion} not found for project ${projectId}`);
    }

    const text1 = v1.blocks
      .map((b) => b.correctedText || b.originalText)
      .join('\n');
    const text2 = v2.blocks
      .map((b) => b.correctedText || b.originalText)
      .join('\n');

    const lineChanges = Diff.diffLines(text1, text2);
    const wordChanges = Diff.diffWords(text1, text2);

    return {
      fromVersion,
      toVersion,
      lineDiff: lineChanges.map((change) => ({
        value: change.value,
        added: change.added || false,
        removed: change.removed || false,
        count: change.count,
      })),
      wordDiff: wordChanges.map((change) => ({
        value: change.value,
        added: change.added || false,
        removed: change.removed || false,
      })),
      summary: {
        linesAdded: lineChanges
          .filter((c) => c.added)
          .reduce((sum, c) => sum + (c.count || 0), 0),
        linesRemoved: lineChanges
          .filter((c) => c.removed)
          .reduce((sum, c) => sum + (c.count || 0), 0),
        wordsAdded: wordChanges
          .filter((c) => c.added)
          .reduce((sum, c) => sum + c.value.split(/\s+/).filter(Boolean).length, 0),
        wordsRemoved: wordChanges
          .filter((c) => c.removed)
          .reduce((sum, c) => sum + c.value.split(/\s+/).filter(Boolean).length, 0),
      },
      blockChanges: this.computeBlockChanges(v1.blocks, v2.blocks),
    };
  }

  private computeBlockChanges(
    oldBlocks: Record<string, any>[],
    newBlocks: Record<string, any>[],
  ): Record<string, any>[] {
    const changes: Record<string, any>[] = [];
    const maxLength = Math.max(oldBlocks.length, newBlocks.length);

    for (let i = 0; i < maxLength; i++) {
      const oldBlock = oldBlocks[i];
      const newBlock = newBlocks[i];

      if (!oldBlock && newBlock) {
        changes.push({ index: i, type: 'added', block: newBlock });
      } else if (oldBlock && !newBlock) {
        changes.push({ index: i, type: 'removed', block: oldBlock });
      } else if (oldBlock && newBlock) {
        const oldText = oldBlock.correctedText || oldBlock.originalText;
        const newText = newBlock.correctedText || newBlock.originalText;
        if (oldText !== newText) {
          const wordDiff = Diff.diffWords(oldText, newText);
          changes.push({
            index: i,
            type: 'modified',
            oldBlock,
            newBlock,
            textDiff: wordDiff.map((c) => ({
              value: c.value,
              added: c.added || false,
              removed: c.removed || false,
            })),
          });
        }
        if (oldBlock.startTime !== newBlock.startTime || oldBlock.endTime !== newBlock.endTime) {
          changes.push({
            index: i,
            type: 'timeline-changed',
            oldTimeline: { startTime: oldBlock.startTime, endTime: oldBlock.endTime },
            newTimeline: { startTime: newBlock.startTime, endTime: newBlock.endTime },
          });
        }
      }
    }

    return changes;
  }
}
