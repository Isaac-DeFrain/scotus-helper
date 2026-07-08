import { ExchangeDetailPage } from "../ExchangeDetailPage";

type HistoryPageProps = {
  params: Promise<{ id: string }>;
};

export default async function HistoryPage({ params }: HistoryPageProps) {
  const { id } = await params;
  const exchangeId = Number.parseInt(id, 10);

  if (!Number.isFinite(exchangeId) || exchangeId <= 0) {
    return <ExchangeDetailPage exchangeId={-1} />;
  }

  return <ExchangeDetailPage exchangeId={exchangeId} />;
}
