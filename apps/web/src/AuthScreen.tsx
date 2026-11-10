import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";

export function SignIn({
  onSubmit,
  onReset,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  onReset: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await onSubmit(email, String(data.get("password")));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onReset(email);
      setNotice("If this account exists, a recovery link has been sent.");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not send recovery email.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <div className="signin-art">
        <div className="brand">
          <span className="brand-icon">
            H<span>.</span>
          </span>
          <span>
            <strong>HAULMARK</strong>
            <small>OPERATIONS SYSTEM</small>
          </span>
        </div>
        <div className="signin-message">
          <span>BUILT FOR THE ROAD AHEAD</span>
          <h1>
            Every truck.
            <br />
            Every trip.
            <br />
            <i>One clear view.</i>
          </h1>
          <p>
            Stay close to your fleet, your people, and the work that keeps
            business moving.
          </p>
        </div>
        <div className="signin-foot">
          FLEET MANAGEMENT · DISPATCH · ATTENDANCE
        </div>
      </div>
      <div className="signin-form-wrap">
        <form className="signin-form" onSubmit={submit}>
          <div className="eyebrow">SECURE WORKSPACE</div>
          <h2>Welcome back</h2>
          <p>Sign in to your operations dashboard.</p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Enter your password"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : "Sign in to workspace"}
            <ArrowRight size={17} />
          </button>
          <button
            className="forgot"
            type="button"
            onClick={() => void reset()}
            disabled={busy}
          >
            Forgot password?
          </button>
          <small>Accounts are created by your administrator.</small>
        </form>
      </div>
    </div>
  );
}

export function ResetPassword({
  onSubmit,
}: {
  onSubmit: (password: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="setup">
      <div className="setup-mark">H</div>
      <h1>Set a new password</h1>
      <form
        className="reset-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          const password = String(data.get("password"));
          if (password.length < 12) {
            setError("Use at least 12 characters.");
            setBusy(false);
            return;
          }
          try {
            await onSubmit(password);
          } catch (problem) {
            setError(
              problem instanceof Error
                ? problem.message
                : "Could not update password.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          New password
          <input
            type="password"
            name="password"
            minLength={12}
            required
            autoComplete="new-password"
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" disabled={busy}>
          Save password
        </button>
      </form>
    </div>
  );
}
