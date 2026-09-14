import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { JobTypeTemplatesService } from './job-type-templates.service';
import { CreateJobTypeTemplateDto } from './dto/create-job-type-template.dto';

@Controller('job-type-templates')
export class JobTypeTemplatesController {
  constructor(private readonly service: JobTypeTemplatesService) {}

  @Get()
  findAll(@Req() req: Request) {
    return this.service.findAllActive(req.tenantId!);
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const template = await this.service.findOne(req.tenantId!, id);
    if (!template) throw new NotFoundException('JobTypeTemplate not found');
    return template;
  }

  @Post()
  create(@Req() req: Request, @Body() body: CreateJobTypeTemplateDto) {
    return this.service.create(req.tenantId!, body, req.user?.id);
  }
}
