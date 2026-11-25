-- Copia de los 2 productos reales de producción (26-nov-2026) para probar la migración sobre datos existentes.
insert into public.products (id, name, category, price, sizes, colors, tag, featured, details, images) values
 ('anima-aetherna', 'Anima Aetherna', 'shirts', 72000, '["S","M"]', '[{"hex":"#e7e0d7","name":"Arena"},{"hex":"#cb9467","name":"Cafe Claro"}]', 'DROP 01', true, '["100% algodón","220 g"]', '["a.webp","b.webp"]'),
 ('per-aspera-ad-astra', 'Per aspera ad astra', 'shirts', 72000, '["S","M"]', '[{"hex":"#00001f","name":"Azul Marino"},{"hex":"#efe7de","name":"Beige"},{"hex":"#ffffff","name":"Blanco"}]', 'DROP 01', true, '["100% algodón"]', '["c.webp"]');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@test'), ('00000000-0000-0000-0000-0000000000b2', 'prod@test'), ('00000000-0000-0000-0000-0000000000c3', 'nadie@test');
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
