import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCircle2, Circle, CreditCard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type PlanChoice = {
  id: "starter" | "core";
  tier: "free" | "enterprise";
  label: string;
  priceLabel: string;
  summary: string;
};

const PLAN_CHOICES: PlanChoice[] = [
  {
    id: "starter",
    tier: "free",
    label: "Starter",
    priceLabel: "GHC 0 / mo.",
    summary: "Good for churches starting with small teams and simple tracking.",
  },
  {
    id: "core",
    tier: "enterprise",
    label: "Core",
    priceLabel: "GHC 400 / mo.",
    summary: "For churches that need unlimited members, leaders, and ministries.",
  },
];

const FAQ_ITEMS = [
  {
    q: "How does signup work right now?",
    a: "You select a package, create your account, and complete payment setup. Hubtel is pending approval, so demo bypass can be used for now.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes. Churches can start with Starter and move to Core when they need expanded capacity.",
  },
  {
    q: "Do I need a card for Starter?",
    a: "No. Starter is free. Core shows payment setup in signup.",
  },
];

const DEMO_BYPASS_ENABLED =
  String(import.meta.env.VITE_ENABLE_DEMO_PAYMENT_BYPASS ?? "true").toLowerCase() === "true";

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f8fa] px-4 py-8 text-[#111111] md:px-8">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-3xl border border-[#d6dde5] bg-white shadow-sm lg:grid-cols-[1.1fr_1fr]">
        <div className="relative border-b border-[#e6ebf0] bg-[#fbfcfd] p-8 lg:border-b-0 lg:border-r lg:p-12">
          <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(#e6edf5_1px,transparent_1px)] [background-size:20px_20px]" />
          <div className="relative">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#25c06d]">Welcome to SheepMug</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-[#0f172a]">{title}</h1>
            <p className="mt-4 max-w-xl text-base text-[#475569]">{subtitle}</p>

            <div className="mt-8 space-y-4 rounded-2xl border border-[#e6ebf0] bg-white/80 p-5">
              {FAQ_ITEMS.map((item) => (
                <div key={item.q} className="border-b border-[#edf2f7] pb-3 last:border-b-0 last:pb-0">
                  <p className="font-semibold text-[#111827]">{item.q}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#4b5563]">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 md:p-10">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && isAuthenticated) {
      window.location.href = "/cms";
    }
  }, [isAuthenticated, loading]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      window.location.href = "/cms";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to your church workspace"
      subtitle="Use the same standard login for both the landing site and CMS."
    >
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-2xl font-semibold text-[#111827]">Login</h2>
        <p className="mt-2 text-sm text-[#6b7280]">Continue to your dashboard and ministry tools.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[#111827]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
              placeholder="you@church.org"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[#111827]">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
              placeholder="Enter your password"
            />
          </label>

          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-xl bg-[#25c06d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1faa61] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#4b5563]">
          New to SheepMug?{" "}
          <Link to="/signup" className="font-semibold text-[#0f766e] hover:underline">
            Create account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signup, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const initialPlanId = new URLSearchParams(window.location.search).get("plan")?.toLowerCase() === "core" ? "core" : "starter";
  const [selectedPlanId, setSelectedPlanId] = useState<PlanChoice["id"]>(initialPlanId);
  const [fullName, setFullName] = useState("");
  const [churchName, setChurchName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!loading && isAuthenticated) {
      window.location.href = "/cms";
    }
  }, [isAuthenticated, loading]);

  const selectedPlan = useMemo(
    () => PLAN_CHOICES.find((p) => p.id === selectedPlanId) ?? PLAN_CHOICES[0],
    [selectedPlanId],
  );

  const submitSignup = async ({ demoBypass }: { demoBypass: boolean }) => {
    setError("");
    setSuccessMessage("");

    if (!agree) {
      setError("Please confirm that you agree to continue.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError("Please enter your full name.");
      return;
    }
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || "User";

    setSubmitting(true);
    try {
      await signup({
        email: email.trim(),
        password,
        firstName,
        lastName,
        organizationName: churchName.trim() || undefined,
        subscriptionTier: selectedPlan.tier,
        demoBypass,
      });

      setSuccessMessage("Account created. Redirecting to your workspace...");
      window.location.href = "/cms";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Signup failed. Please try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Choose your package and create your account"
      subtitle="Set up your church workspace with a clean signup flow and payment-ready experience."
    >
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2 text-sm">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                if (n < step) setStep(n as 1 | 2 | 3);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${
                step === n ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#f3f4f6] text-[#4b5563]"
              }`}
            >
              {step > n ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              Step {n}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <div>
            <h2 className="text-2xl font-semibold text-[#111827]">Choose a package</h2>
            <p className="mt-2 text-sm text-[#6b7280]">Select your plan before account setup.</p>
            <div className="mt-6 space-y-3">
              {PLAN_CHOICES.map((plan) => {
                const active = selectedPlanId === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      active
                        ? "border-[#25c06d] bg-[#f0fdf4] shadow-[0_0_0_1px_rgba(37,192,109,0.25)]"
                        : "border-[#e5e7eb] bg-white hover:border-[#cbd5e1]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-[#111827]">{plan.label}</p>
                        <p className="mt-1 text-sm text-[#4b5563]">{plan.summary}</p>
                      </div>
                      <p className="text-lg font-semibold text-[#0f172a]">{plan.priceLabel}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#25c06d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1faa61]"
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <h2 className="text-2xl font-semibold text-[#111827]">Create your account</h2>
            <p className="mt-2 text-sm text-[#6b7280]">This owner account can invite leaders after setup.</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#111827]">Full name</span>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#111827]">Church name</span>
                <input
                  type="text"
                  required
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#111827]">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#111827]">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#111827]">Confirm password</span>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#d1d5db] px-4 py-3 text-sm outline-none ring-[#25c06d] focus:ring-2"
                />
              </label>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-[#d1d5db] px-4 py-3 text-sm font-semibold text-[#111827]"
              >
                Back
              </button>
              <button
                type="submit"
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-[#25c06d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1faa61]"
              >
                Continue to payment
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="text-2xl font-semibold text-[#111827]">Payment setup</h2>
            <p className="mt-2 text-sm text-[#6b7280]">Hubtel payment will be connected after approval.</p>

            <div className="mt-5 rounded-2xl border border-[#dbe3ec] bg-[#f8fbff] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#64748b]">Selected package</p>
                  <p className="text-xl font-semibold text-[#111827]">{selectedPlan.label}</p>
                </div>
                <p className="text-xl font-semibold text-[#0f172a]">{selectedPlan.priceLabel}</p>
              </div>
              <p className="mt-3 text-sm text-[#475569]">{selectedPlan.summary}</p>
            </div>

            <label className="mt-4 flex items-start gap-2 rounded-xl border border-[#e5e7eb] bg-white p-3 text-sm text-[#374151]">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#cbd5e1] text-[#25c06d] focus:ring-[#25c06d]"
              />
              <span>I agree to continue and verify my account email if confirmation is required.</span>
            </label>

            {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            {successMessage ? (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>
            ) : null}

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-semibold text-[#334155]"
              >
                <CreditCard className="h-4 w-4" />
                Hubtel payment (Pending approval)
              </button>

              {selectedPlan.tier === "free" ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitSignup({ demoBypass: false })}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#25c06d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1faa61] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Creating account..." : "Create Starter account"}
                </button>
              ) : null}

              {selectedPlan.tier !== "free" && DEMO_BYPASS_ENABLED ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitSignup({ demoBypass: true })}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#25c06d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1faa61] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Creating account..." : "Continue with demo bypass"}
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-[#d1d5db] px-4 py-3 text-sm font-semibold text-[#111827]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-[#d1d5db] px-4 py-3 text-sm font-semibold text-[#111827]"
              >
                Already have an account
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </AuthShell>
  );
}
