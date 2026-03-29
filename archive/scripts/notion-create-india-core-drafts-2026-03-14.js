#!/usr/bin/env node
/** Create India-specific core narrative drafts in Omni Content Pipeline.
 * Usage: NOTION_KEY=... node scripts/notion-create-india-core-drafts-2026-03-14.js
 */

const NOTION_VERSION = '2025-09-03';
const NOTION_KEY = process.env.NOTION_KEY;
if (!NOTION_KEY) {
  console.error('Missing NOTION_KEY env var');
  process.exit(1);
}

const OMNI_DB_ID = '6a67cf48-cf2b-4391-9d13-7236bdc32e20';

async function notion(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status} ${json?.message || res.statusText}`);
  }
  return json;
}

function chunkText(text, max = 1800) {
  const chunks = [];
  const paras = text.split(/\n\n+/);
  let buf = '';
  for (const p of paras) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length > max) {
      if (buf) chunks.push(buf);
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) chunks.push(p.slice(i, i + max));
        buf = '';
      } else {
        buf = p;
      }
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const paragraph = (text) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: { rich_text: [{ type: 'text', text: { content: text } }] }
});

async function createDraft({ name, content, sourceLabel }) {
  const page = await notion('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: OMNI_DB_ID },
      properties: {
        Name: { title: [{ type: 'text', text: { content: name } }] },
        Status: { select: { name: 'Drafting' } },
        Review: { select: { name: 'Pending' } },
        Project: { select: { name: 'Fence' } },
        'Asset Type': { select: { name: 'Guide' } },
        Platforms: { multi_select: [{ name: 'X/Twitter' }, { name: 'LinkedIn' }, { name: 'Reddit' }] },
        'Publish Date': { date: { start: '2026-03-14' } },
        Source: { rich_text: [{ type: 'text', text: { content: sourceLabel } }] }
      }
    }
  });

  const blocks = chunkText(content).map(paragraph);
  for (let i = 0; i < blocks.length; i += 50) {
    await notion(`/blocks/${page.id}/children`, { method: 'PATCH', body: { children: blocks.slice(i, i + 50) } });
  }
  return { id: page.id, url: page.url };
}

const drafts = [
  {
    name: 'Core Draft (India) — AA is consent plumbing, not privacy magic',
    sourceLabel: 'Main model (India-specific core narrative)',
    content: `Core story: India’s Account Aggregator (AA) is a *better* way to share financial data — but it doesn’t automatically mean “no one stores my data.”\n\nIn India, an Account Aggregator is a regulated entity: an NBFC-AA, licensed by the RBI. The RBI’s NBFC-AA Directions define the “business of an account aggregator” as retrieving/collecting and consolidating a customer’s financial information to present it to the customer or a regulated Financial Information User (FIU) — and explicitly state that the customer’s financial information is not the property of the Account Aggregator and is not to be used in any other manner. (RBI Master Direction: NBFC–Account Aggregator Directions, 2016 — updated over time.)\n\nSahamati’s explainer also emphasizes the intent: the AA cannot share your data without your consent, and the AA does not store or process your data; financial data is encrypted.\n\nThat architecture matters because it reduces the “credential sharing / scraping” model (where a third party might directly log into your netbanking). Consent-driven, purpose-bound sharing is a big step forward.\n\nBut here’s the nuance people miss: the AA is not the final destination. Your bank (a Financial Information Provider / FIP) shares data to a Financial Information User (FIU) *because you asked it to*. Once the FIU receives that data (transactions, balances, etc.), they will almost certainly process it — and many will store some form of it (raw data, normalized data, derived insights, and logs) to provide the service you signed up for.\n\nSo if you care about privacy, the question is not only “Is this AA-based?” It’s also:\n- What exact data is being requested?\n- For what purpose?\n- How long is consent valid / how often will it refresh?\n- What is the FIU’s retention policy?\n- Can you revoke consent cleanly and verify it’s revoked?\n\nPractical takeaway: AA is a strong consent rail. But privacy still depends on *data minimization* + *retention* + the FIU’s practices.\n\nSources: RBI Master Direction — NBFC-AA Directions (2016, updated), Sahamati “What is Account Aggregator?”` 
  },
  {
    name: 'Core Draft (India) — “Every fintech stores your data” (what’s true + what’s sloppy)',
    sourceLabel: 'Main model (India-specific core narrative)',
    content: `Core story: When people say “every fintech stores your data,” they’re usually pointing at a real structural reality — but we should describe it precisely.\n\nIn a consent-based ecosystem (including India’s AA), your financial data starts at a regulated institution (FIP) and is shared to another regulated institution (FIU) based on your consent. The AA acts as the consent and data-sharing rail; it’s not supposed to treat your financial info as its property or use it beyond that role (per RBI’s NBFC-AA Directions).\n\nNow the hard truth: the moment an FIU receives your transaction stream, the FIU must *process* it to offer value. And processing almost always creates storage, even if temporary. Examples:\n- Caching and reconciliation so dashboards load fast\n- Categorization/merchant enrichment and “derived data”\n- Audit logs and debugging trails\n- Risk/fraud controls\n- Customer support investigation\n\nSo “store your data in some form” is often accurate — but it’s not automatically predatory. It can be: (a) operational necessity, (b) compliance, or (c) business-model driven. The privacy problem is that users rarely get clarity on which one it is.\n\nThe bar we should expect from finance apps in India:\n1) **Specific consent** (not “all accounts forever”).\n2) **Short, explicit retention** (and deletion on request).\n3) **Local-first options** where feasible (less server-side storage).\n4) **Revocation that actually works** (and is visible to the user).\n5) **No dark patterns** (don’t punish users for choosing minimal access).\n\nThe goal isn’t to kill open finance. It’s to build it without turning your bank statement into an advertising profile.\n\nSources: RBI NBFC-AA Master Direction (business definition + restrictions), Sahamati AA overview.`
  },
  {
    name: 'Core Draft (India) — A privacy checklist before you link your bank / AA consent',
    sourceLabel: 'Main model (India-specific core narrative)',
    content: `Use this checklist before you approve an AA consent or link your bank account inside a finance app.\n\n1) **Who is the FIU?**\nThe FIU (the app/service) is the endpoint that will receive your data. “AA-based” doesn’t automatically mean “privacy-safe.”\n\n2) **What data is requested?**\nOnly balances? Or full transaction history? Identity fields? If an app’s feature is simple, broad access is a red flag.\n\n3) **Purpose + frequency**\nDoes the consent say why the data is needed and how often it will be fetched (one-time vs recurring refresh)?\n\n4) **Retention + deletion**\nLook for an explicit retention policy. If it’s missing, assume the data may stick around longer than you expect (raw + derived + logs).\n\n5) **Revocation path**\nDo you know exactly how to revoke consent later and confirm it’s revoked? Put a reminder to audit and revoke unused consents.\n\n6) **Security isn’t privacy**\nTokenized flows are better than credential sharing, but privacy is about least privilege + time-bound access + minimal storage.\n\n7) **The standard we should demand**\nFinance products should treat your transaction history like medical records: access should be granular, auditable, and reversible.\n\nSources: RBI NBFC-AA Master Direction; Sahamati “What is Account Aggregator?”`
  }
];

(async () => {
  const out = [];
  for (const d of drafts) out.push({ name: d.name, ...(await createDraft(d)) });
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
