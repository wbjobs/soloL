import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true })
export class Room {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  projectId: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  participants: string[];

  @Prop({ enum: ['waiting', 'active', 'closed'], default: 'waiting' })
  status: string;

  @Prop()
  createdBy: string;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
