import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { VersionService } from './version.service';
import { GetVersionDiffDto } from '../../common/dto/version.dto';

@Controller('versions')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Post(':projectId')
  async createVersion(
    @Param('projectId') projectId: string,
    @Body() body: { createdBy?: string },
  ) {
    return this.versionService.createVersion(projectId, body.createdBy);
  }

  @Get(':projectId')
  async getVersions(@Param('projectId') projectId: string) {
    return this.versionService.getVersions(projectId);
  }

  @Get(':projectId/diff')
  async getVersionDiff(
    @Param('projectId') projectId: string,
    @Query() query: GetVersionDiffDto,
  ) {
    return this.versionService.getVersionDiff(
      projectId,
      query.fromVersion,
      query.toVersion,
    );
  }
}
