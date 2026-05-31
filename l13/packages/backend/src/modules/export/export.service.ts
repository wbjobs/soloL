import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectDocument } from '../../common/schemas/project.schema';
import { serializeSrt, SrtBlock } from '../../common/utils/srt-parser';

@Injectable()
export class ExportService {
  constructor(
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
  ) {}

  async exportSrt(projectId: string): Promise<{ content: string; filename: string }> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const blocks = await this.blockModel
      .find({ projectId })
      .sort({ index: 1 })
      .exec();

    if (blocks.length === 0) {
      return {
        content: '',
        filename: `${project.name.replace(/\s+/g, '_')}.srt`,
      };
    }

    const srtBlocks: SrtBlock[] = blocks.map((block, i) => ({
      index: i + 1,
      startTime: block.startTime,
      endTime: block.endTime,
      text: block.correctedText || block.originalText,
    }));

    const mergedBlocks = this.mergeAdjacentBlocks(srtBlocks);
    const content = serializeSrt(mergedBlocks);

    return {
      content,
      filename: `${project.name.replace(/\s+/g, '_')}.srt`,
    };
  }

  private mergeAdjacentBlocks(blocks: SrtBlock[]): SrtBlock[] {
    if (blocks.length === 0) return blocks;

    const merged: SrtBlock[] = [];
    let current: SrtBlock = { ...blocks[0] };

    for (let i = 1; i < blocks.length; i++) {
      const gap = blocks[i].startTime - current.endTime;
      if (gap <= 100 && this.areSentencesContiguous(current.text, blocks[i].text)) {
        current.endTime = blocks[i].endTime;
        current.text = current.text + ' ' + blocks[i].text;
      } else {
        merged.push(current);
        current = { ...blocks[i] };
      }
    }
    merged.push(current);

    return merged.map((block, i) => ({ ...block, index: i + 1 }));
  }

  private areSentencesContiguous(text1: string, text2: string): boolean {
    const lastChar = text1.trim().slice(-1);
    const sentenceEndings = ['.', '!', '?', '。', '！', '？'];
    return !sentenceEndings.includes(lastChar);
  }
}
