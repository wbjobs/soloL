import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VersionDocument = Version & Document;

@Schema({ timestamps: true })
export class Version {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  projectId: Types.ObjectId;

  @Prop({ required: true })
  versionNumber: number;

  @Prop({ required: true, type: [Object] })
  blocks: Record<string, any>[];

  @Prop({ type: Object })
  diff: Record<string, any>;

  @Prop()
  createdBy: string;
}

export const VersionSchema = SchemaFactory.createForClass(Version);

VersionSchema.index({ projectId: 1, versionNumber: -1 });
