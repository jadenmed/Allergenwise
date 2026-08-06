export default function SectionCard({ title, description, children }) {
  return (
    <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1 pb-4 border-b border-grey-300">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
          {title}
        </p>
        {description && <p className="text-sm text-grey-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}
