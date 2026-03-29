#!/usr/bin/env node
/** Create draft pages in the Omni Content Pipeline database and append the draft text as blocks.
 * Usage: NOTION_KEY=... node scripts/notion-create-drafts-2026-03-14.js
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
    const msg = json?.message || res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return json;
}

function chunkText(text, max = 1800) {
  const chunks = [];
  const lines = text.split(/\n/);
  let buf = '';
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > max) {
      if (buf) chunks.push(buf);
      // if single line too long, hard-split
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line;
      }
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function paragraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }]
    }
  };
}

async function createDraft({ name, project, assetType, platforms, publishDate, sourceLabel, content }) {
  const page = await notion('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: OMNI_DB_ID },
      properties: {
        Name: { title: [{ type: 'text', text: { content: name } }] },
        Status: { select: { name: 'Drafting' } },
        Review: { select: { name: 'Pending' } },
        Project: { select: { name: project } },
        'Asset Type': { select: { name: assetType } },
        Platforms: { multi_select: platforms.map((p) => ({ name: p })) },
        'Publish Date': publishDate ? { date: { start: publishDate } } : undefined,
        Source: sourceLabel ? { rich_text: [{ type: 'text', text: { content: sourceLabel } }] } : undefined
      }
    }
  });

  const blocks = [];
  for (const chunk of chunkText(content)) blocks.push(paragraphBlock(chunk));

  // Notion accepts up to 100 blocks per request; chunk if needed
  for (let i = 0; i < blocks.length; i += 50) {
    await notion(`/blocks/${page.id}/children`, {
      method: 'PATCH',
      body: { children: blocks.slice(i, i + 50) }
    });
  }

  return { id: page.id, url: page.url };
}

const drafts = [
  {
    name: 'Draft (Main) — X Thread: Bank aggregators & privacy tradeoffs',
    project: 'Personal Brand',
    assetType: 'Thread',
    platforms: ['X/Twitter'],
    publishDate: '2026-03-14',
    sourceLabel: 'Main model',
    content: `X THREAD (10 tweets) — Bank aggregators, open banking, and privacy\n\n1/ “Connect your bank” feels like a single click. In reality, it often introduces *another* party into your financial life: a data aggregator / open-banking provider.\n\n2/ The basic setup is usually: Bank → (Aggregator / Open Banking API) → App (budgeting, lending, investing, BNPL, etc.). Each hop has its own policies, retention, and risk surface.\n\n3/ Security has improved in many markets with token-based access (OAuth / bank APIs). That’s good: you’re typically not handing your password to the app. But privacy ≠ security.\n\n4/ Privacy question #1: *How much data is pulled?* Many products ask for transactions, balances, and sometimes identity fields. The app might only show “balance”, but the underlying connection may request more.\n\n5/ Privacy question #2: *How long does access last?* Some connections are designed to refresh over time until consent is revoked or expires. Deleting the app isn’t always the same as revoking access.\n\n6/ Privacy question #3: *Where is the data stored?* To provide features (categorization, trends, underwriting), apps and their vendors often store copies of transaction data, derived labels, and logs—at least for some period.\n\n7/ This is why “every company using aggregation stores your data in some form” is practically true: even if the bank is the source, the moment the data leaves the bank, the recipient must process it—often persist it—to be useful.\n\n8/ Better patterns exist: data minimization, short retention windows, on-device processing, and clear consent revocation flows. But you have to *look for them*; most marketing pages won’t tell you.\n\n9/ What you can do today:\n- Prefer connections that redirect you to your bank (token-based)\n- Audit linked apps periodically\n- Revoke access you don’t need\n- Assume “free” products monetize data *indirectly* (ads, analytics, partnerships) unless proven otherwise\n\n10/ I’m not anti–open banking. I’m pro–least-privilege. Financial data is intimate: make access specific, time-bound, and revocable.\n\nSources to cite:\n- Plaid legal / end-user privacy: https://plaid.com/legal/\n- Plaid Portal (manage connections): https://my.plaid.com/\n- UK Open Banking explainer (consent, control): https://www.openbanking.org.uk/what-is-open-banking/\n- CFPB Personal Financial Data Rights (Section 1033): https://www.cfpb.gov/rules-policy/final-rules/personal-financial-data-rights/\n- Sahamati on India AA (consent + AA model): https://sahamati.org.in/what-is-account-aggregator/\n`
  },
  {
    name: 'Draft (Main) — LinkedIn: Consent is not privacy in finance apps',
    project: 'Personal Brand',
    assetType: 'Post',
    platforms: ['LinkedIn'],
    publishDate: '2026-03-14',
    sourceLabel: 'Main model',
    content: `LINKEDIN (≈650 words) — Consent is not privacy in finance apps\n\nA lot of finance apps now start with the same button: “Connect your bank.”\n\nFrom budgeting tools to loan apps to investment dashboards, this is usually powered by an account aggregation / open-banking layer (depending on geography): Plaid, Yodlee, Finicity, TrueLayer, Salt Edge, and similar providers — and in India, the Account Aggregator (AA) ecosystem.\n\nHere’s the part that doesn’t get discussed enough: **consent is not the same thing as privacy.**\n\nConsent answers: “Did the user agree?”\nPrivacy answers: “How much data is accessed, how long is it kept, who can see it, and can it be revoked easily?”\n\n### The structural privacy tradeoff\nWhen you connect an account, the data path often becomes: Bank → Aggregation / open-banking provider → App (and sometimes → analytics / cloud infra vendors).\n\nEven when access is token-based (OAuth / bank APIs), the app still receives transaction data. And once it’s received, it’s common for companies to store: \n- transaction history (raw + normalized)\n- derived categories and merchant labels\n- risk/fraud signals\n- logs needed for debugging and compliance\n\nThat’s not automatically “evil” — it’s often required to provide a usable product. But it means: **the moment your financial data leaves your bank, your privacy depends on *multiple* privacy policies and security programs.**\n\n### The retention problem (“zombie access”)\nOne of the biggest gaps in user mental models is thinking that deleting an app = revoking access.\n\nIn practice, access can persist until it expires or is explicitly revoked (at the bank, the provider’s portal, or within the app). If you’re privacy-conscious, you should treat “revoke access” as part of your normal cleanup routine.\n\n### A bright spot: India’s AA architecture\nIndia’s AA framework is interesting because it’s designed around a regulated consent layer, and participants emphasize that the AA cannot share data without consent and does not store/process the data (the intent is to reduce the ‘middleman’ data hoarding).\n\nBut even there, the key point remains: **the destination (Financial Information User / app) still receives the data and must handle it responsibly.**\n\n### A practical checklist (least privilege for money)\nIf you’re building or using finance products: \n1) **Minimize:** request only what’s needed (balances vs 24 months of transactions).\n2) **Time-bound:** make access and retention windows explicit.\n3) **Revocable:** make revocation obvious and fast.\n4) **Transparent:** show what was pulled and why.\n5) **Prefer on-device where possible:** the safest database is the one you never created.\n\nOpen banking can be a net positive. But we should stop pretending the privacy story is “you clicked consent, so it’s fine.”\n\nSources to cite:\n- CFPB Personal Financial Data Rights (Section 1033): https://www.cfpb.gov/rules-policy/final-rules/personal-financial-data-rights/\n- UK Open Banking explainer: https://www.openbanking.org.uk/what-is-open-banking/\n- Sahamati on India AA: https://sahamati.org.in/what-is-account-aggregator/\n- Plaid legal (for how a major aggregator frames privacy/retention): https://plaid.com/legal/\n`
  },
  {
    name: 'Draft (Main) — Reddit: What “Connect your bank” really means (privacy edition)',
    project: 'Personal Brand',
    assetType: 'Post',
    platforms: ['Reddit'],
    publishDate: '2026-03-14',
    sourceLabel: 'Main model',
    content: `REDDIT — What “Connect your bank” really means (privacy edition)\n\nYou know that screen in finance apps that says “Connect your bank”? The UX makes it feel like you’re only dealing with (1) your bank and (2) the app. Often there’s a third party in the middle: an account aggregator / open-banking provider.\n\nThis post isn’t anti–open banking. It’s a quick explainer of the privacy tradeoffs so you can make informed decisions.\n\n## 1) The usual data path\nBank → Aggregator/Open Banking provider → App\n\nDepending on the app, the aggregator may also be pulling identity data, account metadata, balances, and transaction history.\n\n## 2) Security has improved, but privacy is separate\nIn many cases today, you’re redirected to your bank (OAuth / API token). That’s generally better than giving your password to an app.\n\nBut even with token-based access, the app still receives a stream of transactions and balances. To power features (categorization, charts, credit scoring, alerts), it’s common to store that data on servers for some period.\n\n## 3) The retention / “zombie connection” gotcha\nDeleting the app doesn’t always revoke access. Connections can persist until you revoke them or they expire.\n\nIf you’re privacy-sensitive, treat revocation like changing a password: do it periodically.\n\n## 4) India’s Account Aggregator (AA) model\nIndia’s AA ecosystem emphasizes consent-based sharing, and the AA participant documentation highlights that the AA cannot share data without consent and does not store/process the data. That’s a strong architectural direction.\n\nBut even in that model, the destination app still gets your data — so the destination’s privacy policy matters a lot.\n\n## 5) Practical tips\n- Prefer flows that redirect you to your bank (token-based)\n- Audit which apps have active access\n- Revoke access for apps you don’t use\n- Be skeptical if a simple feature asks for lots of history\n\nIf you’ve got a bank/app combo you’re unsure about, reply with what it asked for (balances? transactions? identity?) and I can help you reason about whether that request makes sense.\n\nSources:\n- UK Open Banking: https://www.openbanking.org.uk/what-is-open-banking/\n- Plaid portal (US): https://my.plaid.com/\n- Plaid legal: https://plaid.com/legal/\n- Sahamati (India AA overview): https://sahamati.org.in/what-is-account-aggregator/\n`
  },
  {
    name: 'Draft (Flash) — X Thread: Aggregators & privacy (v1)',
    project: 'Personal Brand',
    assetType: 'Thread',
    platforms: ['X/Twitter'],
    publishDate: '2026-03-14',
    sourceLabel: 'Gemini 3.1 Flash',
    content: `X THREAD (Flash v1, 9 tweets)\n\n1/ Convenience has a shadow. Ever wondered how a budgeting app magically sees your bank balance? Often through an aggregator like Plaid, Yodlee, etc. In India: Account Aggregator (AA).\n\n2/ These frameworks are the plumbing of modern finance. They reduce manual work — but add a new layer of privacy tradeoffs.\n\n3/ Tradeoff 1: Data persistence. Some connections are designed to refresh over time until revoked/expired. If you stop using an app, check whether you’ve revoked access (deleting the app may not be enough).\n\n4/ Tradeoff 2: Secondary use. Some ecosystems have historically used de-identified / aggregated data for analytics or insights. Policies vary; check the specific provider/app terms.\n\n5/ Tech shift: scraping vs OAuth. The industry has been moving away from credential sharing/screen scraping toward OAuth/token-based access. Token-based is usually safer.\n\n6/ India’s AA model is often described as “data blind”: designed so the AA manages consent but is not intended to store/process the underlying data.\n\n7/ Even with better pipes, the destination still matters. Once data reaches the app, that app’s privacy policy and security practices dominate the risk.\n\n8/ Take control:\n- Audit linked apps\n- Revoke what you don’t use\n- Prefer token-based flows\n\n9/ Privacy isn’t about paranoia. It’s about intent + least privilege: specific access, short retention, and easy revocation.\n\nSuggested sources:\n- Plaid legal: https://plaid.com/legal/\n- Plaid Portal: https://my.plaid.com/\n- Sahamati AA overview: https://sahamati.org.in/what-is-account-aggregator/\n- UK Open Banking explainer: https://www.openbanking.org.uk/what-is-open-banking/\n- CFPB 1033 final rule: https://www.cfpb.gov/rules-policy/final-rules/personal-financial-data-rights/\n`
  },
  {
    name: 'Draft (Flash) — LinkedIn: Open banking & granular consent (v1)',
    project: 'Personal Brand',
    assetType: 'Post',
    platforms: ['LinkedIn'],
    publishDate: '2026-03-14',
    sourceLabel: 'Gemini 3.1 Flash',
    content: `LINKEDIN (Flash v1) — The Evolution of Open Banking: Why Granular Consent is the Next Privacy Frontier\n\nThe “Connect your Bank” button has become the default starting point for modern financial services. Whether you’re applying for a mortgage, managing a portfolio, or using a budgeting tool, bank account aggregation frameworks like Plaid, Yodlee, Finicity, and TrueLayer make it convenient.\n\nBut there are structural privacy tradeoffs that often get missed:\n\n• The move from scraping to structured APIs (OAuth/token-based access is generally safer than sharing passwords).\n• The persistence question: access can last longer than users assume until it’s revoked/expired.\n• Secondary markets and anonymization: de-identification is hard; policies vary by provider/app.\n• The “data-blind” hope: India’s AA is often described as designed to be data-blind, shifting responsibility to the destination app.\n\nPractical takeaways:\n1) Audit regularly (provider portals or bank dashboards where available).\n2) Question granularity (does the app really need 24 months of history?).\n3) Revoke as standard (make it part of app deletion).\n\nSources:\n- Plaid legal: https://plaid.com/legal/\n- CFPB 1033 final rule: https://www.cfpb.gov/rules-policy/final-rules/personal-financial-data-rights/\n- UK Open Banking explainer: https://www.openbanking.org.uk/what-is-open-banking/\n- Sahamati AA overview: https://sahamati.org.in/what-is-account-aggregator/\n`
  },
  {
    name: 'Draft (Flash) — Reddit explainer: Connect your bank (v1)',
    project: 'Personal Brand',
    assetType: 'Post',
    platforms: ['Reddit'],
    publishDate: '2026-03-14',
    sourceLabel: 'Gemini 3.1 Flash',
    content: `REDDIT (Flash v1) — What happens when you click “Connect your Bank”\n\nOften you’re not only trusting the app — you’re also trusting an aggregator/open banking provider that bridges the app to thousands of banks.\n\nKey points:\n- Scraping vs APIs: OAuth/token-based flows are generally safer than credential-sharing.\n- Persistence: access can continue until revoked/expired (deleting the app may not revoke).\n- India AA: AA ecosystem is described as consent-driven and designed so the AA does not store/process the data; destination still matters.\n\nTips:\n- Prefer token-based flows\n- Audit + revoke access\n- Be skeptical of overly broad data requests\n\nSources:\n- Plaid Portal: https://my.plaid.com/\n- Plaid legal: https://plaid.com/legal/\n- UK Open Banking: https://www.openbanking.org.uk/what-is-open-banking/\n- Sahamati AA overview: https://sahamati.org.in/what-is-account-aggregator/\n`
  }
];

(async () => {
  const outputs = [];
  for (const d of drafts) {
    const out = await createDraft(d);
    outputs.push({ name: d.name, url: out.url });
  }
  console.log(JSON.stringify(outputs, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
