import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateEquipmentDto, UpdateEquipmentDto } from '../../modules/equipment/dto/equipment.dto';
import { CreatePriceListItemDto } from '../../modules/price-list/dto/create-price-list-item.dto';
import { UpdatePriceListItemDto } from '../../modules/price-list/dto/update-price-list-item.dto';
import { RescheduleRequestDto } from '../../modules/task-status/dto/reschedule-request.dto';

/**
 * QA 18.09, F10: מחרוזת של רווחים בלבד עברה את `@Length(1, …)` ונשמרה כ-"".
 * בעל העסק ראה "הלקוח ביקש מועד אחר" בלי שום טקסט.
 */
type Cls = new () => object;

async function errorsFor(cls: Cls, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('whitespace-only free text', () => {
  it.each<[string, Cls, object, string]>([
    ['reschedule note', RescheduleRequestDto, { note: '   ' }, 'note'],
    ['equipment kind', CreateEquipmentDto, { kind: ' \t ' }, 'kind'],
    ['equipment location', CreateEquipmentDto, { kind: 'מזגן', location: '  ' }, 'location'],
    ['equipment kind on update', UpdateEquipmentDto, { kind: '   ' }, 'kind'],
    ['price list description', CreatePriceListItemDto, { code: 'WS', description: '   ', price: '1' }, 'description'],
    ['price list description on update', UpdatePriceListItemDto, { description: '  ' }, 'description'],
  ])('rejects a blank %s', async (_l, cls, body, field) => {
    expect(await errorsFor(cls, body)).toEqual([field]);
  });

  it('accepts text with surrounding spaces and hands the service the trimmed value', async () => {
    const dto = plainToInstance(RescheduleRequestDto, { note: '  אפשר ביום שלישי?  ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.note).toBe('אפשר ביום שלישי?');
  });

  it('still rejects a non-string instead of trimming it', async () => {
    expect(await errorsFor(RescheduleRequestDto, { note: 5 })).toEqual(['note']);
  });
});
