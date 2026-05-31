import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
    ]),
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
