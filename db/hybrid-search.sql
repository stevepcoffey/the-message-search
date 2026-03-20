create extension if not exists vector;

create index if not exists sermon_chunks_embedding_idx
  on public.sermon_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists bible_verses_embedding_idx
  on public.bible_verses using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists sermon_chunks_text_tsv_idx
  on public.sermon_chunks using gin (to_tsvector('english', coalesce(text, '')));

create index if not exists bible_verses_text_tsv_idx
  on public.bible_verses using gin (to_tsvector('english', coalesce(text, '')));

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
with keyword as (
  select nullif(trim(coalesce(keyword_query, '')), '') as q
),
sermon_vec as (
  select
    sc.sermon_id,
    sc.chunk_index,
    sc.text,
    greatest(0::double precision, 1 - (sc.embedding <=> query_embedding)) as vector_score
  from sermon_chunks sc
  where sc.embedding is not null
  order by sc.embedding <=> query_embedding asc
  limit greatest(match_count * 30, 300)
),
sermon_kw as (
  select
    sc.sermon_id,
    sc.chunk_index,
    sc.text,
    ts_rank_cd(
      to_tsvector('english', coalesce(sc.text, '')),
      plainto_tsquery('english', (select q from keyword))
    )::double precision as keyword_score
  from sermon_chunks sc
  where (select q from keyword) is not null
    and to_tsvector('english', coalesce(sc.text, '')) @@ plainto_tsquery('english', (select q from keyword))
  order by keyword_score desc
  limit greatest(match_count * 20, 200)
),
sermon_candidates as (
  select distinct
    coalesce(v.sermon_id, k.sermon_id) as sermon_id,
    coalesce(v.chunk_index, k.chunk_index) as chunk_index,
    coalesce(v.text, k.text, '') as text,
    coalesce(v.vector_score, 0::double precision) as vector_score,
    coalesce(k.keyword_score, 0::double precision) as keyword_score
  from sermon_vec v
  full join sermon_kw k
    on v.sermon_id = k.sermon_id and v.chunk_index = k.chunk_index
),
bible_vec as (
  select
    bv.book_number,
    bv.chapter,
    bv.verse,
    bv.book,
    bv.text,
    greatest(0::double precision, 1 - (bv.embedding <=> query_embedding)) as vector_score
  from bible_verses bv
  where bv.embedding is not null
  order by bv.embedding <=> query_embedding asc
  limit greatest(match_count * 20, 200)
),
bible_kw as (
  select
    bv.book_number,
    bv.chapter,
    bv.verse,
    bv.book,
    bv.text,
    ts_rank_cd(
      to_tsvector('english', coalesce(bv.text, '')),
      plainto_tsquery('english', (select q from keyword))
    )::double precision as keyword_score
  from bible_verses bv
  where (select q from keyword) is not null
    and to_tsvector('english', coalesce(bv.text, '')) @@ plainto_tsquery('english', (select q from keyword))
  order by keyword_score desc
  limit greatest(match_count * 15, 150)
),
bible_candidates as (
  select distinct
    coalesce(v.book_number, k.book_number) as book_number,
    coalesce(v.chapter, k.chapter) as chapter,
    coalesce(v.verse, k.verse) as verse,
    coalesce(v.book, k.book) as book,
    coalesce(v.text, k.text, '') as text,
    coalesce(v.vector_score, 0::double precision) as vector_score,
    coalesce(k.keyword_score, 0::double precision) as keyword_score
  from bible_vec v
  full join bible_kw k
    on v.book_number = k.book_number and v.chapter = k.chapter and v.verse = k.verse
),
scored as (
  select
    'message'::text as source,
    coalesce(sc.text, '') as text,
    coalesce(s.title, 'William Branham Sermon') as title,
    coalesce(s.date::text, '') as date,
    coalesce(s.reference_code, '') as ref,
    sc.vector_score,
    sc.keyword_score,
    (sc.vector_score * 0.65) + (sc.keyword_score * 0.25) as hybrid_score
  from sermon_candidates sc
  left join sermons s on s.id = sc.sermon_id

  union all

  select
    'bible'::text as source,
    coalesce(bv.text, '') as text,
    trim(concat_ws(' ', bv.book, concat(bv.chapter, ':', bv.verse))) as title,
    'KJV'::text as date,
    ''::text as ref,
    bv.vector_score,
    bv.keyword_score,
    (bv.vector_score * 0.65) + (bv.keyword_score * 0.25) + 0.10::double precision as hybrid_score
  from bible_candidates bv
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
    hybrid_score
  from scored
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
