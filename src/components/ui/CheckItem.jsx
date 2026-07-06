import checkFat from "../../assets/check-fat.svg";

export default function CheckItem({ children, className = "" }) {
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <div className="flex items-center py-0.5 shrink-0">
        <img src={checkFat} alt="" className="size-[18px]" />
      </div>
      <p className="flex-1 text-base leading-6 text-teal-950">{children}</p>
    </div>
  );
}
