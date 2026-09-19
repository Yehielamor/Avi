import {
  automatedReason,
  generateLocalPart,
  gmailVerification,
  localPartFor,
  sourceIdFor,
  unwrapForwarded,
  type InboundMessage,
} from './inbound-mail';
import { signInbound, verifyInbound } from './inbound-signature';

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({ from: 'דני <dani@gmail.com>', subject: 's', text: 't', ...over });

describe('generateLocalPart', () => {
  it('prefixes the subdomain and adds 10 random base32 characters', () => {
    const a = generateLocalPart('AC-Maintenance');
    expect(a).toMatch(/^ac-maintenance-[a-z2-7]{10}$/);
    expect(generateLocalPart('AC-Maintenance')).not.toBe(a);
  });
});

describe('localPartFor', () => {
  const D = 'in.craftmind-ai.com';
  it('finds our address among several recipients, ignoring case, names and +tags', () => {
    expect(localPartFor('Owner <owner@gmail.com>, "x" <AC-abcdefghij+gmail@IN.craftmind-ai.com>', D)).toBe('ac-abcdefghij');
  });
  it('ignores other domains, including look-alikes', () => {
    expect(localPartFor('ac-abc@in.craftmind-ai.com.evil.com', D)).toBeNull();
    expect(localPartFor('ac-abc@craftmind-ai.com', D)).toBeNull();
  });
});

describe('gmailVerification', () => {
  it('extracts the code and link from Gmail’s forwarding confirmation', () => {
    const v = gmailVerification(
      msg({
        from: 'Gmail Team <forwarding-noreply@google.com>',
        subject: '(#123456789) Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com',
        text: 'Confirmation code: 123456789\nTo allow, click https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz\nThanks',
      }),
    );
    expect(v).toEqual({ code: '123456789', url: 'https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz' });
  });
  it('is null for anyone else, even with a 9-digit number', () => {
    expect(gmailVerification(msg({ text: 'order 123456789' }))).toBeNull();
  });
});

describe('automatedReason', () => {
  it.each([
    [{ autoSubmitted: 'auto-replied' }, 'auto-submitted'],
    [{ precedence: 'bulk' }, 'bulk'],
    [{ listId: '<news.shop.com>' }, 'mailing-list'],
    [{ from: 'MAILER-DAEMON@mx.google.com' }, 'no-reply sender'],
    [{ from: 'noreply@shop.com' }, 'no-reply sender'],
  ])('flags %o', (over, reason) => {
    expect(automatedReason(msg(over))).toBe(reason);
  });
  it('lets a person through, including Auto-Submitted: no', () => {
    expect(automatedReason(msg({ autoSubmitted: 'no' }))).toBeNull();
  });
});

describe('unwrapForwarded', () => {
  it('finds the original sender of a manual Gmail forward', () => {
    const text = 'שים לב\n\n---------- Forwarded message ---------\nFrom: Rina Levi <rina@walla.co.il>\nDate: Fri, 18 Sep 2026\nSubject: המזגן מטפטף\nTo: <owner@gmail.com>\n\nשלום, המזגן בסלון מטפטף מים.';
    expect(unwrapForwarded(text)).toEqual({ from: 'Rina Levi <rina@walla.co.il>', subject: 'המזגן מטפטף', body: 'שלום, המזגן בסלון מטפטף מים.' });
  });
  it('handles the Hebrew Gmail marker', () => {
    const text = '---------- הודעה שהועברה ---------\nמאת: רינה <rina@walla.co.il>\nנושא: תקלה\n\nגוף';
    expect(unwrapForwarded(text)).toMatchObject({ from: 'רינה <rina@walla.co.il>', subject: 'תקלה', body: 'גוף' });
  });
  it('is null for an ordinary email', () => {
    expect(unwrapForwarded('שלום, המזגן לא מקרר')).toBeNull();
  });
});

describe('sourceIdFor', () => {
  it('normalises the Message-ID', () => {
    expect(sourceIdFor(msg({ messageId: ' <ABC@mail.gmail.com> ' }))).toBe('mid:abc@mail.gmail.com');
  });
  it('falls back to a stable content hash', () => {
    expect(sourceIdFor(msg())).toBe(sourceIdFor(msg()));
    expect(sourceIdFor(msg())).not.toBe(sourceIdFor(msg({ text: 'other' })));
  });
});

describe('inbound signature', () => {
  const secret = 's'.repeat(32);
  const body = Buffer.from('{"to":"x"}');
  const now = 1_800_000_000;

  it('accepts a fresh, correct signature', () => {
    expect(verifyInbound(signInbound(secret, now, body), body, secret, now + 10)).toEqual({ ok: true });
  });
  it('rejects a changed body, a wrong secret, and a replay after 5 minutes', () => {
    const sig = signInbound(secret, now, body);
    expect(verifyInbound(sig, Buffer.from('{"to":"y"}'), secret, now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyInbound(sig, body, 'x'.repeat(32), now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyInbound(sig, body, secret, now + 301)).toEqual({ ok: false, reason: 'stale' });
  });
  it('rejects missing and malformed headers', () => {
    expect(verifyInbound(undefined, body, secret, now)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyInbound('t=abc,v1=zz', body, secret, now)).toEqual({ ok: false, reason: 'malformed' });
  });
});
