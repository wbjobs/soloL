import { Controller, Get, Param, Res } from '@nestjs/common';
import { ExportService } from './export.service';
import { Response } from 'express';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get(':projectId/srt')
  async exportSrt(
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportSrt(projectId);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.content);
  }
}
