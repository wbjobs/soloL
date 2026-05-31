import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true })
  name: string;

  @Prop()
  videoUrl: string;

  @Prop()
  srtContent: string;

  @Prop({ default: 0 })
  blockCount: number;

  @Prop({ default: 'active' })
  status: string;

  @Prop()
  createdBy: string;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
