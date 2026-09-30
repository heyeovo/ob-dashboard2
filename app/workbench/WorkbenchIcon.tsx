export type WorkbenchIconName = 'folder' | 'note' | 'lock' | 'plug' | 'wave' | 'lens' | 'slice' | 'layers' | 'now' | 'file' | 'code' | 'page'

const paths: Record<WorkbenchIconName, React.ReactNode> = {
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  note: <><path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" /><path d="M8.5 9h6.5M8.5 12.5h6.5M8.5 16h4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  plug: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" />,
  wave: <path d="M3 12h3l2.5-6 4 12 2.5-6h6" />,
  lens: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  slice: <path d="M4 6.5h16M4 12h16M4 17.5h10" />,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5" /></>,
  now: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  file: <><path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M13.5 3.5V8H18" /></>,
  code: <path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5" />,
  page: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 8.5h17" /></>,
}

export function WorkbenchIcon({ name, primary = false }: { name: WorkbenchIconName; primary?: boolean }) {
  return <span className={`flex size-[30px] shrink-0 items-center justify-center rounded-[var(--radius-md)] ${primary ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">{paths[name]}</svg></span>
}
