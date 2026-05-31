import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { RoomService } from './room.service';

@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  async createRoom(
    @Body() body: { projectId: string; createdBy: string },
  ) {
    return this.roomService.createRoom(body.projectId, body.createdBy);
  }

  @Get(':id')
  async getRoom(@Param('id') id: string) {
    return this.roomService.getRoom(id);
  }

  @Post(':id/join')
  async joinRoom(
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.roomService.joinRoom(id, body.userId);
  }

  @Delete(':id/leave')
  async leaveRoom(
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.roomService.leaveRoom(id, body.userId);
  }
}
