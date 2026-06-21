-- 应用角色 —— 必须是非超级用户 (超级用户会绕过 RLS,连 FORCE 也绕过)。
-- 一次性执行,需以超级用户身份运行:  psql "$SUPERUSER_URL" -f src/db/roles.sql
-- 之后应用/测试用 crew_app 连接,RLS 才真正生效。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    CREATE ROLE crew_app LOGIN PASSWORD 'crew_app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO crew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crew_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crew_app;

-- 让未来新建的表/序列也自动授予 (迁移后无需重复 grant)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crew_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crew_app;
