export function KobiLogo({
  size = "md",
  showWordmark = true,
}: {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
}) {
  return (
    <span className={`kobi-logo kobi-logo-${size}`}>
      <svg className="kobi-logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="38" height="38" rx="11" className="kobi-logo-tile" />
        <path d="M12.5 10.5v19M12.5 20l14-9.5M12.5 20l14 9.5" className="kobi-logo-line" />
        <circle cx="29.5" cy="29.5" r="2" className="kobi-logo-dot" />
      </svg>
      {showWordmark && <span className="kobi-logo-wordmark">Kobi</span>}
    </span>
  );
}
