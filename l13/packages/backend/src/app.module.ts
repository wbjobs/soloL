import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { RedisModule } from './common/redis/redis.module';
import { ProjectModule } from './modules/project/project.module';
import { ProofreadModule } from './modules/proofread/proofread.module';
import { RoomModule } from './modules/room/room.module';
import { VersionModule } from './modules/version/version.module';
import { ExportModule } from './modules/export/export.module';
import { WhisperModule } from './modules/whisper/whisper.module';
import { ReportModule } from './modules/report/report.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/subtitle-proofread'),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    RedisModule,
    ProjectModule,
    ProofreadModule,
    RoomModule,
    VersionModule,
    ExportModule,
    WhisperModule,
    ReportModule,
  ],
})
export class AppModule {}
