-- 全文检索 (message search) —— pg_trgm 子串索引。
-- v1 用 trigram,对中文按子串匹配可用,无需分词器。后续可换 pg_jieba + tsvector。
-- 需以 owner/超级用户执行 (CREATE EXTENSION)。

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_message_content_trgm
  ON message USING gin (content gin_trgm_ops);
