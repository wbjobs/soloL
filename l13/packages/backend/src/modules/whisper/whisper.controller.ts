import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { WhisperService } from './whisper.service';

@Controller('whisper')
export class WhisperController {
  constructor(private readonly whisperService: WhisperService) {}

  @Post(':projectId/transcribe')
  async transcribe(
    @Param('projectId') projectId: string,
    @Body() body: { language?: string; model?: string; userId?: string },
  ) {
    return this.whisperService.transcribeProject(projectId, {
      language: body?.language,
      model: body?.model,
    });
  }

  @Get(':projectId/suggestions')
  async getSuggestions(@Param('projectId') projectId: string) {
    return this.whisperService.getSuggestions(projectId);
  }

  @Post('suggestions/:suggestionId/adopt')
  async adoptSuggestion(
    @Param('suggestionId') suggestionId: string,
    @Body() body: { userId: string },
  ) {
    return this.whisperService.adoptSuggestion(suggestionId, body.userId);
  }

  @Post('suggestions/:suggestionId/reject')
  async rejectSuggestion(
    @Param('suggestionId') suggestionId: string,
    @Body() body: { userId: string },
  ) {
    return this.whisperService.rejectSuggestion(suggestionId, body.userId);
  }
}
