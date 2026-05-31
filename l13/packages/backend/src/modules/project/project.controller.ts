import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProjectService } from './project.service';
import { Response } from 'express';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: join(__dirname, '..', '..', '..', 'uploads'),
        filename: (_req, file, cb) => {
          const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
    }),
  )
  async createProject(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Body('srtContent') srtContent: string,
    @Body('createdBy') createdBy: string,
    @Res() res: Response,
  ) {
    const videoUrl = file ? `/uploads/${file.filename}` : null;
    const project = await this.projectService.createProject({
      name: name || 'Untitled Project',
      videoUrl,
      srtContent: srtContent || '',
      createdBy: createdBy || 'anonymous',
    });
    return res.status(HttpStatus.CREATED).json(project);
  }

  @Get()
  async findAll() {
    return this.projectService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.projectService.findOne(id);
  }
}
