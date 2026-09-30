import JournalReader from './reader'

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <JournalReader id={id} />
}
