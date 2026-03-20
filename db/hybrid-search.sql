create extension if not exists vector;

create or replace function public.match_documents_hybrid(
  query_embedding vector(1536),
  keyword_query text,
  match_count int default 20
)
returns table (
  source text,
  text text,
  title text,
  date text,
  ref text,
  vector_score double precision,
  keyword_score double precision,
  hybrid_score double precision
)
language sql
stable
as $$
with sermon_candidates as (
  select
    'message'::text as source,
    coalesce(sc.text, '') as text,
    coalesce(s.title, 'William Branham Sermon') as title,
    coalesce(s.date::text, '') as date,
    coalesce(s.reference_code, '') as ref,
    greatest(0::double precision, 1 - (sc.embedding <=> query_embedding)) as vector_score,
    ts_rank_cd(
      to_tsvector('english', coalesce(sc.text, '')),
      plainto_tsquery('english', coalesce(keyword_query, ''))
    )::double precision as keyword_score,
    0::double precision as source_boost
  from sermon_chunks sc
  left join sermons s on s.id = sc.sermon_id
  where sc.embedding is not null
),
bible_candidates as (
  select
    'bible'::text as source,
    coalesce(bv.text, '') as text,
    trim(concat_ws(' ', bv.book, concat(bv.chapter, ':', bv.verse))) as title,
    'KJV'::text as date,
    ''::text as ref,
    greatest(0::double precision, 1 - (bv.embedding <=> query_embedding)) as vector_score,
    ts_rank_cd(
      to_tsvector('english', coalesce(bv.text, '')),
      plainto_tsquery('english', coalesce(keyword_query, ''))
    )::double precision as keyword_score,
    0.10::double precision as source_boost
  from bible_verses bv
  where bv.embedding is not null
),
combined as (
  select
    source,
    text,
    title,
    date,
    ref,
    vector_score,
    keyword_score,
    (vector_score * 0.65) + (keyword_score * 0.25) + source_boost as hybrid_score
  from (
    select * from sermon_candidates
    union all
    select * from bible_candidates
  ) u
)
select
  source,
  text,
  title,
  date,
  ref,
  vector_score,
  keyword_score,
  hybrid_score
from combined
order by hybrid_score desc
limit greatest(match_count, 1);
$$;
