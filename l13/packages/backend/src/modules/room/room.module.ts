import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomGateway } from './room.gateway';
import { Room, RoomSchema } from '../../common/schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Room.name, schema: RoomSchema }]),
  ],
  controllers: [RoomController],
  providers: [RoomService, RoomGateway],
  exports: [RoomService],
})
export class RoomModule {}
