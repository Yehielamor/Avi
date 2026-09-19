import type { ReactNode } from 'react';

/** המעטפת של כל דף שהלקוח של העסק פותח מקישור: שם העסק, תוכן, וזהו. */
export function PublicShell({ business, children }: { business?: string; children: ReactNode }) {
  return (
    <div dir="rtl" className="min-h-dvh bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-md px-5 py-4">
          <p className="text-base font-semibold text-fg">{business ?? ' '}</p>
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-6">{children}</main>
      <footer className="mx-auto max-w-md px-5 pb-8 text-center text-2xs text-fg-subtle">מופעל ע״י CraftMind</footer>
    </div>
  );
}
