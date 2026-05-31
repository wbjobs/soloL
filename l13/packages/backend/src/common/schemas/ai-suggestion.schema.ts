import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AISuggestionDocument = AISuggestion & Document;

@Schema({ timestamps: true })
export class AISuggestion {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  projectId: Types.ObjectId;

  @Prop({ required: true })
  blockIndex: number;

  @Prop({ required: true })
  originalText: string;

  @Prop({ required: true })
  suggestedText: string;

  @Prop({ required: true })
  startTimeOffset: number;

  @Prop({ required: true })
  endTimeOffset: number;

  @Prop({ required: true })
  textDiffRate: number;

  @Prop({ required: true, enum: ['timeline-offset', 'text-diff', 'both'] })
  diffType: string;

  @Prop({ enum: ['pending', 'accepted', 'rejected'], default: 'pending' })
  status: string;

  @Prop()
  adoptedBy: string;
}

export const AISuggestionSchema = SchemaFactory.createForClass(AISuggestion);

AISuggestionSchema.index({ projectId: 1, blockIndex: 1 });
