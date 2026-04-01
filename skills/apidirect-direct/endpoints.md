# API Direct Endpoint Reference

Use this reference when you need direct API Direct calls without routing through `workspace/scripts/research.js`.

## Minimal Node Helper

```javascript
const fs = require('fs');
const path = require('path');

function readMaybe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function getApiDirectKey() {
  return (
    process.env.APIDIRECT_API_KEY ||
    readMaybe(path.join(process.env.HOME, '.openclaw', 'credentials', 'apidirect-api-key.txt')) ||
    readMaybe(path.join(process.env.HOME, 'credentials', 'apidirect-api-key.txt'))
  );
}

async function apiDirect(endpoint, params) {
  const apiKey = getApiDirectKey();
  if (!apiKey) throw new Error('API Direct key missing');

  const url = new URL(`https://apidirect.io${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}
```

## Twitter/X Trends

- Endpoint: `GET /v1/twitter/trends`
- Params: `woeid`
- Common WOEIDs:
  - `1` = Worldwide
  - `23424848` = India
- Key fields:
  - `trends[].name`
  - `trends[].tweet_volume`
  - `trends[].url`

Example:

```javascript
const data = await apiDirect('/v1/twitter/trends', { woeid: 23424848 });
console.log(data);
```

## Twitter/X Posts

- Endpoint: `GET /v1/twitter/posts`
- Params:
  - `query`
  - `pages`
  - `sort_by` = `relevance` or `most_recent`
- Key fields:
  - `posts[].snippet`
  - `posts[].likes`
  - `posts[].retweets`
  - `posts[].replies`
  - `posts[].views`
  - `posts[].author`
  - `posts[].author_followers`

Example:

```javascript
const data = await apiDirect('/v1/twitter/posts', {
  query: 'local first app',
  pages: 1,
  sort_by: 'relevance',
});
console.log(data);
```

## Instagram Posts

- Endpoint: `GET /v1/instagram/posts`
- Params:
  - `query`
  - `pages`
- Key fields:
  - `posts[].snippet`
  - `posts[].likes`
  - `posts[].comments`
  - `posts[].shares`
  - `posts[].views`
  - `posts[].author`
  - `posts[].media_type`

Example:

```javascript
const data = await apiDirect('/v1/instagram/posts', {
  query: 'fintech india startup',
  pages: 1,
});
console.log(data);
```

## LinkedIn Posts

- Endpoint: `GET /v1/linkedin/posts`
- Params:
  - `query`
  - `page`
  - `sort_by` = `relevance` or `most_recent`
- Key fields:
  - `posts[].snippet`
  - `posts[].author`
  - `posts[].date`
  - `posts[].url`

Example:

```javascript
const data = await apiDirect('/v1/linkedin/posts', {
  query: 'privacy engineering data',
  page: 1,
  sort_by: 'relevance',
});
console.log(data);
```

## Cost Notes

- X trends: `$0.006/request`
- X posts: `$0.006/page`
- Instagram posts: `$0.006/page`
- LinkedIn posts: `$0.006/request`

Start with one request. Only scale out if the first response is clearly useful.
