import { Controller, Get, Param, Res } from '@nestjs/common';
import { ReportService } from './report.service';
import { Response } from 'express';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get(':projectId/stats')
  async getStats(@Param('projectId') projectId: string) {
    return this.reportService.getProjectStats(projectId);
  }

  @Get(':projectId/pdf')
  async generatePdf(
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const html = await this.reportService.generatePdfReport(projectId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="report-${projectId}.html"`,
    );
    res.send(html);
  }
}
