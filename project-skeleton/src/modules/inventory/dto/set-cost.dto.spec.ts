import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SetCostDto } from './set-cost.dto';

/** QA 18.09, F15: `{}` מחק את העלות בשקט. */
describe('SetCostDto', () => {
  const errors = async (body: object) => (await validate(plainToInstance(SetCostDto, body))).map((e) => e.property);

  it('rejects an empty body instead of clearing the cost', async () => {
    expect(await errors({})).toEqual(['unitCost']);
  });

  it('accepts an explicit null to clear the cost', async () => {
    expect(await errors({ unitCost: null })).toEqual([]);
  });

  it.each(['12.34', '0', '9999999999.99'])('accepts %s', async (unitCost) => {
    expect(await errors({ unitCost })).toEqual([]);
  });

  it.each([['12.345'], [''], [12.5]])('rejects %p', async (unitCost) => {
    expect(await errors({ unitCost })).toEqual(['unitCost']);
  });
});
