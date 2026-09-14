import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { SearchCustomersQueryDto } from './dto/search-customers-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: ListCustomersQueryDto) {
    return this.customersService.findAll(req.tenantId!, query);
  }

  @Get('search')
  search(@Req() req: Request, @Query() query: SearchCustomersQueryDto) {
    return this.customersService.search(req.tenantId!, query.q, query.take);
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const customer = await this.customersService.findOne(req.tenantId!, id);
    // קודם הוחזר null עם 200 — הקליינט לא יכול היה להבדיל בין "לא
    // קיים" לבין "קיים וריק".
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  @Post()
  create(@Req() req: Request, @Body() body: CreateCustomerDto) {
    return this.customersService.create(req.tenantId!, body, req.user?.id);
  }
}
