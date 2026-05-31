import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ProofreadEvent, ProofreadEventSchema } from '../../common/schemas/proofread-event.schema';
import { Version, VersionSchema } from '../../common/schemas/version.schema';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';
import { AISuggestion, AISuggestionSchema } from '../../common/schemas/ai-suggestion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProofreadEvent.name, schema: ProofreadEventSchema },
      { name: Version.name, schema: VersionSchema },
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: AISuggestion.name, schema: AISuggestionSchema },
    ]),
  ],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
