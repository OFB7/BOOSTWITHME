# BOOSTWITHME production deployment

## Architecture

- Node.js + Express web service
- Render Postgres for persistent production data
- Paystack for payments
- HTTPS custom domain: `boostwithme.com`
- Environment variables for all secrets

The production runtime uses PostgreSQL through `pg`. SQLite is no longer a production dependency.

## Render deployment

1. Put this project in a Git repository.
2. Create a Render Blueprint from `render.yaml`.
3. Render provisions the web service and PostgreSQL database.
4. Set the secret/sensitive values in the Render Dashboard:
   - `APP_URL=https://boostwithme.com`
   - `FRONTEND_URL=https://boostwithme.com`
   - `JWT_SECRET` (Render can generate this)
   - `PAYSTACK_SECRET_KEY` (use test key first)
   - `EMAIL_WEBHOOK_URL`
   - `EMAIL_FROM`
5. Confirm `/api/health` reports `database: postgresql`.

Render supports referencing a Postgres connection string from a Blueprint database with `fromDatabase`, and supports `sync: false` for secrets. Do not commit secret values to `render.yaml`.

## Domain

Add `boostwithme.com` to the Render web service, then configure the DNS records shown by Render at the domain registrar. Render automatically provisions/renews TLS and redirects HTTP traffic to HTTPS.

## Paystack

Use Paystack test credentials for staging. The server initializes transactions and verifies the transaction reference and amount. The webhook validates the HMAC-SHA512 signature and only marks an order paid when the event status and amount match the stored order.

Before live launch:

- Configure the Paystack webhook URL as `https://boostwithme.com/api/payments/paystack/webhook`.
- Confirm test transactions end in `processing` after verified payment.
- Confirm duplicate webhook/callback delivery does not duplicate fulfillment.
- Replace the test secret with the live secret only in Render's secret environment variable.

## Email

Email verification and password reset use `EMAIL_WEBHOOK_URL`. Connect this to a transactional email provider that accepts the JSON payload documented in `.env.example`.

## Admin

The bootstrap admin email is `danyellsdave7@gmail.com`. The first registration using that email receives the admin role. For production, use controlled account provisioning and do not share the administrator password with developers or in chat.

## Pre-launch checklist

- [ ] PostgreSQL health check passes
- [ ] Registration/login works
- [ ] Email verification works through the real email provider
- [ ] Password reset works
- [ ] Customer can create an order
- [ ] Paystack test payment initializes
- [ ] Paystack callback verification works
- [ ] Paystack webhook works and is idempotent
- [ ] Admin dashboard loads customer/order/payment data
- [ ] Admin can change order status
- [ ] Support ticket workflow works
- [ ] `boostwithme.com` resolves to Render and HTTPS is active
- [ ] Production secrets are set only in the hosting environment
- [ ] Final service descriptions/prices and refund/terms/privacy pages are approved


## Deployment verification note
The deployment Blueprint uses current Render compute-plan identifiers (`0.5c-512mb` for the web service and `0.1c-256mb` for PostgreSQL) and enables PostgreSQL connection pooling with PgBouncer. Render documents these plan IDs and Blueprint database connection pooling in its current documentation.
