import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, Clock3, PanelsTopLeft, Search, type LucideIcon } from "lucide-react";

export function WorkspaceOverview({ workspaces, children }: {
  workspaces: { id: string; label: string; icon: LucideIcon; details: string[]; open: () => void }[];
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const visible = workspaces.filter(({ label, details }) =>
    [label, ...details].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <div className="workspace-overview">
      <header className="overview-heading">
        <div>
          <h1>Operations overview</h1>
          <p><CalendarDays size={17} /> {new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeZone: "Asia/Manila" }).format(new Date())}</p>
        </div>
        <div className="workspace-search">
          <Search size={18} aria-hidden="true" />
          <input ref={search} type="search" aria-label="Search workspaces" placeholder="Search workspaces…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </header>
      <section className="overview-section" aria-labelledby="recent-assignments">
        <h2 id="recent-assignments"><Clock3 size={18} /> Current assignments</h2>
        {children}
      </section>
      <section className="overview-section" aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading"><PanelsTopLeft size={18} /> Workspaces</h2>
        {visible.length ? (
          <div className="workspace-grid">
            {visible.map(({ id, label, icon: Icon, details, open }) => (
              <button type="button" className="workspace-card" key={id} onClick={open}>
                <span className="workspace-card-icons"><span><Icon size={20} strokeWidth={1.6} /></span><ArrowUpRight size={21} strokeWidth={1.6} /></span>
                <span className="workspace-card-copy">
                  <strong>{label}</strong>
                  {details.map((detail) => <small key={detail}>{detail}</small>)}
                </span>
              </button>
            ))}
          </div>
        ) : <p className="workspace-search-empty" role="status">No workspaces match your search.</p>}
      </section>
    </div>
  );
}
