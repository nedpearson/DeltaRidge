begin;
select plan(5);

-- Test table exists
select has_table('ai_intelligence_results', 'ai_intelligence_results table exists');

-- Test columns
select has_column('ai_intelligence_results', 'property_id', 'has property_id column');
select has_column('ai_intelligence_results', 'lead_id', 'has lead_id column');
select has_column('ai_intelligence_results', 'raw_output', 'has raw_output column');
select has_column('properties', 'opportunity_summary', 'properties has opportunity_summary column');

select * from finish();
rollback;
