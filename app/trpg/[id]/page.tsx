import TrpgTable from './TrpgTable'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TrpgTable gameId={id} />
}
