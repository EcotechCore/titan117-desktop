# OpenRouter: our credits model is allowed

**Received:** 8 Nov 2026, from OpenRouter, in answer to our question about funding one account and letting subscribers use credits through our app (external-services.md, decisions §12). Keep the original message (email or support ticket) with the company records; this is the text as received.

---

Yes, you can use a single, public/general OpenRouter API key for your entire application where you fund the account yourself and let your subscribed users consume those credits. This is a very common architectural pattern for SaaS applications (like Lovable, v0, or Bolt).

However, you must implement this carefully to protect your account and budget. Here is how to handle it safely and effectively:

1. **Keep the Key Secure (Never Expose It to Users).** The most important rule is that your API key must never be visible to the user's browser or device. If a user can inspect the network traffic and see your OpenRouter key, they can steal it and drain your entire account balance. The Solution: Route all AI requests through your own backend server. Your app's frontend talks to your server, and your server appends the hidden API key and forwards the request to OpenRouter.
2. **Use OpenRouter's Built-In Tools for App Creators.** Scoped API Keys: instead of using your main account master key, you can generate specific keys in your OpenRouter dashboard and give them specific permissions or label them for tracking. Budget Limits: you can set strict auto-renew limits or hard caps on your OpenRouter account so that unexpected traffic spikes (or a bug in your loop code) won't accidentally charge your credit card thousands of dollars.
3. **Implement "Rate Limiting" on Your End.** Because you are paying for the API usage and your users are paying you a flat subscription fee, you need to prevent a single user from abusing your system. Track how many tokens or requests each subscribed user is making in your own database. Block or throttle users who exceed their fair share or their subscription tier's allowance, so they don't bankrupt your global API wallet.

---

## How our design already meets it

| Their advice | Where we have it |
|---|---|
| Key never on the user's device; requests go through our backend | The proxy on Vercel holds the one key (decisions §12, guardrails §8) |
| Scoped keys and hard caps | A spending cap and low-balance alert on the account (security.md B4); per-user capped keys only for email tasks (decisions §27) |
| Track and limit each user | The Convex credit ledger, a minimum balance before each request, rate limits and abuse checks in the proxy (guardrails §2, §3) |
