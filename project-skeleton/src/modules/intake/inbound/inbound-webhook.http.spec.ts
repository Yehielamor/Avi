import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { jsonBody } from '../../../common/json-body';
import { buildGlobalPipes } from '../../../common/validation/global-pipes';

import { InboundEmailWebhookController } from './inbound-email.controller';
import { InboundEmailService } from './inbound-email.service';
import { signInbound } from './inbound-signature';

/**
 * ה-webhook דרך HTTP אמיתי, עם אותו body parser ש-main.ts מתקין: החתימה
 * נבדקת על הבייטים המדויקים, ובקשה לא חתומה לא מגיעה לשירות בכלל.
 */
describe('POST /v1/intake/inbound', () => {
  const SECRET = 'k'.repeat(40);
  let app: INestApplication<Server>;
  const receive = jest.fn().mockResolvedValue({ kind: 'created', taskId: 't' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InboundEmailWebhookController],
      providers: [{ provide: InboundEmailService, useValue: { enabled: true, secret: SECRET, receive } }],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(jsonBody());
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(...buildGlobalPipes(true));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => receive.mockClear());

  const body = JSON.stringify({ to: 'a-bcdefghijk@in.craftmind-ai.com', from: 'x <x@y.com>', subject: 'שלום', text: 'גוף' });
  const now = () => Math.floor(Date.now() / 1000);
  const post = () => request(app.getHttpServer()).post('/v1/intake/inbound').set('Content-Type', 'application/json');

  it('accepts a correctly signed request', async () => {
    await post().set('X-CraftMind-Signature', signInbound(SECRET, now(), body)).send(body).expect(200);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ subject: 'שלום' }));
  });

  it('rejects a missing, wrong or replayed signature before doing any work', async () => {
    await post().send(body).expect(401);
    await post().set('X-CraftMind-Signature', signInbound('x'.repeat(40), now(), body)).send(body).expect(401);
    await post().set('X-CraftMind-Signature', signInbound(SECRET, now() - 3600, body)).send(body).expect(401);
    expect(receive).not.toHaveBeenCalled();
  });

  it('rejects a body changed after signing, even by one space', async () => {
    const sig = signInbound(SECRET, now(), body);
    await post().set('X-CraftMind-Signature', sig).send(body.replace('שלום', 'שלום ')).expect(401);
  });
});
