import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProofreadEventDocument = ProofreadEvent & Document;

@Schema({ timestamps: true })
export class ProofreadEvent {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  projectId: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({
    required: true,
    enum: ['edit', 'adopt-ai', 'reject-ai', 'conflict-resolve', 'timeline-adjust', 'status-change'],
  })
  eventType: string;

  @Prop({ required: true })
  blockIndex: number;

  @Prop({ type: Object })
  detail: Record<string, any>;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const ProofreadEventSchema = SchemaFactory.createForClass(ProofreadEvent);

ProofreadEventSchema.index({ projectId: 1, userId: 1 });
ProofreadEventSchema.index({ projectId: 1, eventType: 1 });
