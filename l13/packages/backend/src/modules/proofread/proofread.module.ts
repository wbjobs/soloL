import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProofreadController } from './proofread.controller';
import { ProofreadService } from './proofread.service';
import { ProofreadGateway } from './proofread.gateway';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';
import { ProofreadEvent, ProofreadEventSchema } from '../../common/schemas/proofread-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ProofreadEvent.name, schema: ProofreadEventSchema },
    ]),
  ],
  controllers: [ProofreadController],
  providers: [ProofreadService, ProofreadGateway],
  exports: [ProofreadService],
})
export class ProofreadModule {}
