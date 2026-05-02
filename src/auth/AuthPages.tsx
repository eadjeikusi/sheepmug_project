import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCircle2, Circle, CreditCard, Eye, EyeOff, Minus, Plus, Scale } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import sheepmugLogo from "../../apps/mobile/assets/sheepmug-logo.png";
import { supabase } from "../app/utils/supabase";
import type { BillingPlanId } from "../app/config/paidPlans";

type PlanChoice = {
  id: BillingPlanId;
  billingPlanId: BillingPlanId;
  tier: "enterprise";
  billingCycle: "monthly" | "biannual" | "yearly";
  label: string;
  priceLabel: string;
  summary: string;
};

const PLAN_CHOICES: PlanChoice[] = [
  {
    id: "core_monthly",
    billingPlanId: "core_monthly",
    tier: "enterprise",
    billingCycle: "monthly",
    label: "Core Plan",
    priceLabel: "GH₵ 250 / mo",
    summary: "Full SheepMug for your church, billed every month.",
  },
  {
    id: "core_6months",
    billingPlanId: "core_6months",
    tier: "enterprise",
    billingCycle: "biannual",
    label: "6 Months",
    priceLabel: "GH₵ 1,400 / 6 mo",
    summary: "Save 100 GHS compared to paying monthly for the same period.",
  },
  {
    id: "core_annual",
    billingPlanId: "core_annual",
    tier: "enterprise",
    billingCycle: "yearly",
    label: "All Year Bundle",
    priceLabel: "GH₵ 2,750 / yr",
    summary: "Save 250 GHS vs paying monthly for a full year.",
  },
];

function planIdFromSearch(q: string | null): BillingPlanId {
  const v = (q || "").toLowerCase().trim();
  if (v === "core_6months" || v === "6m" || v === "six" || v === "biannual") return "core_6months";
  if (v === "core_annual" || v === "yearly" || v === "annual" || v === "12m") return "core_annual";
  if (v === "core_monthly" || v === "monthly" || v === "month") return "core_monthly";
  return "core_monthly";
}

const FAQ_ITEMS = [
  {
    q: "How does billing work?",
    a: "You pick a plan during signup and complete payment securely with Paystack. Your organization unlocks full limits after the first successful charge.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Organization owners can open Paystack’s subscription page from Settings → Subscription to turn off renewal. Access continues until the end of the paid period.",
  },
  {
    q: "Do you offer refunds?",
    a: "We do not refund completed periods. If you cancel, your subscription stays active until the end of the current billing window.",
  },
];

const DEMO_BYPASS_ENABLED =
  String(import.meta.env.VITE_ENABLE_DEMO_PAYMENT_BYPASS ?? "true").toLowerCase() === "true";
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (typeof window !== "undefined") {
    try {
      const configured = new URL(API_BASE, window.location.origin);
      const current = new URL(window.location.origin);
      const configuredHost = configured.hostname.replace(/^www\./i, "").toLowerCase();
      const currentHost = current.hostname.replace(/^www\./i, "").toLowerCase();
      if (configuredHost === currentHost) {
        return path;
      }
    } catch {
      // keep configured API base if URL parse fails
    }
  }
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseApiResponse(response: Response): Promise<Record<string, any>> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    return (await response.json().catch(() => ({}))) as Record<string, any>;
  }
  const raw = await response.text().catch(() => "");
  return {
    error: raw.startsWith("<")
      ? "Server returned HTML instead of JSON. Please check API deployment settings."
      : raw || "Unexpected API response.",
  };
}

function looksNotFoundError(msg: string): boolean {
  return /not[_\s-]?found|could not be found|404/i.test(msg);
}

function formatCountdown(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4f6f8] px-4 py-8 text-[#111111] md:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_1px_1px,#e5e7eb_1px,transparent_0)] [background-size:26px_26px]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:repeating-radial-gradient(circle_at_0%_0%,transparent_0,transparent_42px,#d6dbe2_43px,transparent_44px)]" />

      <div className="relative mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl border border-[#dce1e6] bg-[#fcfdff] shadow-[0_12px_40px_rgba(15,23,42,0.08)] lg:grid-cols-[1.08fr_1fr]">
        <div className="relative flex items-center justify-center border-b border-[#e4e8ec] p-8 lg:border-b-0 lg:border-r lg:p-12">
          <div className="relative mx-auto flex h-full w-full max-w-[500px] flex-col items-center justify-center">
            <img
              src={sheepmugLogo}
              alt="SheepMug logo"
              className="h-10 w-auto rounded-md object-contain"
            />
            <p className="mt-10 text-center text-[13px] font-bold uppercase tracking-[0.12em] text-[#1e3a8a]">Welcome to SheepMug</p>
            <h1 className="mt-4 text-center text-[36px] font-bold leading-tight tracking-tight text-[#0f172a] sm:text-[42px]">{title}</h1>
            <p className="mt-4 max-w-xl text-center text-[14px] leading-relaxed text-[#5b6470]">{subtitle}</p>

            <div className="mt-8 rounded-xl border border-[#e5e7eb] bg-white/95 p-4">
              {FAQ_ITEMS.map((item, idx) => {
                const expanded = openFaq === idx;
                return (
                  <button
                    key={item.q}
                    type="button"
                    onClick={() => setOpenFaq((prev) => (prev === idx ? -1 : idx))}
                    className="w-full border-b border-[#edf0f3] py-3 text-left last:border-b-0"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-medium text-[#111827]">{item.q}</span>
                      {expanded ? <Minus className="h-4 w-4 text-[#111827]" /> : <Plus className="h-4 w-4 text-[#111827]" />}
                    </span>
                    {expanded ? <span className="mt-2 block pr-6 text-[13px] leading-relaxed text-[#667085]">{item.a}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-6 md:p-10">{children}</div>
      </div>

      <div className="relative mx-auto mt-4 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-[#6b7280]">
        <p>Copyright © {new Date().getFullYear()} SheepMug, Inc.</p>
        <div className="flex items-center gap-4">
          <a href="/terms" className="hover:text-[#111827]">
            Terms of Service
          </a>
          <a href="/privacy" className="hover:text-[#111827]">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-5 flex items-center gap-2 text-sm">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${
            step === n ? "bg-[#dbeafe] text-[#1e3a8a]" : "bg-[#f3f4f6] text-[#4b5563]"
          }`}
        >
          {step > n ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
          Step {n}
        </div>
      ))}
    </div>
  );
}

function PlanSelectionCard({
  plan,
  active,
  onClick,
}: {
  plan: PlanChoice;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border bg-white px-4 py-3 text-left transition ${
        active ? "border-[#1e3a8a] shadow-[0_0_0_1px_rgba(30,58,138,0.35)]" : "border-[#e5e7eb]"
      }`}
    >
      <span className="flex items-start gap-3">
        <span
          className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            active ? "border-[#1e3a8a]" : "border-[#cbd5e1]"
          }`}
        >
          {active ? <span className="h-2.5 w-2.5 rounded-full bg-[#1e3a8a]" /> : null}
        </span>
        <span className="flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="text-[19px] font-semibold text-[#111827]">{plan.label}</span>
            <span className="text-[19px] font-semibold text-[#111827]">{plan.priceLabel}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-[#667085]">{plan.summary}</span>
        </span>
      </span>
    </button>
  );
}

export function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthShell title="Sign in to your SheepMug workspace" subtitle="The standard CMS login for all church teams.">
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-[30px] font-bold leading-tight text-[#111827]">Login</h2>
        <p className="mt-2 text-[14px] text-[#667085]">Continue to your church dashboard.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium text-[#111827]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
              placeholder="you@church.org"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium text-[#111827]">Password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Continue"}
          </button>
        </form>

        <p className="mt-6 text-center text-[14px] text-[#4b5563]">
          Need a workspace?{" "}
          <Link to="/signup" className="font-semibold text-[#1e3a8a] hover:underline">
            Create account
          </Link>
        </p>
        <p className="mt-2 text-center text-[14px] text-[#4b5563]">
          <Link to="/forgot-password" className="font-semibold text-[#1e3a8a] hover:underline">
            Forgot password?
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signup, signupCheckout, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const initialPlanId = planIdFromSearch(new URLSearchParams(window.location.search).get("plan"));
  const [selectedPlanId, setSelectedPlanId] = useState<BillingPlanId>(initialPlanId);
  const [fullName, setFullName] = useState("");
  const [churchName, setChurchName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
      if (demoBypass) {
        await signup({
          email: email.trim(),
          password,
          firstName,
          lastName,
          organizationName: churchName.trim() || undefined,
          subscriptionTier: selectedPlan.tier,
          billingCycle: selectedPlan.billingCycle,
          billingPlanId: selectedPlan.billingPlanId,
          demoBypass: true,
        });
        setSuccessMessage("Account ready. Redirecting to your workspace…");
        window.location.href = "/cms";
        return;
      }

      const { authorization_url } = await signupCheckout({
        email: email.trim(),
        password,
        firstName,
        lastName,
        organizationName: churchName.trim() || undefined,
        subscriptionTier: selectedPlan.tier,
        billingCycle: selectedPlan.billingCycle,
        billingPlanId: selectedPlan.billingPlanId,
      });
      window.location.assign(authorization_url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Signup failed. Please try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Select your SheepMug billing plan" subtitle="Choose monthly or yearly payment and finish account setup.">
      <div className="mx-auto w-full max-w-xl">
        <StepIndicator step={step} />

        {step === 1 ? (
          <div>
            <h2 className="text-[34px] font-bold leading-tight text-[#111827]">Select your billing</h2>
            <p className="mt-2 text-[14px] text-[#667085]">Pay yearly and save compared to twelve monthly payments.</p>
            <div className="mt-6 space-y-3">
              {PLAN_CHOICES.map((plan) => (
                <PlanSelectionCard
                  key={plan.id}
                  plan={plan}
                  active={selectedPlanId === plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a]"
            >
              Continue
            </button>
            <div className="mt-3 flex justify-end">
              <Link to="/#pricing" className="inline-flex items-center gap-1 text-[13px] text-[#6b7280] hover:text-[#111827]">
                Show full comparison
                <Scale className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <h2 className="text-[30px] font-bold leading-tight text-[#111827]">Create your account</h2>
            <p className="mt-2 text-[14px] text-[#667085]">Owner account for your church workspace.</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1 block text-[14px] font-medium text-[#111827]">Full name</span>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[14px] font-medium text-[#111827]">Church name</span>
                <input
                  type="text"
                  required
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[14px] font-medium text-[#111827]">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[14px] font-medium text-[#111827]">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-[14px] font-medium text-[#111827]">Confirm password</span>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] font-semibold text-[#111827]"
              >
                Back
              </button>
              <button
                type="submit"
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-[#1b357a]"
              >
                Continue
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="text-[30px] font-bold leading-tight text-[#111827]">Payment setup</h2>
            <p className="mt-2 text-[14px] text-[#667085]">
              Complete checkout with Paystack in a secure window. You can also finish payment later from Settings → Subscription.
            </p>

            <div className="mt-5 rounded-lg border border-[#dbe3ec] bg-[#f8fbff] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-[#64748b]">Selected package</p>
                  <p className="text-[20px] font-semibold text-[#111827]">{selectedPlan.label}</p>
                </div>
                <p className="text-[20px] font-semibold text-[#111827]">{selectedPlan.priceLabel}</p>
              </div>
              <p className="mt-2 text-[13px] text-[#475569]">{selectedPlan.summary}</p>
            </div>

            <label className="mt-4 flex items-start gap-2 rounded-lg border border-[#e5e7eb] bg-white p-3 text-[13px] text-[#374151]">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#cbd5e1] text-[#1e3a8a] focus:ring-[#1e3a8a]"
              />
              <span>I agree to continue and verify my account email if confirmation is required.</span>
            </label>

            {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
            {successMessage ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{successMessage}</p> : null}

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitSignup({ demoBypass: false })}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" />
                {submitting ? "Working…" : "Create account & pay with Paystack"}
              </button>

              {DEMO_BYPASS_ENABLED ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitSignup({ demoBypass: true })}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-[14px] font-semibold text-[#334155] transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Creating account..." : "Continue with demo bypass (testing)"}
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] font-semibold text-[#111827]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] font-semibold text-[#111827]"
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

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<"request" | "verify" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [lastFailure, setLastFailure] = useState<string>("");
  const [canResendAt, setCanResendAt] = useState<number | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [verifyingCode, setVerifyingCode] = useState(false);

  useEffect(() => {
    if (!canResendAt) {
      setResendSecondsLeft(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.ceil((canResendAt - Date.now()) / 1000));
      setResendSecondsLeft(diff);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [canResendAt]);

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLastFailure("");
    setSubmitting(true);
    try {
      try { await (supabase as any).auth.signOut(); } catch { /* noop */ }
      const sentAt = Date.now();
      const { error: supaErr } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (supaErr) throw new Error(supaErr.message || "Unable to send code.");
      setCodeSentAt(sentAt);
      setCanResendAt(sentAt + 120000);
      setStage("verify");
      setMessage("Code sent. It may take about 1 minute to arrive. Enter it below within 60 minutes.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to send code.");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLastFailure("");
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyingCode(true);
    try {
      const { error: verifyErr } = await (supabase as any).auth.verifyOtp({
        email: email.trim(),
        token: normalizedCode,
        type: "recovery",
      });
      if (verifyErr) {
        setLastFailure(JSON.stringify({ errorName: (verifyErr as any)?.name, errorStatus: (verifyErr as any)?.status, errorCode: (verifyErr as any)?.code, errorMessage: verifyErr?.message }));
        throw new Error(verifyErr.message || "Invalid or expired code.");
      }
      setStage("reset");
      setMessage("Code verified. Set your new password.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to verify code.");
    } finally {
      setVerifyingCode(false);
    }
  };

  const resetAfterVerifiedCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw new Error(updateErr.message || "Unable to reset password.");
      try { await (supabase as any).auth.signOut(); } catch { /* noop */ }
      setMessage("Password updated. Redirecting to login...");
      setTimeout(() => navigate("/login"), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    if (resendSecondsLeft > 0) return;
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const sentAt = Date.now();
      const { error: supaErr } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (supaErr) throw new Error(supaErr.message || "Unable to resend code.");
      setCodeSentAt(sentAt);
      setCanResendAt(sentAt + 120000);
      setStage("verify");
      setCode("");
      setMessage("A new code has been sent. It may take about 1 minute to arrive.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to resend code.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="We will send a verification code to your email so you can set a new password."
    >
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-[30px] font-bold leading-tight text-[#111827]">Password reset</h2>
        <p className="mt-2 text-[14px] text-[#667085]">
          {stage === "request"
            ? "Enter your email and we'll send you a verification code."
            : stage === "verify"
              ? "Do you have code already? Enter it below to verify first."
              : "Now enter your new password."}
        </p>

        {stage === "request" ? (
          <form onSubmit={requestCode} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-[14px] font-medium text-[#111827]">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                placeholder="you@church.org"
              />
            </label>
            <p className="text-[12px] text-[#667085]">It may take about 1 minute to receive your code.</p>

            {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
            {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{message}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send code"}
            </button>
          </form>
        ) : stage === "verify" ? (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-[14px] font-medium text-[#111827]">Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 text-center text-[18px] tracking-[0.4em] outline-none ring-[#1e3a8a] focus:ring-2"
                placeholder="••••••"
              />
            </label>

            {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
            {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{message}</p> : null}

            <button
              type="submit"
              disabled={verifyingCode}
              className="inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifyingCode ? "Verifying code..." : "Verify code"}
            </button>

            <div className="flex items-center justify-between text-[13px]">
              <button
                type="button"
                disabled={submitting || resendSecondsLeft > 0}
                onClick={() => void resendCode()}
                className={`font-semibold ${resendSecondsLeft > 0 ? "text-[#94a3b8]" : "text-[#1e3a8a] hover:underline"} disabled:cursor-not-allowed`}
              >
                {resendSecondsLeft > 0 ? `Send again in ${formatCountdown(resendSecondsLeft)}` : "Send code again"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage("request");
                  setCode("");
                  setPassword("");
                  setConfirmPassword("");
                  setError("");
                  setMessage("");
                }}
                className="font-semibold text-[#1e3a8a] hover:underline"
              >
                Use different email
              </button>
            </div>

            {lastFailure ? (
              <pre className="mt-2 max-h-24 overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-tight text-slate-600">
                {lastFailure}
              </pre>
            ) : null}
          </form>
        ) : (
          <form onSubmit={resetAfterVerifiedCode} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-[14px] font-medium text-[#111827]">New password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-[14px] font-medium text-[#111827]">Confirm new password</span>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
            {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{message}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-[14px] text-[#4b5563]">
          <Link to="/login" className="font-semibold text-[#1e3a8a] hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sessionReady, setSessionReady] = useState<"checking" | "ready" | "missing">("checking");

  useEffect(() => {
    let cancelled = false;

    const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
    const search = typeof window !== "undefined" ? window.location.search || "" : "";
    const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const searchParams = new URLSearchParams(search);
    const hasRecoveryHash = hashParams.has("access_token") || hashParams.get("type") === "recovery";
    const hasCodeParam = searchParams.has("code");
    const hasTokenHash = searchParams.has("token_hash") || hashParams.has("token_hash");
    const tokenHashType = (searchParams.get("type") || hashParams.get("type") || "").toLowerCase();
    const errorCode = (hashParams.get("error_code") || searchParams.get("error_code") || "").toLowerCase();
    const errorDescription = hashParams.get("error_description") || searchParams.get("error_description") || "";

    if (errorCode) {
      setSessionReady("missing");
      const friendly =
        errorCode === "otp_expired"
          ? "Your reset link was already used or has expired. This often happens when an email security scanner opens the link before you do. Please request a new link and click it within a couple of minutes."
          : (errorDescription.replace(/\+/g, " ") || "Reset link is invalid or expired.");
      setError(friendly);
      return;
    }

    const pkceFlow = async () => {
      if (!hasCodeParam) return false;
      const code = searchParams.get("code") || "";
      const exchanger = (supabase as any)?.auth?.exchangeCodeForSession;
      if (typeof exchanger !== "function") return false;
      const { error: exchangeError } = await exchanger.call((supabase as any).auth, code);
      if (exchangeError) throw exchangeError;
      return true;
    };

    const tokenHashFlow = async () => {
      if (!hasTokenHash) return false;
      const tokenHash = searchParams.get("token_hash") || hashParams.get("token_hash") || "";
      const verifier = (supabase as any)?.auth?.verifyOtp;
      if (typeof verifier !== "function") return false;
      const { error: verifyErr } = await verifier.call((supabase as any).auth, {
        type: "recovery",
        token_hash: tokenHash,
      });
      if (verifyErr) throw verifyErr;
      return true;
    };

    const { data: sub } = (supabase as any).auth.onAuthStateChange?.((event: string) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady("ready");
      }
    }) || { data: { subscription: { unsubscribe: () => {} } } };

    (async () => {
      try {
        const pkceHandled = await pkceFlow();
        const tokenHashHandled = !pkceHandled ? await tokenHashFlow() : false;
        const { data } = await (supabase as any).auth.getSession();
        if (cancelled) return;
        if (pkceHandled || tokenHashHandled || hasRecoveryHash || data?.session) {
          setSessionReady("ready");
        } else {
          setSessionReady("missing");
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setSessionReady("missing");
        setError(e instanceof Error ? e.message : "Reset link is invalid or expired.");
      }
    })();

    return () => {
      cancelled = true;
      try { sub?.subscription?.unsubscribe?.(); } catch { /* noop */ }
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (sessionReady !== "ready") {
      setError(
        sessionReady === "checking"
          ? "Still verifying your reset link. Please try again in a moment."
          : "Your reset link is invalid or has expired. Please request a new one."
      );
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: supaErr } = await supabase.auth.updateUser({ password });
      if (supaErr) throw new Error(supaErr.message || "Unable to reset password.");
      setMessage("Password updated. Redirecting to login...");
      try { await (supabase as any).auth.signOut(); } catch { /* noop */ }
      setTimeout(() => {
        navigate("/login");
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Set a new password" subtitle="Create a strong password for your account access.">
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-[30px] font-bold leading-tight text-[#111827]">Reset password</h2>
        <p className="mt-2 text-[14px] text-[#667085]">This link is valid for 15 minutes.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium text-[#111827]">New password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[14px] font-medium text-[#111827]">Confirm new password</span>
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-[#d1d5db] px-4 py-3 pr-11 text-[14px] outline-none ring-[#1e3a8a] focus:ring-2"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-[#64748b] hover:text-[#0f172a]"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
          {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{message}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-lg bg-[#1e3a8a] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#1b357a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

/** Paystack redirects here after payment (`reference` or `trxref` query). */
export function SignupCompletePage() {
  const { completeSignupAfterPayment, isAuthenticated, loading } = useAuth();
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      window.location.href = "/cms";
    }
  }, [isAuthenticated, loading]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = (params.get("reference") || params.get("trxref") || "").trim();
    if (!reference) {
      setError("Missing payment reference. Return to signup and complete checkout.");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await completeSignupAfterPayment(reference);
        if (cancelled) return;
        if (result.kind === "session") {
          window.location.href = "/cms";
          return;
        }
        setInfo(result.message || "Your subscription is active. Sign in with the password you chose during signup.");
        setTimeout(() => {
          window.location.href = `/login?email=${encodeURIComponent(result.email)}`;
        }, 2000);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not complete signup.";
        if (/not completed yet|402|pending/i.test(msg)) {
          setPending(true);
        }
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount; completeSignupAfterPayment is stable enough for this flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell title="Finishing your account" subtitle="Confirming payment and creating your workspace.">
      <div className="mx-auto w-full max-w-md text-center">
        {!error && !info ? (
          <p className="text-[15px] text-[#4b5563]">Confirming payment with Paystack…</p>
        ) : null}
        {pending && !error ? (
          <p className="mt-3 text-[13px] text-[#92400e]">
            Payment can take a few seconds to confirm. This page will retry when you refresh.
          </p>
        ) : null}
        {info ? <p className="mt-4 text-[14px] text-emerald-800">{info}</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
        {error ? (
          <Link
            to="/signup"
            className="mt-6 inline-block font-semibold text-[#1e3a8a] hover:underline"
          >
            Back to signup
          </Link>
        ) : null}
      </div>
    </AuthShell>
  );
}
