import { useEffect, useRef, useState } from "react";
import { copyText, currentPageUrl, detectInAppBrowser, externalBrowserHref, inAppSignInNotice } from "./inAppBrowser.js";
import { X_LOGIN_ENABLED, X_OAUTH_PROVIDER, loadAuthSettings, normalizeOtpCode, oauthProviderEnabled, sendEmailCode, sendMagicLink, startOAuthSignIn, verifyEmailCode } from "./signIn.js";

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

function readUa() {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export default function SignInPanel({ id, supabaseClient, initialStatus = null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("start");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);
  const codeRef = useRef(null);
  const copyTimer = useRef(null);
  const [browser] = useState(() => {
    const ua = readUa();
    return { ...detectInAppBrowser(ua), ua };
  });
  // Hide X and Facebook until settings say they are on. A failed settings
  // read shows them and probes authorize before any redirect.
  const [gates, setGates] = useState({ x: false, facebook: false, google: true, probe: false });
  const inApp = browser.inApp;
  const fieldId = id || "sip";

  useEffect(() => {
    let cancelled = false;
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    loadAuthSettings({ url, anonKey }).then((settings) => {
      if (cancelled) return;
      if (!settings.ok) {
        setGates({ x: true, facebook: true, google: true, probe: true });
        return;
      }
      const x = oauthProviderEnabled(settings.external, "x");
      const facebook = oauthProviderEnabled(settings.external, "facebook");
      const google = oauthProviderEnabled(settings.external, "google");
      setGates({
        x: x === true || X_LOGIN_ENABLED,
        facebook: facebook === true,
        google: google !== false,
        probe: false,
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  const track = (method) => {
    window.gtag?.("event", "sign_in_started", { method });
  };

  const run = async (method, action) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setStatus(null);
    track(method);
    try {
      const result = await action();
      if (!result.ok) setStatus(result);
      else if (result.kind === "code" || result.kind === "sent") {
        if (result.email) setEmail(result.email);
        setStep(result.kind === "code" ? "code" : "link");
      }
      return result;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onProvider = (provider) => run(provider, () => {
    const known = gates.probe
      ? null
      : (provider === "google" ? gates.google : true);
    return startOAuthSignIn(supabaseClient, provider, here(), { enabled: known });
  });

  const onEmailCode = (event) => {
    event.preventDefault();
    setCode("");
    run("email_code", () => sendEmailCode(supabaseClient, email, here()));
  };

  const onMagicLink = () => {
    run("email", () => sendMagicLink(supabaseClient, email, here()));
  };

  const onVerify = (event) => {
    event.preventDefault();
    run("email_code", () => verifyEmailCode(supabaseClient, email, code));
  };

  const onCodeChange = (value) => {
    const next = normalizeOtpCode(value);
    setCode(next);
    if (next.length === 6) run("email_code", () => verifyEmailCode(supabaseClient, email, next));
  };

  const onResend = () => {
    setCode("");
    run("email_code", () => sendEmailCode(supabaseClient, email, here()));
  };

  const resetEmail = () => {
    setStep("start");
    setStatus(null);
    setCode("");
  };

  const onCopyLink = async () => {
    const result = await copyText(currentPageUrl(here()));
    if (!result.ok) {
      setStatus({ kind: "error", message: "Couldn’t copy the link. Select the address bar and open that page in Safari or Chrome." });
      return;
    }
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const externalHref = inApp ? externalBrowserHref(currentPageUrl(here()), browser.ua) : "";

  return (
    <div className="sip" id={id || undefined} data-signin-panel="true" data-signin-inapp={inApp ? "true" : "false"}>
      <style>{`
        .sip { width: 100%; max-width: 420px; margin: 0 auto; text-align: left; font-family: 'DM Sans', sans-serif; }
        .sip, .sip * { box-sizing: border-box; }
        .sip-stack { display: flex; flex-direction: column; gap: 10px; }
        .sip form { display: flex; flex-direction: column; gap: 10px; }
        .sip-btn {
          width: 100%; border: none; border-radius: 12px; padding: 13px 16px;
          font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit;
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
        }
        .sip-btn:disabled { opacity: 0.6; cursor: wait; }
        .sip-google { background: #fff; color: #1f2937; box-shadow: 0 10px 40px rgba(212,175,55,0.15); }
        .sip-x { background: #0f1419; color: #fff; border: 1px solid rgba(255,255,255,0.16); }
        .sip-facebook { background: #1877F2; color: #fff; }
        .sip-or { display: flex; align-items: center; gap: 10px; color: #6b7280; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
        .sip-or::before, .sip-or::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.12); }
        .sip-label { display: block; font-size: 12px; font-weight: 600; color: #9ca3af; margin: 0; }
        .sip-email {
          width: 100%; padding: 12px 12px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14); background: #12141a; color: #e8eaed;
          font: inherit; font-size: 15px;
        }
        .sip-email:focus { outline: 2px solid rgba(96,165,250,0.55); border-color: transparent; }
        .sip-code {
          width: 100%; padding: 12px 12px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14); background: #12141a; color: #fff;
          font: inherit; font-size: 24px; font-weight: 700; letter-spacing: 0.35em; text-align: center;
        }
        .sip-code:focus { outline: 2px solid rgba(96,165,250,0.55); border-color: transparent; }
        .sip-send { background: rgba(212,175,55,0.16); color: #dbeafe; border: 1px solid rgba(96,165,250,0.45); }
        .sip-linkbtn { background: transparent; color: #e8eaed; border: 1px solid rgba(255,255,255,0.16); }
        .sip-msg { margin: 0; font-size: 15px; line-height: 1.45; font-weight: 700; }
        /* Two classes so this beats .signin-modal p (gray, 14px) in the popup. */
        .sip-msg.sip-error {
          margin: 0; color: #fff; background: #9f1239; border: 1px solid #fecdd3;
          border-radius: 10px; padding: 12px 14px; font-size: 15px; line-height: 1.45; font-weight: 700;
        }
        .sip-msg.sip-rate {
          margin: 0; color: #1c1917; background: #fbbf24; border: 1px solid #fde68a;
          border-radius: 10px; padding: 12px 14px; font-size: 15px; line-height: 1.45; font-weight: 700;
        }
        .sip-sent {
          background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.35);
          border-radius: 12px; padding: 14px 14px 12px; color: #d1fae5;
          display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
        }
        .sip-sent strong { display: block; color: #fff; font-size: 16px; margin: 0; }
        .sip-sent p.sip-sent-copy { margin: 0; font-size: 13px; line-height: 1.45; color: #a7f3d0; font-weight: 500; }
        .sip-again {
          display: block; width: fit-content; margin: 0; background: none; border: none; padding: 0; color: #f5d76e;
          font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
        }
        .sip-hint.sip-hint-copy { margin: 0; font-size: 12px; line-height: 1.45; color: #9ca3af; font-weight: 500; }
        .sip-inapp {
          background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.45);
          border-radius: 12px; padding: 12px 14px;
        }
        .sip-inapp strong { display: block; color: #fff; font-size: 15px; margin-bottom: 4px; }
        .sip-inapp p.sip-inapp-copy { margin: 0; font-size: 13px; line-height: 1.45; color: #fef3c7; font-weight: 600; }
        .sip-inapp-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .sip-inapp-actions .sip-btn { width: auto; flex: 1 1 140px; }
        .sip-copy { background: #fff; color: #1f2937; }
        .sip-open { background: transparent; color: #fde68a; border: 1px solid rgba(253,230,138,0.5); text-decoration: none; }
      `}</style>
      <div className="sip-stack">
        {inApp && step !== "code" ? (
          <div className="sip-inapp" role="note" data-signin-inapp-note="true">
            <strong>Open in Safari or Chrome</strong>
            <p className="sip-inapp-copy">{inAppSignInNotice(browser)}</p>
            <div className="sip-inapp-actions">
              <button type="button" className="sip-btn sip-copy" data-signin-copy-link="true" onClick={onCopyLink}>
                {copied ? "Link copied" : "Copy link"}
              </button>
              {externalHref ? (
                <a className="sip-btn sip-open" data-signin-open-external="true" href={externalHref}>Open in Chrome</a>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "code" ? (
          <form onSubmit={onVerify} noValidate>
            <div className="sip-sent" role="status" data-signin-code="true">
              <strong>Check your email</strong>
              <p className="sip-sent-copy">We sent a 6-digit code to {email}. Enter it here to sign in on this device. You don’t need to open the link.</p>
            </div>
            <label className="sip-label" htmlFor={fieldId + "-code"}>6-digit code</label>
            <input
              ref={codeRef}
              id={fieldId + "-code"}
              className="sip-code"
              data-signin-otp="true"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              maxLength={6}
              pattern="[0-9]*"
              placeholder="••••••"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              aria-invalid={status && status.kind === "error" ? "true" : "false"}
              required
            />
            <button type="submit" className="sip-btn sip-send" data-signin-verify="true" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="sip-again" data-signin-resend="true" disabled={busy} onClick={onResend}>Send a new code</button>
            <button type="button" className="sip-again" onClick={resetEmail}>Use a different email</button>
          </form>
        ) : null}

        {step === "link" ? (
          <div className="sip-sent" role="status" data-signin-sent="true">
            <strong>Check your email</strong>
            <p className="sip-sent-copy">We sent a sign-in link to {email}. Open it in this browser to finish signing in. Opening it somewhere else signs that browser in, and this page stays signed out.</p>
            <button type="button" className="sip-again" data-signin-use-code="true" onClick={() => { setStatus(null); setCode(""); setStep("code"); }}>Enter a 6-digit code instead</button>
            <button type="button" className="sip-again" onClick={resetEmail}>Use a different email</button>
          </div>
        ) : null}

        {step === "start" ? (
          <>
            {inApp ? null : (
              <>
                <button type="button" className="sip-btn sip-google" data-signin-google="true" disabled={busy} onClick={() => onProvider("google")}>
                  <GoogleIcon /> Sign in with Google
                </button>
                {gates.x ? (
                  <button type="button" className="sip-btn sip-x" data-signin-x="true" disabled={busy} onClick={() => onProvider(X_OAUTH_PROVIDER)}>
                    <XIcon /> Sign in with X
                  </button>
                ) : null}
                {gates.facebook ? (
                  <button type="button" className="sip-btn sip-facebook" data-signin-facebook="true" disabled={busy} onClick={() => onProvider("facebook")}>
                    <FacebookIcon /> Sign in with Facebook
                  </button>
                ) : null}
                <div className="sip-or">or email</div>
              </>
            )}
            <form onSubmit={onEmailCode} noValidate>
              <label className="sip-label" htmlFor={fieldId + "-email"}>Email</label>
              <input
                id={fieldId + "-email"}
                className="sip-email"
                data-signin-email="true"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={status && status.kind === "error" ? "true" : "false"}
                required
              />
              <button type="submit" className="sip-btn sip-send" data-signin-email-code="true" disabled={busy}>
                {busy ? "Sending…" : "Email me a 6-digit code"}
              </button>
            </form>
            <p className="sip-hint sip-hint-copy">The code signs you in on this device. A link only signs in the browser that opens it.</p>
            <button type="button" className="sip-btn sip-linkbtn" data-signin-send="true" disabled={busy} onClick={onMagicLink}>
              Send me a sign-in link
            </button>
          </>
        ) : null}

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
