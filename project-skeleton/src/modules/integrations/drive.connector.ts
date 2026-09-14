import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { Connector } from './connector.interface';
import { GoogleAuthClient } from './google-oauth.service';

// ============================================================
// Drive Connector - מסמך הארכיטקטורה, סעיף 3.2.
// שימוש עיקרי ב-MVP: שמירת PDF-ים של חשבוניות (Invoicing module,
// עדיין לא נבנה) בתיקייה ייעודית בדרייב של הטננט עצמו.
//
// scope הוא drive.file בלבד (לא drive מלא) - האפליקציה רואה/עורכת
// רק קבצים שהיא עצמה יצרה, לא את כל ה-Drive של הלקוח. זו בחירת
// אבטחה מכוונת, לא מגבלה טכנית.
// ============================================================

export class DriveConnector implements Connector {
  readonly provider = 'DRIVE';
  private readonly drive: drive_v3.Drive;

  constructor(private readonly authClient: GoogleAuthClient) {
    this.drive = google.drive({ version: 'v3', auth: authClient });
  }

  // לא `async`: אין כאן await, וה-interface מחייב Promise. `async`
  // ריק מפעיל את require-await ומסתיר מתי באמת יש קריאת רשת.
  ensureAuthenticated(): Promise<void> {
    if (!this.authClient.credentials.refresh_token) {
      return Promise.reject(new Error('DriveConnector: no refresh_token set on auth client'));
    }
    return Promise.resolve();
  }

  async fetch<T = drive_v3.Schema$File[]>(
    resource: string,
    filter: Record<string, unknown> = {},
  ): Promise<T> {
    if (resource !== 'files') {
      throw new Error(`DriveConnector.fetch: unsupported resource "${resource}"`);
    }
    const res = await this.drive.files.list({
      q: (filter.query as string) ?? undefined,
      fields: 'files(id, name, mimeType, webViewLink, createdTime)',
      pageSize: (filter.pageSize as number) ?? 20,
    });
    return (res.data.files ?? []) as unknown as T;
  }

  async send<T = { fileId: string; webViewLink: string | null }>(
    resource: string,
    payload: unknown,
  ): Promise<T> {
    if (resource !== 'file') {
      throw new Error(`DriveConnector.send: unsupported resource "${resource}"`);
    }
    const { name, mimeType, content, folderId } = payload as {
      name: string;
      mimeType: string;
      content: Buffer;
      folderId?: string;
    };

    const res = await this.drive.files.create({
      requestBody: { name, parents: folderId ? [folderId] : undefined },
      media: { mimeType, body: Readable.from(content) },
      fields: 'id, webViewLink',
    });

    return { fileId: res.data.id!, webViewLink: res.data.webViewLink ?? null } as unknown as T;
  }

  // Drive לא תומך ב-subscribe במובן הזה ב-MVP - אין push notifications
  // נדרשות ל-Invoicing (זה פעולה יזומה, לא reactive)
  subscribe(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
