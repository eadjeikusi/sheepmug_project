import { useState, type ReactNode } from "react";
import {
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

  return (
    <div
      className="min-h-screen bg-[#FDFCF8] text-[#111111]"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <header className="sticky top-0 z-50 border-b border-neutral-200/80 bg-[#FDFCF8]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <a href="#" className="flex items-center gap-2" onClick={closeMenu}>
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
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-12">
            <div>
              <h1 className="font-['Playfair_Display',serif] text-4xl font-bold leading-tight tracking-tight text-[#111111] sm:text-5xl lg:text-[3.25rem]">
                One place to care for your church with clarity.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#666666]">
                SheepMug helps pastors and leaders track members, attendance, follow-ups, and communication—so new
                people are welcomed and no one slips through the cracks.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={CMS}
                  className="inline-flex justify-center rounded-full bg-[#FC4F1E] px-8 py-3.5 text-center text-base font-semibold text-white shadow-sm transition hover:bg-[#e54618]"
                >
                  Join now
                </a>
                <a
                  href="#features"
                  className="inline-flex justify-center rounded-full border border-neutral-300 bg-white px-8 py-3.5 text-center text-base font-semibold text-neutral-800 transition hover:bg-neutral-50"
                >
                  See features
                </a>
              </div>
            </div>
            <Wireframe className="lg:min-h-[280px]" />
          </div>
        </section>

        <section id="about" className="scroll-mt-24 border-t border-neutral-200/80 bg-white py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">About SheepMug</h2>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#666666]">
              Ministry moves fast. SheepMug brings member records, events, tasks, and notifications together so your
              team can pastor people—not chase spreadsheets. Whether you serve one congregation or several locations,
              you get a calmer workflow and a clearer picture of who needs care.
            </p>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#666666]">
              We built SheepMug for churches that want to grow disciples intentionally: see who is new, who was present,
              and what follow-up still needs to happen—without losing the human touch.
            </p>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Features</h2>
            <p className="mt-3 max-w-2xl text-lg text-[#666666]">
              Everything you need to shepherd your flock—on desktop or on the go.
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

        <section id="branches" className="scroll-mt-24 border-t border-neutral-200/80 bg-white py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#A182F2]/15 px-3 py-1 text-sm font-medium text-[#5c4a8f]">
                  <GitBranch className="h-4 w-4" />
                  Multiple branches
                </div>
                <h2 className="mt-4 font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">
                  One organisation, many locations
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

        <section id="pricing" className="scroll-mt-24 py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-center font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Pricing</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-lg text-[#666666]">
              Start free, then scale when your ministry grows. Final billing details are confirmed in the app.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <div className="flex flex-col rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
                <h3 className="font-['Playfair_Display',serif] text-2xl font-bold">Free</h3>
                <p className="mt-2 text-[#666666]">Get organised with core tools for small teams.</p>
                <ul className="mt-6 flex-1 space-y-3 text-neutral-800">
                  <li>Up to 10 members</li>
                  <li>1 leader</li>
                </ul>
                <a
                  href={CMS}
                  className="mt-8 inline-flex justify-center rounded-full border-2 border-neutral-900 bg-white py-3.5 text-center font-semibold text-neutral-900 transition hover:bg-neutral-50"
                >
                  Start free
                </a>
              </div>
              <div className="relative flex flex-col rounded-3xl border-2 border-[#FC4F1E] bg-white p-8 shadow-md">
                <span className="absolute right-6 top-6 rounded-full bg-[#FC4F1E]/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#c43d18]">
                  Popular
                </span>
                <h3 className="font-['Playfair_Display',serif] text-2xl font-bold">Core</h3>
                <p className="mt-2 text-[#666666]">Full flexibility for growing churches.</p>
                <ul className="mt-6 flex-1 space-y-3 text-neutral-800">
                  <li>Unlimited members</li>
                  <li>Unlimited leaders</li>
                </ul>
                <a
                  href={CMS}
                  className="mt-8 inline-flex justify-center rounded-full bg-[#FC4F1E] py-3.5 text-center font-semibold text-white transition hover:bg-[#e54618]"
                >
                  Get Core
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="contact" className="scroll-mt-24 border-t border-neutral-200/80 bg-[#C6F144]/20 py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-10 lg:grid-cols-2">
              <div>
                <h2 className="font-['Playfair_Display',serif] text-3xl font-bold md:text-4xl">Contact</h2>
                <p className="mt-4 text-lg leading-relaxed text-[#666666]">
                  We help churches get started. Reach out with questions—or jump straight in and create your workspace.
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
              Discipleship made easier—for leaders who love the church.
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
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FDFCF8]">{icon}</div>
      <h3 className="mt-4 font-['Playfair_Display',serif] text-xl font-bold">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-[#666666]">{body}</p>
    </div>
  );
}
