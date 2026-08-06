const TONES = {
  teal: "bg-teal-050 text-teal-700",
  tealSolid: "bg-teal-700 text-white",
  tealDark: "bg-teal-100 text-teal-700",
  white: "bg-white text-teal-700",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
};

export default function Badge({ children, tone = "teal", className = "" }) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded px-3.5 py-2 text-xs font-bold uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
