---
layout: home
title: OpenSubLists
titleTemplate: false

hero:
  name: OpenSubLists
  text: A subscription ledger you control
  tagline: Track recurring costs in their original currencies, estimate monthly and yearly totals, and keep the deployment small.
  actions:
    - theme: brand
      text: Run locally
      link: /guide/self-hosting#run-locally-first
    - theme: alt
      text: Self-host on Cloudflare
      link: /guide/self-hosting

features:
  - title: Private by default
    details: Cloudflare Access handles invite-only sign-in while every D1 query remains scoped to the verified user.
  - title: Multi-currency estimates
    details: See one reporting-currency estimate without losing the original amount and currency for each subscription.
  - title: Small deployment
    details: One full-stack Worker and one D1 database run the responsive website, API, scheduled jobs, and storage.
---

## See upcoming costs clearly

OpenSubLists is a responsive website for recording subscriptions. It is an estimated
ledger, not a bank feed: projected charges come from the recurrence rules you enter.

![OpenSubLists Dashboard showing estimated totals, upcoming charges, and category breakdowns](../docs/assets/open-sublists-dashboard-prototype-web.png)

## Choose a starting point

- **Run locally** with local D1 and a fixed development identity. You do not need a
  Cloudflare account for this path.
- **Self-host on Cloudflare** when you are ready to use your own hostname, D1 database,
  and invite-only Access policy.

[Follow the self-hosting guide](/guide/self-hosting) or
[view the source repository](https://github.com/hansarnold/SubList).
