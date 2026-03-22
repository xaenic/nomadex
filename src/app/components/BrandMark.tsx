export function BrandMark({
  alt = "Nomadex logo",
  className,
}: {
  alt?: string;
  className?: string;
}) {
  return (
    <img
      alt={alt}
      className={["brand-mark", className].filter(Boolean).join(" ")}
      decoding="async"
      draggable={false}
      src="/favicon.svg"
    />
  );
}
