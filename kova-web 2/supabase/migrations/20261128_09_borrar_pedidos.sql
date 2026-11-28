-- =============================================================================
-- KOVA · Migración 09 — Borrar pedidos desde el panel
--
-- admin_delete_orders(ids, 'BORRAR') elimina uno o varios pedidos de forma definitiva.
--   · Solo owner/admin (is_admin). Producción y el público no pueden ejecutarla.
--   · Exige escribir BORRAR para confirmar (también lo pide el panel).
--   · Antes de borrar, el pedido se libera igual que una cancelación: vuelve el stock reservado
--     o vendido (si no se había enviado) y se liberan los cupos de preventa.
--   · Se borran sus productos, pagos, historial, diseños, cupos de subida y el uso del código
--     promocional (el uso deja de contar).
--   · Los movimientos de inventario se conservan (sin enlace al pedido) para que el stock cuadre.
--   · Queda una copia completa del pedido en audit_logs (acción 'delete').
--   · Devuelve las rutas de comprobantes y diseños para que el panel borre los archivos.
-- No modifica ni borra datos existentes al aplicarse.
-- =============================================================================

create or replace function public.admin_delete_orders(p_orders uuid[], p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  v_proofs text[] := '{}';
  v_designs text[] := '{}';
  v_numbers text[] := '{}';
  v_snapshot jsonb;
begin
  perform public._require_admin();
  if upper(btrim(coalesce(p_confirm, ''))) <> 'BORRAR' then perform public._fail('Escribe BORRAR para confirmar.'); end if;
  if p_orders is null or cardinality(p_orders) = 0 then perform public._fail('No elegiste pedidos.'); end if;
  if cardinality(p_orders) > 200 then perform public._fail('Borra máximo 200 pedidos a la vez.'); end if;

  for o in select * from public.orders where id = any(p_orders) order by created_at for update loop
    v_snapshot := jsonb_build_object(
      'order', to_jsonb(o),
      'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.line_no), '[]'::jsonb) from public.order_items i where i.order_id = o.id),
      'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb) from public.payments p where p.order_id = o.id),
      'promo', (select to_jsonb(r) from public.promo_redemptions r where r.order_id = o.id));

    -- 1. Devolver stock y cupos como en una cancelación (no hace nada si ya estaba cancelado o vencido).
    perform public._release_order(o.id, 'cancelled', 'admin', 'Pedido eliminado');

    -- 2. Archivos que el panel debe borrar del almacenamiento.
    v_proofs := v_proofs
      || coalesce((select array_agg(p.proof_path) from public.payments p where p.order_id = o.id and p.proof_path is not null), '{}')
      || coalesce((select array_agg(s.path) from public.proof_upload_slots s where s.order_id = o.id), '{}');
    v_designs := v_designs
      || coalesce((select array_agg(d.path) from public.order_design_files d where d.order_id = o.id), '{}')
      || coalesce((select array_agg(s.path) from public.design_upload_slots s where s.order_id = o.id), '{}');

    -- 3. Filas relacionadas sin borrado en cascada.
    delete from public.promo_redemptions where order_id = o.id;
    delete from public.payments where order_id = o.id;
    update public.inventory_movements
       set order_id = null, note = btrim(note || ' · pedido ' || o.number || ' eliminado', ' ·')
     where order_id = o.id;

    -- 4. El pedido (productos, historial, diseños y cupos de subida se van en cascada).
    delete from public.orders where id = o.id;

    perform public._audit('delete', 'orders', o.id::text, v_snapshot);
    v_numbers := v_numbers || o.number;
  end loop;

  return jsonb_build_object(
    'deleted', cardinality(v_numbers),
    'numbers', to_jsonb(v_numbers),
    'not_found', cardinality(p_orders) - cardinality(v_numbers),
    'files', jsonb_build_object(
      'payment-proofs', to_jsonb(array(select distinct x from unnest(v_proofs) x)),
      'custom-designs', to_jsonb(array(select distinct x from unnest(v_designs) x))));
end; $$;

revoke all on function public.admin_delete_orders(uuid[], text) from public, anon;
grant execute on function public.admin_delete_orders(uuid[], text) to authenticated;

-- Los administradores pueden borrar comprobantes y diseños (los del pedido eliminado).
drop policy if exists "payment-proofs: admins borran" on storage.objects;
create policy "payment-proofs: admins borran" on storage.objects
  for delete to authenticated using (bucket_id = 'payment-proofs' and public.is_admin());
drop policy if exists "custom-designs: admins borran" on storage.objects;
create policy "custom-designs: admins borran" on storage.objects
  for delete to authenticated using (bucket_id = 'custom-designs' and public.is_admin());
