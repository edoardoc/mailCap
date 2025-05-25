-- views.sql: Create DuckDB views over JSON mail signatures

-- 1) Point at your raw JSON files in data/*.json
CREATE OR REPLACE VIEW signatures AS
  SELECT *
    FROM read_json_auto('data/*.json');

-- 2) Flatten headers into separate columns
CREATE OR REPLACE VIEW signature_expanded AS
SELECT
  m.id,
  m.threadId,
  m.snippet,
  -- parse Date into TIMESTAMP (strip weekday, normalize timezone)
  TRY(STRPTIME(
    CASE
      WHEN RIGHT(
             TRIM(LEADING FROM SUBSTR(dt.raw_date, STRPOS(dt.raw_date, ',') + 1)),
             6
           ) LIKE ' +____'
        OR RIGHT(
             TRIM(LEADING FROM SUBSTR(dt.raw_date, STRPOS(dt.raw_date, ',') + 1)),
             6
           ) LIKE ' -____'
      THEN TRIM(LEADING FROM SUBSTR(dt.raw_date, STRPOS(dt.raw_date, ',') + 1))
      ELSE TRIM(LEADING FROM SUBSTR(dt.raw_date, STRPOS(dt.raw_date, ',') + 1)) || ' +0000'
    END,
    '%d %b %Y %H:%M:%S %z'
  )) AS date,
  fr.from_email  AS from_email,
  to_.to_email   AS to_email,
  su.subject     AS subject,
  m.labelIds     AS labelIds
FROM signatures AS m
-- extract and normalize the Date header (strip '(TZ)' & map 'GMT' to '+0000')
LEFT JOIN LATERAL (
  SELECT REPLACE(
           REPLACE(
             SPLIT_PART(x.value, ' (', 1),  -- drop any trailing parentheses
             ' GMT', ' +0000'              -- map 'GMT' to '+0000'
           ),
           ' UT',  ' +0000'                -- map 'UT' to '+0000'
         ) AS raw_date
    FROM UNNEST(m.headers) AS t(x)
   WHERE x.name = 'Date'
) AS dt(raw_date) ON TRUE
LEFT JOIN LATERAL (
  SELECT x.value
    FROM UNNEST(m.headers) AS t(x)
   WHERE x.name = 'From'
) AS fr(from_email) ON TRUE
LEFT JOIN LATERAL (
  SELECT x.value
    FROM UNNEST(m.headers) AS t(x)
   WHERE x.name = 'To'
) AS to_(to_email) ON TRUE
LEFT JOIN LATERAL (
  SELECT x.value
    FROM UNNEST(m.headers) AS t(x)
   WHERE x.name = 'Subject'
 ) AS su(subject) ON TRUE;


-- persist the cache
CREATE OR REPLACE TABLE signature_expanded_cache AS
    SELECT * FROM signature_expanded;


