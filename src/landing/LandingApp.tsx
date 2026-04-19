import { useEffect, useState, type ReactNode } from "react";
import mobileLogo from "../../apps/mobile/assets/sheepmug-logo.png";
import {
  Download,
  ArrowUpRight,
  Bell,
  CalendarCheck,
  GitBranch,
  ListTodo,
  Menu,
  UserPlus,
  Users,
  X,
} from "lucide-react";

const CMS = "/cms";

/** Concave-style masks: green = bite at bottom-left of image; orange = bite at top-left (mirrored). */
const IMAGE_CLIP = {
  green: "polygon(14% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 32%, 10% 8%)",
  orange: "polygon(0% 18%, 14% 0%, 100% 0%, 100% 100%, 0% 100%)",
} as const;

function Wireframe({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex min-h-[180px] items-center justify-center rounded-3xl border-2 border-dashed border-neutral-300 bg-neutral-100 text-sm text-neutral-500 md:min-h-[220px] ${className}`}
      aria-hidden
    >
      Image
    </div>
  );
}

function ArrowCircleLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={CMS}
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/5 transition hover:shadow-lg ${className}`}
      aria-label="Open app"
    >
      <ArrowUpRight className="h-5 w-5 text-[#1e3a8a]" strokeWidth={2.25} />
    </a>
  );
}

function HeroShowcaseMosaic() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm sm:col-span-1 lg:row-span-2">
        <img
          src="https://images.pexels.com/photos/267559/pexels-photo-267559.jpeg?auto=compress&cs=tinysrgb&w=1200"
          alt="Church worship gathering"
          className="h-full min-h-[250px] w-full object-cover md:min-h-[320px]"
        />
        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Feature</p>
          <p className="text-base font-semibold text-neutral-900">Tasks</p>
        </div>
      </div>

      <div className="rounded-3xl border border-[#dcefd8] bg-[#e8f8e4] p-5 shadow-sm">
        <p className="text-xl font-semibold leading-tight text-neutral-900">Quick and adaptable</p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-700">
          Assign and track ministry tasks in one place with clear progress.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <img
          src="https://images.pexels.com/photos/208701/pexels-photo-208701.jpeg?auto=compress&cs=tinysrgb&w=1200"
          alt="Church team in conversation"
          className="h-full min-h-[150px] w-full object-cover md:min-h-[185px]"
        />
        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="text-base font-semibold text-neutral-900">Desktop app available</p>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ddd4f8] bg-[#e8defd] p-5 shadow-sm sm:col-span-2 lg:col-span-1">
        <p className="text-xl font-semibold leading-tight text-neutral-900">Offline mode</p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-700">
          Continue working even without internet. Changes sync when you reconnect.
        </p>
      </div>

      <div className="rounded-3xl border border-[#ffd8be] bg-[#ffe7d6] p-5 shadow-sm sm:col-span-2 lg:col-span-1">
        <p className="text-xl font-semibold leading-tight text-neutral-900">Built for church teams</p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-700">
          Keep everyone aligned across devices with a workflow that stays simple.
        </p>
      </div>
    </div>
  );
}

function SectionPlayfulDecor({ tone = "gold" }: { tone?: "gold" | "coral" | "violet" }) {
  const palette =
    tone === "coral"
      ? {
          block: "bg-[#ffd7cb]",
          arc: "bg-[#ff8f72]/60",
          line: "rgba(126,45,24,0.2)",
        }
      : tone === "violet"
        ? {
            block: "bg-[#e1dbff]",
            arc: "bg-[#9b8cff]/55",
            line: "rgba(53,41,128,0.2)",
          }
        : {
            block: "bg-[#ffe8a8]",
            arc: "bg-[#d9b048]/55",
            line: "rgba(108,81,16,0.22)",
          };

  return (
    <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block" aria-hidden>
      <div className="absolute -right-6 top-8 h-24 w-24">
        <div className={`absolute right-0 top-0 h-20 w-20 rounded-2xl ${palette.block}`} />
        <div
          className="absolute right-0 top-0 h-20 w-20 rounded-2xl opacity-55"
          style={{
            backgroundImage: `repeating-radial-gradient(circle at 0 100%, ${palette.line} 0 2px, transparent 2px 12px)`,
          }}
        />
        <div className={`absolute -bottom-1 left-1 h-11 w-11 rounded-full ${palette.arc}`} />
      </div>

      <div className="absolute -left-8 bottom-6 h-20 w-20">
        <div className={`absolute left-0 top-0 h-16 w-16 rounded-xl ${palette.block} opacity-90`} />
        <div
          className="absolute left-0 top-0 h-16 w-16 rounded-xl opacity-45"
          style={{
            backgroundImage: `repeating-radial-gradient(circle at 100% 0, ${palette.line} 0 2px, transparent 2px 10px)`,
          }}
        />
      </div>
    </div>
  );
}

function CardCornerAbstract({ tone }: { tone: "gold" | "coral" | "violet" }) {
  const palette =
    tone === "coral"
      ? { solid: "bg-[#f67f7f]/35", soft: "bg-[#ffd4d4]/60", line: "rgba(143,53,53,0.25)" }
      : tone === "violet"
        ? { solid: "bg-[#6f7bf1]/35", soft: "bg-[#cfd6ff]/65", line: "rgba(43,57,140,0.24)" }
        : { solid: "bg-[#d5ab45]/35", soft: "bg-[#ffe8b3]/70", line: "rgba(116,84,14,0.24)" };

  return (
    <div className="pointer-events-none absolute -bottom-2 -right-2 h-24 w-24 opacity-85" aria-hidden>
      <div className={`absolute bottom-0 right-0 h-14 w-14 rounded-md ${palette.solid}`} />
      <div className={`absolute bottom-7 right-7 h-10 w-10 rounded-full ${palette.solid}`} />
      <div className={`absolute bottom-2 right-12 h-9 w-9 rounded-full ${palette.soft}`} />
      <div
        className="absolute bottom-0 right-0 h-14 w-14 rounded-md"
        style={{
          backgroundImage: `repeating-radial-gradient(circle at 0 100%, ${palette.line} 0 2px, transparent 2px 11px)`,
        }}
      />
    </div>
  );
}

function LeaderTaskFlowCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="relative overflow-hidden rounded-[2rem] bg-[#D8F3DC] p-6 shadow-sm ring-1 ring-black/5">
        <div className="relative z-10">
          <span className="inline-block rounded-full border border-neutral-900/25 bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-900">
          Task Flow
          </span>
          <h3 className="mt-3 font-['Playfair_Display',serif] text-2xl font-bold leading-tight text-neutral-950">
            Ongoing Tasks
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-neutral-800/90">
            Assign tasks to leaders and track progress from one dashboard.
          </p>
          <ul className="mt-6 space-y-2 text-sm font-medium text-neutral-900">
            <li>Assign task owners quickly</li>
            <li>Set due dates and reminders</li>
          </ul>
        </div>
        <CardCornerAbstract tone="gold" />
      </div>

      <div className="relative overflow-hidden rounded-[2rem] bg-[#FFE8D6] p-6 shadow-sm ring-1 ring-black/5">
        <div className="relative z-10">
          <span className="inline-block rounded-full border border-neutral-900/25 bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-900">
            Ministry Scope
          </span>
          <h3 className="mt-3 font-['Playfair_Display',serif] text-2xl font-bold leading-tight text-neutral-950">
            Group Ministry Assignment
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-neutral-800/90">
            Assign each ministry or group to the right leader for accountability.
          </p>
          <ul className="mt-6 space-y-2 text-sm font-medium text-neutral-900">
            <li>Ministry-level ownership</li>
            <li>Leader-specific workload clarity</li>
          </ul>
        </div>
        <CardCornerAbstract tone="coral" />
      </div>

      <div className="relative overflow-hidden rounded-[2rem] bg-[#D8F3DC] p-6 shadow-sm ring-1 ring-black/5">
        <div className="relative z-10">
          <span className="inline-block rounded-full border border-neutral-900/25 bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-900">
            Access Control
          </span>
          <h3 className="mt-3 font-['Playfair_Display',serif] text-2xl font-bold leading-tight text-neutral-950">
            Scoped Leader Access
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-neutral-800/90">
            Leaders only see and manage the groups assigned to them.
          </p>
          <ul className="mt-6 space-y-2 text-sm font-medium text-neutral-900">
            <li>Role-based visibility</li>
            <li>Cleaner team boundaries</li>
          </ul>
        </div>
        <CardCornerAbstract tone="violet" />
      </div>
    </div>
  );
}

function SimplePricingCard({
  plan,
  price,
  features,
  cta,
  href,
  tone,
}: {
  plan: string;
  price: string;
  features: string[];
  cta: string;
  href: string;
  tone: "violet" | "orange";
}) {
  const toneStyles =
    tone === "violet"
      ? {
          orb: "bg-[#7b6bff]",
          orbSoft: "bg-[#cfc8ff]",
          button: "bg-[#4f46e5] hover:bg-[#4338ca]",
          check: "text-[#4f46e5]",
        }
      : {
          orb: "bg-[#f59e0b]",
          orbSoft: "bg-[#fde1b2]",
          button: "bg-[#f59e0b] hover:bg-[#d97706]",
          check: "text-[#d97706]",
        };

  return (
    <article className="rounded-2xl bg-white p-7 shadow-sm ring-1 ring-black/10">
      <div className="mb-6 flex justify-center">
        <div className="relative h-20 w-24">
          <div className={`absolute inset-x-3 top-7 h-10 rounded-md ${toneStyles.orb} opacity-90`} />
          <div className={`absolute left-2 top-1 h-9 w-9 rounded-md ${toneStyles.orb}`} />
          <div className={`absolute right-2 top-1 h-9 w-9 rounded-md ${toneStyles.orbSoft}`} />
        </div>
      </div>

      <h3 className="text-center font-['Playfair_Display',serif] text-2xl font-bold text-neutral-950">{plan}</h3>

      <ul className="mt-6 space-y-3 text-[15px] text-neutral-700">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className={`mt-[2px] text-sm ${toneStyles.check}`}>✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <p className="mt-9 text-center text-4xl font-bold text-neutral-950">{price}</p>
      <a
        href={href}
        className={`mt-6 inline-flex w-full justify-center rounded-full px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white transition ${toneStyles.button}`}
      >
        {cta}
      </a>
    </article>
  );
}

type PastelVariant = "green" | "orange";

function PastelShowcaseCard({
  variant,
  badge,
  title,
  subtitle,
  footer,
  imageClip,
  arrowPosition,
}: {
  variant: PastelVariant;
  badge: string;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  imageClip?: keyof typeof IMAGE_CLIP;
  arrowPosition?: "top" | "bottom";
}) {
  const bg = variant === "green" ? "bg-[#D8F3DC]" : "bg-[#FFE8D6]";
  const clip = IMAGE_CLIP[imageClip ?? variant];
  const arrowAtTop = arrowPosition ? arrowPosition === "top" : variant === "green";

  const imageBlock = (
    <div className="relative min-h-[200px] w-full md:min-h-0 md:w-[48%] md:max-w-[min(100%,22rem)] md:flex-shrink-0">
      <div
        className="absolute inset-0 overflow-hidden bg-white/40 shadow-inner md:rounded-3xl"
        style={{ clipPath: clip }}
      >
        <div
          className="flex h-full min-h-[200px] w-full items-center justify-center bg-gradient-to-br from-neutral-100/90 to-neutral-200/80 text-xs font-medium tracking-wide text-neutral-500 md:min-h-[260px]"
          aria-hidden
        >
          Image
        </div>
      </div>
    </div>
  );

  if (variant === "green") {
    return (
      <div
        className={`flex min-h-[280px] flex-col-reverse overflow-hidden rounded-[2rem] shadow-sm ring-1 ring-black/5 md:min-h-[300px] md:flex-row ${bg}`}
      >
        <div className="relative flex flex-1 flex-col justify-between gap-8 p-6 sm:p-8 md:min-w-0">
          <ArrowCircleLink className="self-start" />
          <div className="mt-auto space-y-2">
            <span className="inline-block rounded-full border border-neutral-900/25 bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-900">
              {badge}
            </span>
            <h3 className="font-['Playfair_Display',serif] text-2xl font-bold leading-tight text-neutral-950 sm:text-[1.75rem]">
              {title}
            </h3>
            <p className="max-w-[18rem] text-sm leading-relaxed text-neutral-800/90">{subtitle}</p>
            {footer ? <div className="pt-4">{footer}</div> : null}
          </div>
        </div>
        {imageBlock}
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-[280px] flex-col-reverse overflow-hidden rounded-[2rem] shadow-sm ring-1 ring-black/5 md:min-h-[300px] md:flex-row ${bg}`}
    >
      <div className="relative flex flex-1 flex-col justify-between gap-6 p-6 sm:p-8 md:min-w-0">
        {arrowAtTop ? <ArrowCircleLink className="self-start" /> : null}
        <div className="space-y-2">
          <span className="inline-block rounded-full border border-neutral-900/25 bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-900">
            {badge}
          </span>
          <h3 className="font-['Playfair_Display',serif] text-2xl font-bold leading-tight text-neutral-950 sm:text-[1.75rem]">
            {title}
          </h3>
          <p className="max-w-[18rem] text-sm leading-relaxed text-neutral-800/90">{subtitle}</p>
        </div>
        {footer ? <div className="text-left">{footer}</div> : null}
        {!arrowAtTop ? <ArrowCircleLink className="self-start" /> : null}
      </div>
      {imageBlock}
    </div>
  );
}

function NavLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="text-[15px] font-medium text-neutral-700 transition hover:text-neutral-900"
    >
      {children}
    </a>
  );
}

export function LandingApp() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.documentElement.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-[#FDFCF8] text-[#111111]"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <header className="sticky top-0 z-50 border-b border-neutral-200/80 bg-[#FDFCF8]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <a href="#" className="flex items-center gap-2" onClick={closeMenu}>
            <img
              src={mobileLogo}
              alt="SheepMug mobile logo"
              className="h-9 w-9 rounded-xl object-cover ring-1 ring-black/5"
            />
            <span className="font-['Playfair_Display',serif] text-xl font-bold tracking-tight md:text-2xl">
              SheepMug
            </span>
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            <NavLink href="#about">About</NavLink>
            <NavLink href="#features">Features</NavLink>
            <NavLink href="#branches">Branches</NavLink>
            <NavLink href="#pricing">Pricing</NavLink>
            <NavLink href="#contact">Contact</NavLink>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a
              href={CMS}
              className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100"
            >
              Log in
            </a>
            <a
              href={CMS}
              className="rounded-full bg-[#1A1A1A] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              Join now
            </a>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {menuOpen ? (
          <div className="border-t border-neutral-200 bg-[#FDFCF8] px-4 py-4 md:hidden">
            <div className="flex flex-col gap-3">
              <NavLink href="#about" onClick={closeMenu}>
                About
              </NavLink>
              <NavLink href="#features" onClick={closeMenu}>
                Features
              </NavLink>
              <NavLink href="#branches" onClick={closeMenu}>
                Branches
              </NavLink>
              <NavLink href="#pricing" onClick={closeMenu}>
                Pricing
              </NavLink>
              <NavLink href="#contact" onClick={closeMenu}>
                Contact
              </NavLink>
              <hr className="border-neutral-200" />
              <a href={CMS} className="font-semibold text-neutral-800" onClick={closeMenu}>
                Log in
              </a>
              <a
                href={CMS}
                className="rounded-full bg-[#1A1A1A] py-3 text-center font-semibold text-white"
                onClick={closeMenu}
              >
                Join now
              </a>
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6 md:pb-24 md:pt-14">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
            <div>
              <h1 className="font-['Playfair_Display',serif] text-4xl font-bold leading-tight tracking-tight text-[#111111] sm:text-5xl lg:text-[3.25rem]">
                Discipleship made easy.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#666666]">
                SheepMug is a church management system that helps pastors and leaders track members, attendance,
                follow-ups, and communication—so new people are welcomed and no one slips through the cracks. Desktop
                and mobile versions are available, so you can access your attendance and tasks assigned to you offline.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={CMS}
                  className="inline-flex justify-center rounded-full bg-[#FC4F1E] px-8 py-3.5 text-center text-base font-semibold text-white shadow-sm transition hover:bg-[#e54618]"
                >
                  Join now
                </a>
                <a
                  href={CMS}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-6 py-3.5 text-center text-base font-semibold text-neutral-800 transition hover:bg-neutral-50"
                >
                  <span className="inline-grid h-4 w-4 grid-cols-2 gap-[2px]">
                    <span className="rounded-[2px] bg-[#1e3a8a]" />
                    <span className="rounded-[2px] bg-[#1e3a8a]" />
                    <span className="rounded-[2px] bg-[#1e3a8a]" />
                    <span className="rounded-[2px] bg-[#1e3a8a]" />
                  </span>
                  <Download className="h-4 w-4 text-neutral-700" />
                  Windows
                </a>
                <a
                  href={CMS}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-6 py-3.5 text-center text-base font-semibold text-neutral-800 transition hover:bg-neutral-50"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-current text-neutral-700"
                  >
                    <path d="M16.365 12.73c.02 2.06 1.8 2.75 1.82 2.76-.02.05-.28.95-.92 1.88-.56.81-1.15 1.62-2.07 1.64-.9.02-1.19-.53-2.22-.53-1.03 0-1.35.51-2.2.55-.89.03-1.57-.89-2.13-1.69-1.15-1.67-2.03-4.71-.85-6.76.58-1.02 1.62-1.67 2.76-1.69.86-.02 1.67.58 2.2.58.52 0 1.5-.71 2.53-.61.43.02 1.64.17 2.42 1.3-.06.04-1.44.84-1.42 2.57Zm-2.03-6.77c.47-.57.78-1.36.7-2.15-.67.03-1.48.45-1.95 1.02-.43.5-.81 1.31-.71 2.08.75.06 1.49-.38 1.96-.95Z" />
                  </svg>
                  <Download className="h-4 w-4 text-neutral-700" />
                  iOS
                </a>
              </div>
            </div>
            <div>
              <HeroShowcaseMosaic />
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-neutral-200/80 bg-white py-14 md:py-16">
          <SectionPlayfulDecor tone="coral" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="mt-2 font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">
              Assign Church Leaders to their Specific Groups
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-[#666666] md:text-lg">
              Assign tasks to leaders, map ministries and groups to the right people, and keep access limited to each
              leader&apos;s assigned groups.
            </p>
            <div className="mt-8">
              <LeaderTaskFlowCards />
            </div>
          </div>
        </section>

        <section
          id="about"
          className="relative scroll-mt-24 overflow-hidden border-t border-neutral-200/80 bg-white py-16 md:py-24"
        >
          <SectionPlayfulDecor tone="gold" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">About SheepMug</h2>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#666666]">
              SheepMug is a church management system built for growing churches. This church management software brings
              member records, events, tasks, attendance, and notifications together so your team can pastor people—not
              chase spreadsheets. Whether you serve one congregation or several locations, you get a calmer workflow
              and a clearer picture of who needs care.
            </p>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#666666]">
              We built SheepMug for churches that want a practical church management platform for discipleship and
              follow-up: see who is new, who was present, and what care still needs to happen—without losing the human
              touch.
            </p>
          </div>
        </section>

        <section id="features" className="relative scroll-mt-24 overflow-hidden py-16 md:py-24">
          <SectionPlayfulDecor tone="violet" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Features</h2>
            <p className="mt-3 max-w-2xl text-lg text-[#666666]">
              Church management software for churches that need member care, attendance, and team workflows on desktop
              and on the go.
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Users className="h-6 w-6 text-[#FC4F1E]" />}
                title="Member tracking"
                body="Profiles, groups, and history so leaders know who people are and how they are connected."
              />
              <FeatureCard
                icon={<CalendarCheck className="h-6 w-6 text-[#FC4F1E]" />}
                title="Event attendance"
                body="Services and gatherings with attendance visibility to spot patterns and celebrate faithfulness."
              />
              <FeatureCard
                icon={<ListTodo className="h-6 w-6 text-[#FC4F1E]" />}
                title="Tasks"
                body="Assign follow-ups and ministry work so nothing important is forgotten."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6 text-[#FC4F1E]" />}
                title="Notifications"
                body="Leaders stay informed with timely alerts so pastoral care happens on time."
              />
              <FeatureCard
                icon={<UserPlus className="h-6 w-6 text-[#FC4F1E]" />}
                title="New members"
                body="Highlight people who are new to your church so welcome and discipleship stay intentional."
              />
            </div>
          </div>
        </section>

        <section
          id="branches"
          className="relative scroll-mt-24 overflow-hidden border-t border-neutral-200/80 bg-white py-16 md:py-24"
        >
          <SectionPlayfulDecor tone="gold" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#A182F2]/15 px-3 py-1 text-sm font-medium text-[#5c4a8f]">
                  <GitBranch className="h-4 w-4" />
                  Multiple branches
                </div>
                <h2 className="mt-4 font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">
                  Manage multiple branches in one place
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-[#666666]">
                  Run campuses or ministry locations under one account. Members, events, and groups can stay scoped to
                  each branch so reporting stays accurate—and leaders see what matters for where they serve.
                </p>
                <a
                  href={CMS}
                  className="mt-8 inline-flex rounded-full bg-[#FC4F1E] px-8 py-3.5 font-semibold text-white transition hover:bg-[#e54618]"
                >
                  Get started
                </a>
              </div>
              <Wireframe />
            </div>
          </div>
        </section>

        <section id="pricing" className="relative scroll-mt-24 overflow-hidden py-16 md:py-24">
          <SectionPlayfulDecor tone="coral" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-center font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Pricing</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-base text-[#666666] md:text-lg">
              Simple plans for churches. Start free and upgrade when your team needs more.
            </p>
            <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
              <SimplePricingCard
                plan="Starter Plan"
                price="GHC 0 per month"
                features={[
                  "10 members limit",
                  "Tasks",
                  "Events",
                  "Attendance tracking",
                  "Mobile app access",
                  "No church leaders",
                ]}
                cta="Start Now"
                href={CMS}
                tone="violet"
              />
              <SimplePricingCard
                plan="Core Plan"
                price="GHC 400 per month"
                features={[
                  "All Starter Plan features",
                  "Full offline version",
                  "Desktop application",
                  "Unlimited members",
                  "Unlimited group leaders",
                  "Unlimited ministries",
                  "Prompt notifications for church leaders",
                  "Import and export membership data",
                  "Monthly group reports",
                ]}
                cta="Order Now"
                href={CMS}
                tone="orange"
              />
            </div>
          </div>
        </section>

        <section
          id="contact"
          className="relative scroll-mt-24 overflow-hidden border-t border-neutral-200/80 bg-[#C6F144]/20 py-16 md:py-24"
        >
          <SectionPlayfulDecor tone="violet" />
          <div className="relative z-10 mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-10 lg:grid-cols-2">
              <div>
                <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Contact</h2>
                <p className="mt-4 text-lg leading-relaxed text-[#666666]">
                  We help churches get started with a practical church management system for churches of every size.
                  Reach out with questions—or jump straight in and create your workspace.
                </p>
                <p className="mt-6">
                  <a href="mailto:hello@sheepmug.com" className="text-lg font-semibold text-[#111111] underline">
                    hello@sheepmug.com
                  </a>
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-3xl border border-neutral-200 bg-white p-8">
                <p className="text-center text-[#666666]">Prefer to self-serve?</p>
                <a
                  href={CMS}
                  className="mt-4 inline-flex justify-center rounded-full bg-[#1A1A1A] py-3.5 font-semibold text-white transition hover:bg-neutral-800"
                >
                  Join now
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 md:flex-row md:items-start md:justify-between md:px-6">
          <div>
            <p className="font-['Playfair_Display',serif] text-xl font-bold">SheepMug</p>
            <p className="mt-2 max-w-sm text-sm text-[#666666]">
              A church management system for churches focused on discipleship, follow-up, and member care.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <a href="#about" className="text-neutral-700 hover:text-neutral-900">
              About
            </a>
            <a href="#features" className="text-neutral-700 hover:text-neutral-900">
              Features
            </a>
            <a href="#branches" className="text-neutral-700 hover:text-neutral-900">
              Branches
            </a>
            <a href="#pricing" className="text-neutral-700 hover:text-neutral-900">
              Pricing
            </a>
            <a href="#contact" className="text-neutral-700 hover:text-neutral-900">
              Contact
            </a>
            <a href={CMS} className="font-semibold text-[#FC4F1E] hover:underline">
              Join now
            </a>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-4 text-center text-xs text-[#666666] md:px-6">
          © {new Date().getFullYear()} SheepMug. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  const isWarm =
    title === "Event attendance" || title === "Notifications";
  const cardTone = isWarm ? "bg-[#FFE8D6]" : "bg-[#D8F3DC]";
  const decorTone: "gold" | "coral" | "violet" =
    title === "Event attendance" || title === "Notifications"
      ? "coral"
      : title === "New members"
        ? "violet"
        : "gold";
  return (
    <div
      className={`relative overflow-hidden rounded-[2rem] p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md ${cardTone}`}
    >
      <div className="relative z-10">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-neutral-900/10 bg-white/70">
          {icon}
        </div>
        <h3 className="mt-4 font-['Playfair_Display',serif] text-xl font-bold text-neutral-950">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-neutral-800/90">{body}</p>
      </div>
      <CardCornerAbstract tone={decorTone} />
    </div>
  );
}
