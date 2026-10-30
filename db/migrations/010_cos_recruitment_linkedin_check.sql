-- 010: The recruiter's LinkedIn check. When the candidate's resume or JobAdder
-- application gives a LinkedIn profile, the recruiter must compare it with the
-- resume and record the result before joining the interview (LinkedIn can't be
-- read automatically). {url, outcome: matches|differences|not_found, note,
-- checkedBy, checkedAt}; null until recorded. Also added to JobAdder notes.

alter table public.cos_recruitment_bookings
  add column linkedin_check jsonb;
