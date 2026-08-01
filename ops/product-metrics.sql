SELECT
  COUNT(DISTINCT CASE WHEN is_qa = 0 THEN session_hash END) AS users,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('searched','no_result') THEN session_hash END) AS searchers,
  COUNT(CASE WHEN is_qa = 0 AND event_name = 'searched' THEN 1 END) AS successful_searches,
  COUNT(CASE WHEN is_qa = 0 AND event_name = 'no_result' THEN 1 END) AS no_result_searches,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'official_opened' THEN session_hash END) AS official_readers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'citation_copied' THEN session_hash END) AS citation_copiers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'saved' THEN session_hash END) AS savers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'returned' THEN session_hash END) AS returned,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('searched','no_result') AND created_at >= unixepoch() - 7 * 86400 THEN session_hash END) AS searchers_7d,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'official_opened' AND created_at >= unixepoch() - 7 * 86400 THEN session_hash END) AS official_readers_7d,
  COUNT(CASE WHEN is_qa = 1 THEN 1 END) AS qa_rows
FROM product_events;
