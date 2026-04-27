
# Payments Core

Payments Core is a cross-border payments orchestration service focused on Cameroon corridors. It is designed to price transfers, collect funds through multiple payment providers, settle through African and international rails, and expose operational state through a single API.

Current status: early MVP. The Kubernetes stack is running on the VPS, but this repository is now the source of truth for continued development.

## Target Product

- Countries: Cameroon first, then CEMAC/West Africa, Europe, UK, US and Canada.
- Currencies: XAF first, then EUR, USD, GBP, CAD and selected regional currencies.
- African rails: MTN MoMo, Orange Money, bank transfer, Stellar anchor rails.
- Western rails: card, bank transfer, wallet and provider-based payment intents through Hyperswitch.
- Core flows: corridors, quotes, transfer creation, provider orchestration, webhook ingestion and reconciliation.

## Repository Layout

- `payments-api/`: FastAPI orchestration API.
- `infra/k8s/payments-core/`: Kubernetes manifests for the dev cluster.
- `docs/`: architecture and roadmap notes.
- `docker-compose.yml`: local development stack.

## API Surface

- `GET /` service metadata.
- `GET /health` dependency health.
- `GET /catalog/countries` supported country catalog.
- `GET /catalog/payment-methods` payment method catalog.
- `GET /corridors` active pricing corridors.
- `POST /quotes` create a quote.
- `GET /quotes/{quote_id}` retrieve a quote.
- `POST /transfers` create a transfer intent.
- `GET /transfers/{transfer_id}` retrieve a transfer.
- `POST /webhooks/hyperswitch` ingest Hyperswitch events.
- `POST /webhooks/stellar` ingest Stellar events.

## Local Development

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:8080/
```

Run tests:

```bash
cd payments-api
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

## Security Notes

- Do not commit real secrets. Kubernetes secret examples live under `infra/k8s/payments-core/examples/`.
- The dev VPS currently exposes public dev endpoints. Production must add firewall allowlists, proper secret management, authentication and audit logging before handling real money.
- Current provider integrations are orchestration stubs except dependency checks and webhook persistence. Real money movement must be enabled provider-by-provider with reconciliation tests.
