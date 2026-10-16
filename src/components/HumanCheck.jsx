import { useEffect, useRef, useState } from "react";

// FVAVerify "Verify you are human" checkbox for KopaBook's public forms.
// The widget only renders once FVA_VERIFY_SITEKEY is set (after FVAVerify
// goes live and a KopaBook site key is issued). Until then this renders
// nothing and onToken stays null.
export const FVA_VERIFY_SITEKEY = "";

export default function HumanCheck({ onToken }) {
  const mountRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!FVA_VERIFY_SITEKEY || !mountRef.current) return;
    let cancelled = false;
    function render() {
      if (cancelled || !window.FVAVerify || !mountRef.current) return;
      mountRef.current.innerHTML = "";
      window.FVAVerify.render(mountRef.current, {
        sitekey: FVA_VERIFY_SITEKEY,
        onSuccess: (token) => { setReady(true); onToken && onToken(token); },
      });
    }
    if (window.FVAVerify) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://fva70k.com/verify.js";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!FVA_VERIFY_SITEKEY) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      <div ref={mountRef} />
      {!ready && <p className="hint" style={{ margin: "6px 0 0" }}>Please verify you are human to continue.</p>}
    </div>
  );
}
