export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="mb-8 text-center">
        <span className="text-lg font-semibold tracking-tight text-brand">
          FRIEDD SNAKE
        </span>
        <p className="mt-1 text-sm text-slate-500">Stock Evaluator</p>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
