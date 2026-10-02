export default function ArtifactPlayer({ src, title }: { src: string; title: string }) {
  return <iframe key={src} src={src} title={title} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads" className="min-h-0 w-full flex-1 border-0 bg-[var(--color-surface)]" />
}
