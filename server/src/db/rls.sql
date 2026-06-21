-- 行级安全 (RLS) —— 多租户 DB 级兜底。
-- 对每张带 workspace_id 的租户表启用并 FORCE RLS,策略要求 workspace_id 等于
-- 当前事务设置的 app.current_workspace (见 src/db/client.ts 的 withTenant)。
-- FORCE 使表 owner 也受策略约束,便于用默认连接演示隔离。
-- 未设置 (或连接池复用残留空串) 时,nullif(...,'')→NULL,策略不放行任何行 (fail-safe)。

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'app_user','agent','machine','channel','channel_member','message','mention','reaction','attachment','saved','thread_unfollow','action_card','agent_login','draft','task','agent_seen',
    'agent_activity','reminder','reminder_event'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.current_workspace', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.current_workspace', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;
