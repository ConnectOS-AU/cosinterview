-- Recruiter admins: they manage the recruiter list at /r/admin.
alter table public.cos_recruitment_recruiters
  add column is_admin boolean not null default false;

-- Sign-in matches recruiters by email, so one profile per email.
create unique index cos_recruitment_recruiters_email_key
  on public.cos_recruitment_recruiters (lower(calendar_email));

-- The first admin, so someone can get in and add the rest.
insert into public.cos_recruitment_recruiters (slug, display_name, calendar_email, is_admin)
values ('simon-hibbert', 'Simon Hibbert', 'simon.hibbert@connectos.co', true)
on conflict (slug) do update set is_admin = true;
