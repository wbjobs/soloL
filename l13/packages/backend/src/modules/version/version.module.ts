import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';
import { Version, VersionSchema } from '../../common/schemas/version.schema';
import { ProofreadBlock, ProofreadBlockSchema } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectSchema } from '../../common/schemas/project.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Version.name, schema: VersionSchema },
      { name: ProofreadBlock.name, schema: ProofreadBlockSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
