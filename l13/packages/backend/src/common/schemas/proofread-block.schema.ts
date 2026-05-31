import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProofreadBlockDocument = ProofreadBlock & Document;

@Schema({ timestamps: true })
export class ProofreadBlock {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  projectId: Types.ObjectId;

  @Prop({ required: true })
  index: number;

  @Prop({ required: true })
  startTime: number;

  @Prop({ required: true })
  endTime: number;

  @Prop({ required: true })
  originalText: string;

  @Prop({ default: '' })
  correctedText: string;

  @Prop({ enum: ['pending', 'in-progress', 'done'], default: 'pending' })
  status: string;

  @Prop()
  assignedTo: string;
}

export const ProofreadBlockSchema = SchemaFactory.createForClass(ProofreadBlock);

ProofreadBlockSchema.index({ projectId: 1, index: 1 });
