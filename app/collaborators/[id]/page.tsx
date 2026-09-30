import CollaboratorPage from '../CollaboratorPage'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CollaboratorPage id={id} />
}
