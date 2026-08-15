import VerdictBoard from "./verdict-board";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="wrap">
      <VerdictBoard runId={id} />
    </main>
  );
}
