export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-brand px-4 py-16">
      <div className="mb-8 text-center">
        <div className="font-serif text-3xl text-accent">Equity Compass</div>
        <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted">
          FRIEDD SNAKE Evaluator
        </div>
        <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
          Score every stock you&apos;re considering against the FRIEDD SNAKE framework.
        </p>
      </div>
      <div className="w-full max-w-sm rounded-xl bg-background p-8 shadow-xl">
        {children}
      </div>
    </div>
  );
}
