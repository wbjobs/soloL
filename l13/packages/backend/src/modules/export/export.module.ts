import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
