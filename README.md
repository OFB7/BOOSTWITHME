# BOOSTWITHME — Full-Platform Starter

This is a working full-stack starter for the BOOSTWITHME social-media growth platform.

## Included now
- Express backend
- SQLite database with automatic schema creation
- Customer registration/login/logout
- HTTP-only cookie session (JWT)
- Service catalog
- Order creation
- Customer order dashboard
- Support ticket creation
- Admin dashboard with revenue/order/customer metrics
- Admin order listing/status controls
- Admin service/pricing management
- Admin support-ticket management
- Paystack server-side transaction initialization
- Paystack webhook signature validation
- Server-side payment amount verification
- Responsive professional frontend

## Run locally

Requirements: Node.js 20+.

1. Copy `.env.example` to `.env`.
2. Set a long random `JWT_SECRET`.
3. Add your Paystack test secret key to `PAYSTACK_SECRET_KEY`.
4. Run:
   `npm install`
   `npm run dev`
5. Open `http://localhost:3000`.

The database file `boostwithme.db` is created automatically.

## Paystack setup

Paystack's current documentation says transaction initialization should happen on the backend and the secret key must not be exposed in frontend code. The backend in this project follows that pattern. It also verifies webhook signatures and checks the paid amount against the order amount before marking an order paid.

Set the webhook endpoint in your Paystack dashboard to:

`https://boostwithme.com/api/payments/paystack/webhook`

The callback page is:

`https://boostwithme.com/payment/callback`

Use Paystack Test Mode while developing.

## Admin

Set `ADMIN_EMAIL` to `danyellsdave7@gmail.com` before the first registration. The configured business/admin contact is David Daniel, WhatsApp 08144594011, with support at boostwithme7@gmail.com and the intended domain boostwithme.com. A user registering with that exact email becomes an admin. In a production deployment, use a controlled admin provisioning process instead of relying on this bootstrap shortcut.

Admin endpoints:
- GET `/api/admin/stats`
- GET `/api/admin/orders`
- PATCH `/api/admin/orders/:publicId/status`
- GET/POST/PATCH `/api/admin/services`
- GET/PATCH `/api/admin/tickets`

## Production checklist

Before going live:
- Use PostgreSQL or another managed production database instead of SQLite.
- Store secrets only in environment/secret management.
- Put the site behind HTTPS.
- Add email verification and password reset.
- Add CSRF strategy if authentication architecture changes.
- Add rate limiting, audit logging and stronger admin controls.
- Add refund handling and payment reconciliation.
- Configure your production admin provisioning and access policy.
- Configure Paystack live keys only after successful test-mode validation.
- Review the exact social-media services and platform terms. BOOSTWITHME should use legitimate promotional/marketing methods and should not automate fake accounts, bot engagement or fabricated metrics.


## V2 additions
- Customer order timeline/details view
- Customer support history in dashboard
- Admin customer management and role controls
- Paid-order metrics in admin analytics
- Lightweight authentication rate limiting
- Expanded operational dashboard

## Important production notes
This package is still a launch candidate, not a substitute for a production security review. Before taking real traffic, migrate the development SQLite database to PostgreSQL, use explicit admin provisioning, add durable rate limiting, configure HTTPS, verify email/password recovery, configure backups and monitoring, and validate payment/refund/reconciliation flows in Paystack test mode before enabling live payments.
