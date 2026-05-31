import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
} from '@nestjs/common';
import { ProofreadService } from './proofread.service';
import { UpdateProofreadBlockDto, MoveTimelineDto } from '../../common/dto/proofread-block.dto';

@Controller('proofread')
export class ProofreadController {
  constructor(private readonly proofreadService: ProofreadService) {}

  @Get(':projectId/blocks')
  async getBlocks(@Param('projectId') projectId: string) {
    return this.proofreadService.getBlocks(projectId);
  }

  @Patch('blocks/:id')
  async updateBlock(
    @Param('id') id: string,
    @Body() dto: UpdateProofreadBlockDto,
  ) {
    return this.proofreadService.updateBlock(id, dto);
  }

  @Post('blocks/:id/move-timeline')
  async moveTimeline(
    @Param('id') id: string,
    @Body() dto: MoveTimelineDto,
  ) {
    return this.proofreadService.moveTimeline(id, dto);
  }
}
