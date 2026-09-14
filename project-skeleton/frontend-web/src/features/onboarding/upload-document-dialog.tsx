import { Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui';
import { onboardingApi, type StoredSession } from './onboarding-api';

/** חייב להתאים ל-MAX_UPLOAD_BYTES בשרת; חריגה נדחית שם ב-400. */
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.txt,.csv';

/**
 * העלאת מסמכים קיימים של העסק.
 *
 * זה לא "צרף קובץ" גנרי: המערכת קוראת הצעות מחיר שהעסק נתן בעבר
 * והזמנות חומרים מספקים, ומסיקה מהן את המחירון ואת שיעור הרווח.
 * הטקסט בדיאלוג מסביר את זה, אחרת אף אחד לא יטרח.
 */
export function UploadDocumentDialog({
  session,
  onUploaded,
}: {
  session: StoredSession;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<'QUOTE' | 'MATERIAL_ORDER'>('QUOTE');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null): void => {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      // נבדק כאן *וגם* בשרת. כאן זה משוב מיידי; שם זה הגבול.
      setError(`הקובץ גדול מדי (${(f.size / 1024 / 1024).toFixed(1)}MB). המקסימום הוא 10MB.`);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const upload = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onboardingApi.uploadDocument(session, file, docType);
      toast.success('הקובץ נקלט', 'המערכת תלמד ממנו את המחירון');
      setFile(null);
      setOpen(false);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההעלאה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="צירוף מסמך">
          <Paperclip aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>צירוף מסמך</DialogTitle>
          <DialogDescription>
            הצעת מחיר או הזמנת חומרים מהעבר — המערכת תלמד מהן את המחירון ואת שיעור הרווח.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Field label="סוג המסמך" htmlFor="docType">
            <Select value={docType} onValueChange={(v) => setDocType(v as typeof docType)}>
              <SelectTrigger id="docType" aria-label="סוג המסמך">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="QUOTE">הצעת מחיר שנתנו ללקוח</SelectItem>
                <SelectItem value="MATERIAL_ORDER">הזמנת חומרים מספק</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="קובץ" htmlFor="file" error={error ?? undefined} hint="PDF, TXT או CSV · עד 10MB">
            <input
              ref={inputRef}
              id="file"
              type="file"
              accept={ACCEPT}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-fg-muted file:me-3 file:rounded-(--radius-sm) file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-xs file:text-fg hover:file:bg-surface-hover"
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            ביטול
          </Button>
          <Button size="sm" loading={busy} disabled={!file} onClick={() => void upload()}>
            העלה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
