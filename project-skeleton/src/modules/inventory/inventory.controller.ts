import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { AdjustQuantityDto } from './dto/adjust-quantity.dto';
import { ListInventoryQueryDto } from './dto/list-inventory.query.dto';
import { AnyRole, Roles } from '../../common/decorators/roles.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @AnyRole()
  @Get()
  findAll(@Req() req: Request, @Query() query: ListInventoryQueryDto) {
    return this.inventoryService.findAll(req.tenantId!, query);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('low-stock')
  findLowStock(@Req() req: Request, @Query() query: ListInventoryQueryDto) {
    return this.inventoryService.findLowStock(req.tenantId!, query);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  create(@Req() req: Request, @Body() body: CreateInventoryItemDto) {
    return this.inventoryService.create(req.tenantId!, body, req.user?.id);
  }

  // restock ידני, למשל אחרי הזמנת סחורה מספק - delta יכול להיות שלילי
  // (תיקון אחרי ספירת מלאי פיזית). התוצאה לא יכולה לרדת מתחת לאפס.
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch(':id/adjust')
  adjust(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustQuantityDto,
  ) {
    return this.inventoryService.adjustQuantity(req.tenantId!, id, body.delta, {
      note: body.note,
      actorUserId: req.user?.id,
    });
  }
}
