# Proton SMTP (auth mail) — setup plan

Small in-between phase: send Supabase Auth email (confirm, magic link, recovery) through **Proton Mail SMTP** instead of Supabase’s built-in mailer.

## Why the “custom domain” message?

Paid Proton alone is **not** enough for SMTP submission.

Proton’s SMTP feature only works with an **active custom-domain address** (e.g. `noreply@yourdomain.com`), not `@proton.me` / `@protonmail.com`.

That means you need **all** of:

1. A paid Proton plan that allows custom domains  
2. A domain you own (bought from a registrar — Namecheap, Cloudflare, etc.)  
3. That domain **added and verified** in Proton (DNS: verification TXT, then MX / SPF / DKIM / DMARC as Proton shows)  
4. At least one **address created on that domain** in Proton (e.g. `mamba@yourdomain.com`)  
5. Then **Generate token** paired with that address  

Custom domains are *available* on paid plans; they are **not** pre-activated with a free Proton address. You bring your own domain and point DNS at Proton.

Official refs: [SMTP submission](https://proton.me/support/smtp-submission), [Custom domain](https://proton.me/support/custom-domain).

## Goal for Mamba

| Today | After |
|-------|--------|
| Confirm email off; ~2 built-in mails/hour | Proton SMTP; raise Auth email rate limits |
| Magic link optional / flaky on free mailer | Reliable magic link + password recovery |
| Optional confirm email | Can re-enable Confirm email if desired |

No app code change is required for basic SMTP — this is **Supabase Dashboard + Proton + DNS**.

## Checklist

### A. Domain (one-time)

1. Buy/use a domain you control (e.g. `example.com`).
2. Proton → **Settings → Domain names** → Add domain.
3. Add the verification TXT at your DNS host; wait until Proton marks the domain verified.
4. Add MX, SPF, DKIM, DMARC records Proton lists (keep MX priority correct; remove competing MX if cutting over mail fully).
5. Create an address on that domain, e.g. `noreply@example.com` or `auth@example.com`.

### B. SMTP token

1. Proton → **Settings → All settings → IMAP/SMTP → SMTP tokens**.
2. **Generate token** → name it `mamba-supabase` → select the custom-domain address.
3. Copy **SMTP username** (= that address) and **SMTP token** (shown once). Store in a password manager.

Connection values:

| Field | Value |
|-------|--------|
| Host | `smtp.protonmail.ch` |
| Port | `587` |
| Encryption | STARTTLS |
| Auth | PLAIN / LOGIN |
| User | custom domain address |
| Password | SMTP token (not your Proton login) |

### C. Supabase

1. Project → **Authentication → SMTP Settings** → enable custom SMTP.
2. Fill host/port/user/pass from above; set **Sender email** to the same custom-domain address (must match).
3. Set a clear **Sender name** (e.g. `Mamba`).
4. **Authentication → Rate Limits**: raise email-related limits as needed.
5. Optional: **Providers → Email** → enable **Confirm email** once SMTP works.
6. Optional: customize Auth email templates (confirm / magic link / recovery) so links use your site URL.

### D. Verify

1. Sign up a throwaway account → confirm mail arrives From your domain.
2. Request a magic link → arrives and redirects to the app.
3. Request password recovery if you use it.
4. Check Proton **Sent** for SMTP submissions.

## Out of scope / notes

- SMTP mail is **not** end-to-end encrypted to recipients; Proton still stores Sent with zero-access encryption.
- Do not put the SMTP token in the repo or `VITE_*` env — Dashboard secrets only (or a server-side secret store).
- If you don’t want to buy a domain yet, keep Confirm email off and stay on Supabase’s built-in mailer (or use another SMTP provider that allows sending without a custom domain — Proton specifically requires one).
- Alternatives if you skip Proton: Resend, Postmark, Amazon SES, etc. (same Supabase SMTP UI).

## Done when

- [ ] Custom domain verified + address active in Proton  
- [ ] SMTP token generated  
- [ ] Supabase custom SMTP sending successfully  
- [ ] Magic link and/or confirm email tested end-to-end  
- [ ] README Auth section updated (Confirm email / SMTP notes)  
