export default function Logo({ className = "brand-logo" }) {
  // Intrinsic size reserves the 3:1 aspect box before the 473 kB
  // wordmark finishes loading, so the sign-in page never jumps when
  // the logo paints (the shift seen in the 23 Nov video frames).
  return <img src="/logo.png" alt="KopaBook" className={className} width="2736" height="912" />;
}
