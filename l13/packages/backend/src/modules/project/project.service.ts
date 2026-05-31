import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from '../../common/schemas/project.schema';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { parseSrt } from '../../common/utils/srt-parser';
import { splitSrtIntoProofreadBlocks } from '../../common/utils/srt-splitter';

@Injectable()
export class ProjectService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
  ) {}

  async createProject(data: {
    name: string;
    videoUrl: string | null;
    srtContent: string;
    createdBy: string;
  }): Promise<ProjectDocument> {
    const project = new this.projectModel({
      name: data.name,
      videoUrl: data.videoUrl,
      srtContent: data.srtContent,
      createdBy: data.createdBy,
    });

    const savedProject = await project.save();

    if (data.srtContent) {
      await this.createProofreadBlocks(String(savedProject._id), data.srtContent);
    }

    return savedProject;
  }

  private async createProofreadBlocks(projectId: string, srtContent: string): Promise<void> {
    const srtBlocks = parseSrt(srtContent);
    const splitBlocks = splitSrtIntoProofreadBlocks(srtBlocks);

    if (splitBlocks.length === 0) return;

    const blockDocs = splitBlocks.map((block) => ({
      projectId,
      index: block.index,
      startTime: block.startTime,
      endTime: block.endTime,
      originalText: block.originalText,
      correctedText: '',
      status: 'pending',
    }));

    await this.blockModel.insertMany(blockDocs);

    await this.projectModel.findByIdAndUpdate(projectId, {
      blockCount: splitBlocks.length,
    });
  }

  async findAll(): Promise<ProjectDocument[]> {
    return this.projectModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<ProjectDocument> {
    const project = await this.projectModel.findById(id).exec();
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    return project;
  }
}
