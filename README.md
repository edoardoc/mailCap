# Gmail Signatures SQL Explorer

This project demonstrates how to export Gmail messages to JSON files and then query them **in place** using DuckDB's SQL interface. You can flatten nested JSON arrays (e.g. email headers) into first-class columns and work with native DuckDB data types (like TIMESTAMP) without an ETL step.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Google Service Account Setup](#google-service-account-setup)
- [Fetching Emails](#fetching-emails)
- [DuckDB Setup](#duckdb-setup)
- [Querying Signatures](#querying-signatures)

## Overview
1. **Export** your Gmail messages as individual JSON files into the `data/` directory.
2. **Define** DuckDB views (in `views.sql`) that:
   - Read the raw JSON files via `read_json_auto('data/*.json')`.
   - Unnest the `headers` array and pivot out `Date`, `From`, `To`, `Subject` into top-level columns.
   - Parse the `Date` string into a native DuckDB `TIMESTAMP`.
3. **Run** ad-hoc SQL queries against the flattened view or materialize it into a table or Parquet file for faster reads.

## Prerequisites
- Node.js (for the email fetch script)
- DuckDB CLI (install via `brew install duckdb` or `pip install duckdb`)
- A Google Cloud project with the Gmail API enabled

## Google Service Account Setup
1. In the Google Cloud Console, enable the **Gmail API** for your project.
2. Create a **Service Account** (IAM & Admin → Service Accounts) and grant it the **Gmail API Readonly** scope.
3. If accessing user mailboxes in a Google Workspace domain, configure **Domain-Wide Delegation** and authorize the scope:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```
4. Download the service account key JSON file and save it as `credentials.json` in the project root.
5. Export the environment variable so Google SDKs pick it up:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="$PWD/credentials.json"
   ```

## Fetching Emails
Emails are fetched using the Node.js script `src/index.ts` via the Gmail API.

1. Install dependencies:
   ```bash
   npm install
   ```

2. Prepare your credentials JSON (OAuth2 or Service Account) and place it at `credentials.json` in the project root,
   or set the `CREDENTIALS_PATH` environment variable to point to your file:
   ```bash
   export CREDENTIALS_PATH="$PWD/path/to/credentials.json"
   ```

3. (Service Account only) If using domain-wide delegation, set the user to impersonate:
   ```bash
   export GMAIL_IMPERSONATE_USER="user@yourdomain.com"
   ```

4. Run the fetch script to save each message as its own JSON file under `data/`:
   ```bash
   # using ts-node
   npx ts-node src/index.ts

   # or pass credentials path as argument:
   npx ts-node src/index.ts path/to/credentials.json
   ```

The script will create `data/` (if missing) and write files like `data/<message-id>.json`, each containing
the message ID, thread ID, snippet, label IDs, and headers (`From`, `To`, `Subject`, `Date`).

## DuckDB Setup
1. Initialize or open a persistent DuckDB database file:
   ```bash
   duckdb signatures.duckdb
   ```
2. Load the view definitions:
   ```sql
   .read views.sql
   ```
   This creates three views:
   - `signatures`: raw JSON over `data/*.json`
   - `signature_expanded`: flattened headers and parsed `date` timestamp
   - `signature_expanded_cache`: flattened headers table cached into a table

## Caching Results
To avoid JSON re-parsing on every query, the view gets materialised into a table every time views are recreated:
```sql
CREATE OR REPLACE TABLE signature_expanded_cache AS
    SELECT * FROM signature_expanded;
```

## Querying Signatures
Run any SQL you like against the flattened view:
```sql
SELECT date, from_email, to_email, subject
  FROM signature_expanded_cache
 WHERE date >= '2022-01-01'
 LIMIT 20;
```

```sql
-- the biggest senders by number of emails
select
  count(*) as howmany,
  from_email as sender
from
  signature_expanded_cache
group by
  sender
order by
  howmany desc;
```

```sql
-- the biggest senders by number of emails, grouped by domain
select
  count(*) as howmany,
  split_part(from_email, '@', 2) as email_domain -- Extracts the part after '@'
from
  signature_expanded_cache
group by
  email_domain
order by
  howmany desc;
```

Happy querying! 🚀