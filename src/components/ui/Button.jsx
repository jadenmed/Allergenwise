const VARIANTS = {
  primary: "bg-teal-700 text-white hover:bg-teal-800",
  outline: "bg-white text-teal-700 border border-grey-400 hover:bg-grey-100",
  outlineOnDark: "bg-white text-teal-700 border border-grey-400 hover:bg-grey-100",
};

const SIZES = {
  lg: "px-6 py-3.5 text-lg rounded-lg gap-2",
  sm: "px-4 py-2.5 text-base rounded-md gap-1.5",
};

export default function Button({
  children,
  icon,
  variant = "primary",
  size = "lg",
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors cursor-pointer ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {icon && <img src={icon} alt="" className="size-6" />}
      {children}
    </button>
  );
}
