-- 04 · Endurecimiento sugerido por el asesor de seguridad de Supabase (no destructivo).
-- Fija search_path en funciones auxiliares y quita EXECUTE público de la función de trigger.
alter function public._pct(integer, numeric) set search_path = public, extensions;
alter function public._clean(text, integer) set search_path = public, extensions;
alter function public._client_ip() set search_path = public, extensions;
alter function public._fail(text) set search_path = public, extensions;
alter function public._fulfillment_allowed(text, text) set search_path = public, extensions;
alter function public._norm_email(text) set search_path = public, extensions;
alter function public._norm_phone(text) set search_path = public, extensions;
alter function public._quote(jsonb, jsonb, text, public.preorder_campaigns, jsonb) set search_path = public, extensions;
revoke execute on function public.sync_product_variants() from public, anon, authenticated;
