import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhisperController } from './whisper.controller';
import { WhisperService } from './whisper.service';
import { AISuggestion, AISuggestionSchema } from '../../common/schemas/ai-suggestion.schema';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';
import { ProofreadEvent, ProofreadEventSchema } from '../../common/schemas/proofread-event.schema';
import { ProofreadModule } from '../proofread/proofread.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AISuggestion.name, schema: AISuggestionSchema },
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ProofreadEvent.name, schema: ProofreadEventSchema },
    ]),
    ProofreadModule,
  ],
  controllers: [WhisperController],
  providers: [WhisperService],
  exports: [WhisperService],
})
export class WhisperModule {}
