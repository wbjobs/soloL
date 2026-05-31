import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room, RoomDocument } from '../../common/schemas/room.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import * as Redis from 'ioredis';

@Injectable()
export class RoomService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @Inject(REDIS_CLIENT) private redis: Redis.default,
  ) {}

  async createRoom(projectId: string, createdBy: string): Promise<RoomDocument> {
    const room = new this.roomModel({
      projectId,
      createdBy,
      participants: [createdBy],
      status: 'waiting',
    });
    const saved = await room.save();

    await this.redis.set(
      `room:${saved._id}:participants`,
      JSON.stringify([createdBy]),
    );

    return saved;
  }

  async getRoom(id: string): Promise<RoomDocument> {
    const room = await this.roomModel.findById(id).exec();
    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }
    return room;
  }

  async joinRoom(id: string, userId: string): Promise<RoomDocument> {
    const room = await this.roomModel.findById(id).exec();
    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    if (!room.participants.includes(userId)) {
      room.participants.push(userId);
    }

    if (room.participants.length >= 2) {
      room.status = 'active';
    }

    const saved = await room.save();

    await this.redis.set(
      `room:${id}:participants`,
      JSON.stringify(saved.participants),
    );

    return saved;
  }

  async leaveRoom(id: string, userId: string): Promise<RoomDocument> {
    const room = await this.roomModel.findById(id).exec();
    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    room.participants = room.participants.filter((p) => p !== userId);

    if (room.participants.length < 2) {
      room.status = 'waiting';
    }

    if (room.participants.length === 0) {
      room.status = 'closed';
    }

    const saved = await room.save();

    await this.redis.set(
      `room:${id}:participants`,
      JSON.stringify(saved.participants),
    );

    return saved;
  }

  async getOnlineParticipants(roomId: string): Promise<string[]> {
    const cached = await this.redis.get(`room:${roomId}:participants`);
    if (cached) {
      return JSON.parse(cached);
    }
    const room = await this.roomModel.findById(roomId).exec();
    return room ? room.participants : [];
  }
}
