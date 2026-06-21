-- 1. 전역 설정을 위한 테이블 생성 (Key-Value 스토어 대체)
create table if not exists global_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Row Level Security(RLS) 활성화
alter table global_settings enable row level security;

-- 3. 익명(anon) 키로 누구나 읽고 쓸 수 있는 RLS 정책 정의
drop policy if exists "Allow public read and write access" on global_settings;
create policy "Allow public read and write access"
on global_settings
for all
to anon
using (true)
with check (true);
