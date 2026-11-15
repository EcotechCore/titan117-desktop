# Pricing

16 Oct 2026. **Decided:** the plan ladder (Starter €15, Pro €25, Max €50, Custom; **no free plan**, decided 17 Oct), credits per plan (700, 1,500, 3,500), what each plan includes, the credit value, rollover and currencies. Prices are before VAT; Stripe Tax adds it where it applies (decisions §12).

## What Lovable gives for $25 (and how we beat it)

Lovable Pro is **$25/month for 100 credits plus 5 daily bonus credits (up to 150 a month)**. A credit is roughly one message: plan mode costs 1 credit, agent edits about 0.5–2 credits depending on the task. Top-ups are about **$0.30 per credit**. So $25 buys **about 100–150 AI edits** a month. Lovable doesn't publish how much of that $25 is model cost.

Our credits pay real provider cost plus 25%, so what they buy depends on the model. Estimates for one typical build edit (about 30,000 tokens in, 3,000 out):

| Model used for the edit | Provider cost per edit | Our credits per edit | Edits from 1,500 credits (Pro) |
|---|---|---|---|
| Cheap open coder (DeepSeek, Qwen Coder) | about $0.015 | about 2 | **about 750** |
| Strongest models (Claude Sonnet class) | about $0.14 | about 17 | **about 90** |
| Local model | €0 | 0 | **unlimited** |

With smart routing (a strong planner, a cheap coder, local quick edits), a Pro user gets **several times Lovable's edits for the same price**, and previews, tests, documents and local models are free. These are estimates from public token prices; we'll replace them with measured numbers from our own test set (phase 8).

## What a credit is (decided)

- **1 credit = €0.01 (or $0.01) of cloud usage at our price.** A task's credits = provider cost × **1.25**, rounded up.
- Every task shows its estimate first and can be capped.
- **Included in every plan, without credits:** local models, previews, tests, documents, and anything run with your own API key.
- Cloud calls go through our proxy, which checks the balance before a request and deducts credits after it (decisions §12).

## Plans

| | Starter | Pro | Max | Custom |
|---|---|---|---|---|
| **Price** | **€15 / $15** | **€25 / $25** | **€50 / $50** | Talk to us |
| **Yearly** | €150 / $150 (2 months free) | €250 / $250 | €500 / $500 | Custom |
| **Credits a month** | 700 | 1,500 | 3,500 | Custom pool |
| **Local models, previews, tests** | Unlimited | Unlimited | Unlimited | Unlimited |
| **All agents and the app builder** | Yes | Yes | Yes | Yes |
| **Your own API keys** | Yes | Yes | Yes | Yes |
| **Credit top-ups** | Yes | Yes | Yes | Yes |
| **Remote control and chat channels** | Yes | Yes | Yes | Yes |
| **Share artifacts, publish apps** | Yes | Yes | Yes | Yes |
| **Devices** | 2 | 3 | 5 | Custom |
| **Teams, roles, audit log, SSO** | — | — | — | Yes |
| **Agency and white-label** | — | — | — | Yes |
| **Support** | Email | Email | Priority | Dedicated |

**Who it's for:** Starter as the way in; Pro for one person running a company; Max for heavy daily use of cloud models; Custom for teams and agencies.

## No free plan

Titan117 works only with an active subscription (decisions §13). There is no free version and no trial; the app locks when the subscription ends or the offline licence expires (decisions §17).

## Top-ups

| Pack | Price | Per credit |
|---|---|---|
| 1,000 credits | €10 / $10 | 0.010 |
| 2,750 credits | €25 / $25 | 0.009 |
| 6,000 credits | €50 / $50 | 0.0083 |

For comparison, Lovable top-ups are about $0.30 per credit (one edit); our 1,000-credit pack buys about 500 cheap-model edits.

## Rollover and expiry (decided)

- **Monthly credits roll over for one month**, capped at one month's allowance.
- **Top-up credits last 12 months**, usable while a paid plan is active.
- **Order of use:** this month's credits, then rolled-over credits, then top-ups (oldest first).
- **Cancelling:** the plan runs to the end of the paid period; then the app locks, monthly credits expire and top-ups wait (up to 12 months) for a new subscription.
- **Upgrading:** the new allowance starts at once, prorated. **Downgrading** takes effect at the next period.
- **No refunds** (decisions §33.8): plans and top-ups aren't refunded. Private buyers waive the 14-day withdrawal right with the checkbox at Checkout. The only exceptions are our own billing mistakes or long outages, handled by hand.

## Currencies (decided)

**EUR and USD** at launch, same numbers in both. Regional prices later.

## Rough economics per month, if every credit is used

| | Starter | Pro | Max |
|---|---|---|---|
| Price | 15.00 | 25.00 | 50.00 |
| Credits at cost (credits ÷ 1.25 ÷ 100) | −5.60 | −12.00 | −28.00 |
| Stripe fees (about) | −0.50 | −0.65 | −1.00 |
| Our cloud per user (estimate) | −0.50 | −0.50 | −0.50 |
| **Left** | **about 8.40** | **about 11.85** | **about 20.50** |

Most users won't use every credit; top-ups carry the 25% margin. The OpenRouter account Ecotechcore funds (about €1,000) is the float; an alert fires when it runs low.
