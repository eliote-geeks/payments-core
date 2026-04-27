
# Architecture

## Components

- Payments API: owns quotes, transfers, orchestration state and webhooks.
- Pricing engine: applies corridor rules, fee rules and FX rates.
- Funding rail: Hyperswitch for cards, bank redirects and payment providers.
- Settlement rail: Stellar Anchor Platform for SEP-based settlement experiments.
- Local payout rails: Cameroon mobile money and bank transfer adapters to be implemented behind provider interfaces.
- Datastores: Postgres for durable state; Redis/Kafka are provider dependencies for Hyperswitch/Stellar.

## Initial Cameroon Corridors

| Source | Target | Destination | Payout |
| --- | --- | --- | --- |
| EUR | XAF | CM | mobile_money |
| USD | XAF | CM | mobile_money |
| GBP | XAF | CM | mobile_money |
| CAD | XAF | CM | mobile_money |
| EUR | XAF | CM | bank |
| USD | XAF | CM | bank |
| XAF | EUR | FR | bank |
| XAF | USD | US | bank |

## Production Gaps

- Strong customer identity and KYC model.
- Provider credential vaulting.
- Idempotency keys for quote/transfer creation.
- Double-entry ledger.
- Settlement reconciliation jobs.
- Webhook signature verification.
- Admin operations UI.
- Compliance review for each corridor.
