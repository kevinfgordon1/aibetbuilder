import { useState } from "react";
import { X_OAUTH_PROVIDER, sendMagicLink, startOAuthSignIn } from "./signIn.js";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M14.5 8.5V6.8c0-.7.5-1 1.2-1H17V3h-2.1C12.2 3 11 4.3 11 6.6v1.9H9v2.8h2V21h3.5v-9.7h2.3l.4-2.8h-2.7z" />
    </svg>
  );
}

function here() {
  if (typeof window === "undefined") return { origin: "http://localhost", pathname: "/", search: "", hash: "" };
  return window.location;
}

export default function SignInPanel({ id, supabaseClient, initialStatus = null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  const track = (method) => {
    window.gtag?.("event", "sign_in_started", { method });
  };

  const run = async (method, action) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    track(method);
    try {
      const result = await action();
      if (!result.ok) setStatus(result);
      else if (result.kind === "sent") setStatus(result);
    } finally {
      setBusy(false);
    }
  };

  const onProvider = (provider) => run(provider, () => startOAuthSignIn(supabaseClient, provider, here()));

  const onMagicLink = (event) => {
    event.preventDefault();
    run("email", () => sendMagicLink(supabaseClient, email, here()));
  };

  const sent = status && status.kind === "sent";

  return (
    <div className="sip" id={id || undefined} data-signin-panel="true">
      <style>{`
        .sip { width: 100%; max-width: 420px; margin: 0 auto; text-align: left; font-family: 'DM Sans', sans-serif; }
        .sip, .sip * { box-sizing: border-box; }
        .sip-stack { display: flex; flex-direction: column; gap: 10px; }
        .sip-btn {
          width: 100%; border: none; border-radius: 12px; padding: 13px 16px;
          font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit;
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
        }
        .sip-btn:disabled { opacity: 0.6; cursor: wait; }
        .sip-google { background: #fff; color: #1f2937; box-shadow: 0 10px 40px rgba(59,130,246,0.15); }
        .sip-x { background: #0f1419; color: #fff; border: 1px solid rgba(255,255,255,0.16); }
        .sip-facebook { background: #1877F2; color: #fff; }
        .sip-or { display: flex; align-items: center; gap: 10px; color: #6b7280; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
        .sip-or::before, .sip-or::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.12); }
        .sip-label { display: block; font-size: 12px; font-weight: 600; color: #9ca3af; margin: 0 0 6px; }
        .sip-email {
          width: 100%; padding: 12px 12px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14); background: #12141a; color: #e8eaed;
          font: inherit; font-size: 15px;
        }
        .sip-email:focus { outline: 2px solid rgba(96,165,250,0.55); border-color: transparent; }
        .sip-send { background: rgba(59,130,246,0.16); color: #dbeafe; border: 1px solid rgba(96,165,250,0.45); }
        .sip-msg { margin: 0; font-size: 13px; line-height: 1.45; }
        .sip-error { color: #fca5a5; }
        .sip-rate { color: #fcd34d; }
        .sip-sent {
          background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.35);
          border-radius: 12px; padding: 14px 14px 12px; color: #d1fae5;
        }
        .sip-sent strong { display: block; color: #fff; font-size: 16px; margin-bottom: 4px; }
        .sip-sent p { margin: 0; font-size: 13px; line-height: 1.45; color: #a7f3d0; }
        .sip-again {
          margin-top: 8px; background: none; border: none; padding: 0; color: #93c5fd;
          font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
        }
      `}</style>
      <div className="sip-stack">
        {sent ? (
          <div className="sip-sent" role="status" data-signin-sent="true">
            <strong>Check your email</strong>
            <p>We sent a sign-in link to {status.email}. Open it to finish signing in — you’ll come back to this page.</p>
            <button type="button" className="sip-again" onClick={() => setStatus(null)}>Use a different email</button>
          </div>
        ) : null}

        <button type="button" className="sip-btn sip-google" data-signin-google="true" disabled={busy} onClick={() => onProvider("google")}>
          <GoogleIcon /> Sign in with Google
        </button>
        <button type="button" className="sip-btn sip-x" data-signin-x="true" disabled={busy} onClick={() => onProvider(X_OAUTH_PROVIDER)}>
          <XIcon /> Sign in with X
        </button>
        <button type="button" className="sip-btn sip-facebook" data-signin-facebook="true" disabled={busy} onClick={() => onProvider("facebook")}>
          <FacebookIcon /> Sign in with Facebook
        </button>

        {sent ? null : (
          <>
            <div className="sip-or">or email</div>
            <form onSubmit={onMagicLink}>
              <label className="sip-label" htmlFor={(id || "sip") + "-email"}>Email</label>
              <input
                id={(id || "sip") + "-email"}
                className="sip-email"
                data-signin-email="true"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="sip-btn sip-send" data-signin-send="true" disabled={busy} style={{ marginTop: 10 }}>
                {busy ? "Sending…" : "Send me a sign-in link"}
              </button>
            </form>
          </>
        )}

        {status && status.kind === "error" ? (
          <p className="sip-msg sip-error" role="alert" data-signin-error="true">{status.message}</p>
        ) : null}
        {status && status.kind === "rate_limit" ? (
          <p className="sip-msg sip-rate" role="alert" data-signin-rate-limit="true">{status.message}</p>
        ) : null}
      </div>
    </div>
  );
}
